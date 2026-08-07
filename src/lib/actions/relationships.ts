"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { filterReadablePeopleIds, requireUserForAction } from "@/lib/access";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";
import { inputToDateOnly } from "@/lib/time";
import { toFieldKey } from "@/lib/fields/types";

export async function addRelationship(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const fromPersonId = readString(form, "fromPersonId");
  try {
    const user = await requireUserForAction();
    const toPersonId = readString(form, "toPersonId");
    const typeId = readString(form, "typeId");

    if (!toPersonId) return actionError("Choose who to link to.");
    if (!typeId) return actionError("Choose a relationship type.");
    if (fromPersonId === toPersonId) {
      return actionError("A person cannot be related to themselves.");
    }

    const allowed = await filterReadablePeopleIds(user.id, [fromPersonId, toPersonId]);
    if (allowed.length !== 2) return actionError("One of those people was not found.");

    // System types (ownerId null) are shared; anything else must be the user's.
    const type = await prisma.relationshipType.findFirst({
      where: { id: typeId, OR: [{ ownerId: null }, { ownerId: user.id }] },
      select: { id: true, symmetric: true },
    });
    if (!type) return actionError("That relationship type was not found.");

    // For symmetric types, A-spouse-B and B-spouse-A are the same fact, and the
    // unique index cannot catch it because the column values differ.
    const duplicate = await prisma.relationship.findFirst({
      where: type.symmetric
        ? {
            ownerId: user.id,
            typeId,
            OR: [
              { fromPersonId, toPersonId },
              { fromPersonId: toPersonId, toPersonId: fromPersonId },
            ],
          }
        : { ownerId: user.id, typeId, fromPersonId, toPersonId },
      select: { id: true },
    });
    if (duplicate) return actionError("That relationship already exists.");

    const startedOnRaw = readString(form, "startedOn");
    const endedOnRaw = readString(form, "endedOn");

    await prisma.relationship.create({
      data: {
        ownerId: user.id,
        fromPersonId,
        toPersonId,
        typeId,
        notes: readString(form, "notes") || null,
        startedOn: startedOnRaw ? inputToDateOnly(startedOnRaw) : null,
        endedOn: endedOnRaw ? inputToDateOnly(endedOnRaw) : null,
      },
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath(`/people/${fromPersonId}`);
  return actionOk("Relationship added.");
}

export async function removeRelationship(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  const rel = await prisma.relationship.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, fromPersonId: true, toPersonId: true },
  });
  if (!rel) return;

  await prisma.relationship.delete({ where: { id: rel.id } });
  revalidatePath(`/people/${rel.fromPersonId}`);
  revalidatePath(`/people/${rel.toPersonId}`);
}

// --- user-defined relationship types ---------------------------------------

export async function createRelationshipType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const label = readString(form, "label");
    if (!label) return actionError("Give the relationship a name.");

    const symmetric = readCheckbox(form, "symmetric");
    const inverseLabel = symmetric
      ? label
      : readString(form, "inverseLabel") || `Inverse of ${label}`;

    const key = toFieldKey(label);
    if (!key) return actionError("That name cannot be used. Try letters and numbers.");

    const clash = await prisma.relationshipType.findFirst({
      where: { key, OR: [{ ownerId: null }, { ownerId: user.id }] },
      select: { id: true },
    });
    if (clash) return actionError(`A "${label}" relationship type already exists.`);

    const last = await prisma.relationshipType.findFirst({
      where: { ownerId: user.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    await prisma.relationshipType.create({
      data: {
        ownerId: user.id,
        key,
        label,
        inverseLabel,
        symmetric,
        order: Math.max(1000, (last?.order ?? 0) + 10),
      },
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/settings/relationships");
  return actionOk("Relationship type created.");
}

export async function deleteRelationshipType(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  // onDelete: Restrict on Relationship.type means this throws while in use;
  // check first so we can stay silent rather than surfacing a Prisma error.
  const type = await prisma.relationshipType.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, _count: { select: { relationships: true } } },
  });
  if (!type || type._count.relationships > 0) return;

  await prisma.relationshipType.delete({ where: { id: type.id } });
  revalidatePath("/settings/relationships");
}

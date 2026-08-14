"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { filterReadablePeopleIds, requireUserForAction } from "@/lib/access";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";
import { inputToDateOnly } from "@/lib/time";
import { orientRelationship } from "@/lib/relationships";
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

/**
 * Change an existing relationship's type, direction, dates or notes.
 *
 * One row serves both people — "Parent of" on Jack's page is "Child of" on Jill's — so an
 * edit has to say which end it was submitted from AND which way round the chosen label
 * runs. A dropdown of types alone cannot express the current state of a row viewed from
 * its `to` end: standing on Jill's page, "Child of" is not a type, it is the inverse of
 * one. So the form offers both readings of every asymmetric type, and picking the inverse
 * is how you correct a relationship entered backwards.
 *
 * The other person is deliberately not editable. Pointing a relationship at somebody else
 * is not an amendment, it is a different fact, and remove-and-add says so.
 */
export async function updateRelationship(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const subjectId = readString(form, "subjectId");
  try {
    const user = await requireUserForAction();
    const id = readString(form, "id");

    // "<typeId>:forward" means the subject is the type's `from` side; ":inverse" means
    // they are its `to` side. One field, so the two can never arrive inconsistent.
    const [typeId, direction] = readString(form, "typeDirection").split(":");
    if (!typeId) return actionError("Choose a relationship type.");
    const subjectIsFrom = direction !== "inverse";

    // Relationships are owned outright — they are not shareable — so ownership is the
    // whole access check.
    const existing = await prisma.relationship.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, fromPersonId: true, toPersonId: true },
    });
    if (!existing) return actionError("That relationship no longer exists.");

    const type = await prisma.relationshipType.findFirst({
      where: { id: typeId, OR: [{ ownerId: null }, { ownerId: user.id }] },
      select: { id: true, symmetric: true },
    });
    if (!type) return actionError("That relationship type was not found.");

    const oriented = orientRelationship(existing, subjectId, subjectIsFrom);
    if (!oriented) {
      return actionError("That relationship does not involve this contact.");
    }
    const { fromPersonId, toPersonId } = oriented;

    // A symmetric type stores A-B and B-A as the same fact, and the unique index cannot
    // see that because the column values differ — so the clash check has to look both
    // ways round.
    const clash = await prisma.relationship.findFirst({
      where: {
        id: { not: existing.id },
        ownerId: user.id,
        typeId,
        ...(type.symmetric
          ? {
              OR: [
                { fromPersonId, toPersonId },
                { fromPersonId: toPersonId, toPersonId: fromPersonId },
              ],
            }
          : { fromPersonId, toPersonId }),
      },
      select: { id: true },
    });
    if (clash) return actionError("These two already have that relationship.");

    const startedOnRaw = readString(form, "startedOn");
    const endedOnRaw = readString(form, "endedOn");

    await prisma.relationship.update({
      where: { id: existing.id },
      data: {
        typeId,
        fromPersonId,
        toPersonId,
        notes: readString(form, "notes") || null,
        startedOn: startedOnRaw ? inputToDateOnly(startedOnRaw) : null,
        endedOn: endedOnRaw ? inputToDateOnly(endedOnRaw) : null,
      },
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath(`/people/${subjectId}`);
  return actionOk("Relationship saved.");
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

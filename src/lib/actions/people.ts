"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  requireOwnedPerson,
  requireUserForAction,
  requireWritablePerson,
} from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { parseFields } from "@/lib/fields/validation";
import { partitionFieldValues, readCustomBag } from "@/lib/fields/values";
import { computeDisplayName, parseContactPoints, type PersonNameParts } from "@/lib/people";
import { getUserSettings } from "@/lib/settings";
import { actionError, type ActionState } from "@/lib/actions/types";
import { asColumnData, isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";
import { cancelPendingDeletion, queueContactDeletion } from "@/lib/sync/tombstones";

export async function createPerson(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const user = await requireUserForAction();
    const registry = await loadRegistry(user.id, "PERSON");

    const parsed = parseFields(registry, form);
    if (!parsed.ok) {
      return actionError("Please fix the highlighted fields.", parsed.errors);
    }
    const contacts = parseContactPoints(form);
    if (!contacts.ok) return actionError(contacts.error);

    const settings = await getUserSettings(user.id);
    // A create form always renders the checkbox, so its absence means the user
    // unchecked it — but fall back to the default for programmatic callers.
    const addToGoogle = form.has("addToGooglePresent")
      ? readCheckbox(form, "addToGoogle")
      : settings.defaultAddToGoogle;

    const { columns, custom } = partitionFieldValues(registry, parsed.values);

    const created = await prisma.person.create({
      data: {
        ...asColumnData<Prisma.PersonUncheckedCreateInput>(columns),
        ownerId: user.id,
        displayName: computeDisplayName(columns as PersonNameParts),
        custom: custom as Prisma.InputJsonValue,
        addToGoogle,
        googleSyncStatus: addToGoogle ? "PENDING" : "DISABLED",
        contactPoints: contacts.items.length
          ? { create: contacts.items }
          : undefined,
      },
      select: { id: true },
    });
    newId = created.id;
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/people");
  redirect(`/people/${newId}`);
}

export async function updatePerson(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = readString(form, "id");
  try {
    const user = await requireUserForAction();
    await requireWritablePerson(user.id, id);

    const existing = await prisma.person.findUniqueOrThrow({
      where: { id },
      select: {
        custom: true,
        addToGoogle: true,
        googleResourceName: true,
        googleEtag: true,
      },
    });

    const registry = await loadRegistry(user.id, "PERSON");
    const parsed = parseFields(registry, form);
    if (!parsed.ok) {
      return actionError("Please fix the highlighted fields.", parsed.errors);
    }
    const contacts = parseContactPoints(form);
    if (!contacts.ok) return actionError(contacts.error);

    const addToGoogle = readCheckbox(form, "addToGoogle");
    const optedOut = existing.addToGoogle && !addToGoogle;
    const optedIn = !existing.addToGoogle && addToGoogle;

    // Archived fields are not in `registry`, so merging over the existing bag
    // preserves their stored values instead of dropping them on save.
    const { columns, custom } = partitionFieldValues(
      registry,
      parsed.values,
      readCustomBag(existing),
    );

    await prisma.$transaction(async (tx) => {
      if (optedOut && existing.googleResourceName) {
        await queueContactDeletion(tx, {
          ownerId: user.id,
          resourceId: existing.googleResourceName,
          etag: existing.googleEtag,
          reason: "opted_out",
        });
      }
      if (optedIn && existing.googleResourceName) {
        await cancelPendingDeletion(tx, "GOOGLE_CONTACT", existing.googleResourceName);
      }

      await tx.person.update({
        where: { id },
        data: {
          ...asColumnData<Prisma.PersonUncheckedUpdateInput>(columns),
          displayName: computeDisplayName(columns as PersonNameParts),
          custom: custom as Prisma.InputJsonValue,
          addToGoogle,
          // Any local edit makes the remote copy stale.
          googleSyncStatus: addToGoogle ? "PENDING" : "DISABLED",
          googleSyncError: null,
        },
      });

      // Contact points are replaced wholesale rather than diffed: Google's
      // People API replaces the whole array on update anyway, so preserving
      // individual row ids buys nothing.
      await tx.contactPoint.deleteMany({ where: { personId: id } });
      if (contacts.items.length) {
        await tx.contactPoint.createMany({
          data: contacts.items.map((c) => ({ ...c, personId: id })),
        });
      }
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  redirect(`/people/${id}`);
}

export async function deletePerson(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();
  // Deleting is the owner's alone: an EDIT share is permission to help maintain a
  // record, not to destroy someone else's.
  await requireOwnedPerson(user.id, id);

  const existing = await prisma.person.findUnique({
    where: { id },
    select: { googleResourceName: true, googleEtag: true },
  });

  await prisma.$transaction(async (tx) => {
    if (existing?.googleResourceName) {
      await queueContactDeletion(tx, {
        ownerId: user.id,
        resourceId: existing.googleResourceName,
        etag: existing.googleEtag,
        reason: "deleted",
      });
    }
    await tx.person.delete({ where: { id } });
  });

  revalidatePath("/people");
  redirect("/people");
}

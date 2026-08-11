"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserForAction, requireWritablePerson } from "@/lib/access";
import { isLabelColor, normaliseLabelName, labelKey } from "@/lib/labels";
import { requeueEveryCopy, requeueLabelledContacts } from "@/lib/sync/requeue";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/**
 * Find an owner's label by name, case-insensitively.
 *
 * The unique index is on the exact name, so it cannot answer "does this owner
 * already have a Family?" when the user typed "family". Doing the check here keeps
 * the two ways a duplicate can arrive — the form and CSV import — agreeing.
 */
export async function findLabelByName(
  tx: Prisma.TransactionClient,
  ownerId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const candidates = await tx.label.findMany({
    where: { ownerId },
    select: { id: true, name: true },
  });
  const key = labelKey(name);
  return candidates.find((c) => labelKey(c.name) === key) ?? null;
}

/** Find or create a label, used by the form and by CSV import alike. */
export async function ensureLabel(
  tx: Prisma.TransactionClient,
  ownerId: string,
  rawName: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const name = normaliseLabelName(rawName);
  const existing = await findLabelByName(tx, ownerId, name);
  if (existing) return { ...existing, created: false };

  const label = await tx.label.create({
    data: { ownerId, name },
    select: { id: true, name: true },
  });
  return { ...label, created: true };
}

export async function createLabel(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let name: string;
  try {
    const user = await requireUserForAction();
    name = normaliseLabelName(readString(form, "name"));
    if (!name) return actionError("Give the label a name.");

    const colorRaw = readString(form, "color");
    const color = isLabelColor(colorRaw) ? colorRaw : null;

    const clash = await findLabelByName(prisma, user.id, name);
    if (clash) return actionError(`You already have a “${clash.name}” label.`);

    await prisma.label.create({ data: { ownerId: user.id, name, color } });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/settings/labels");
  revalidatePath("/people");
  return actionOk(`Label “${name}” created.`);
}

export async function updateLabel(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const id = readString(form, "id");
    const name = normaliseLabelName(readString(form, "name"));
    if (!name) return actionError("Give the label a name.");

    const colorRaw = readString(form, "color");
    const color = isLabelColor(colorRaw) ? colorRaw : null;

    const label = await prisma.label.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, name: true },
    });
    if (!label) return actionError("That label no longer exists.");

    const clash = await findLabelByName(prisma, user.id, name);
    if (clash && clash.id !== label.id) {
      return actionError(`You already have a “${clash.name}” label.`);
    }

    const renamed = labelKey(label.name) !== labelKey(name);

    await prisma.$transaction(async (tx) => {
      await tx.label.update({ where: { id: label.id }, data: { name, color } });

      if (renamed) {
        // The Google group carries the label's name, so a rename makes every
        // labelled contact's remote copy stale — and the group rows themselves,
        // which the sync engine renames when it next sees them.
        await tx.labelGroup.updateMany({
          where: { labelId: label.id },
          data: { googleSyncedAt: null },
        });
        await requeueLabelledContacts(tx, label.id);
      }
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/settings/labels");
  revalidatePath("/people");
  return actionOk("Label saved.");
}

/**
 * Delete a label.
 *
 * Unlike relationship types, a label in use is not protected: removing a grouping
 * is a normal thing to want, and refusing until it is manually cleared off every
 * contact would make a 200-contact label undeletable in practice. The PersonLabel
 * rows cascade; the contacts themselves are untouched.
 */
export async function deleteLabel(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  const label = await prisma.label.findFirst({
    where: { id, ownerId: user.id },
    select: {
      id: true,
      googleGroups: { select: { userId: true, googleResourceName: true, googleEtag: true } },
    },
  });
  if (!label) return;

  await prisma.$transaction(async (tx) => {
    // Requeue BEFORE the delete: once the PersonLabel rows are gone there is no
    // way to find which contacts need their memberships rewritten in Google.
    await requeueLabelledContacts(tx, label.id);

    // Likewise the Google groups. They cascade away with the label, taking the only
    // handle on the remote group with them — so record each one first, or the label
    // survives on every phone it reached.
    for (const group of label.googleGroups) {
      await tx.syncTombstone.create({
        data: {
          // The account to delete FROM, which for a shared contact's label is not
          // necessarily the label's owner.
          ownerId: group.userId,
          target: "GOOGLE_CONTACT_GROUP",
          resourceId: group.googleResourceName,
          etag: group.googleEtag,
          reason: "deleted",
        },
      });
    }

    await tx.label.delete({ where: { id: label.id } });
  });

  revalidatePath("/settings/labels");
  revalidatePath("/people");
}

/**
 * Replace a contact's labels.
 *
 * The labels must belong to the contact's OWNER, not to whoever is editing. A
 * shared contact carries one set of labels so it looks the same to everyone who can
 * see it, which means an editing recipient is choosing from the owner's labels —
 * the same rule the field registry already follows.
 */
export async function setPersonLabels(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const personId = readString(form, "personId");
  try {
    const user = await requireUserForAction();
    const person = await requireWritablePerson(user.id, personId);

    const requested = [...new Set(form.getAll("labelId").map(String).filter(Boolean))];

    // Silently dropping foreign ids rather than erroring: the only way to submit
    // one is a stale form or a hand-made request, and in both cases the user's
    // intent is served by applying the labels that do belong here.
    const owned = await prisma.label.findMany({
      where: { id: { in: requested }, ownerId: person.ownerId },
      select: { id: true },
    });
    const labelIds = owned.map((l) => l.id);

    await prisma.$transaction(async (tx) => {
      // Clearing every label is a real request, and `notIn: []` is not a reliable
      // way to say "match everything" — so the two cases are written out.
      const stale: Prisma.PersonLabelWhereInput = labelIds.length
        ? { personId, labelId: { notIn: labelIds } }
        : { personId };
      await tx.personLabel.deleteMany({ where: stale });
      if (labelIds.length) {
        await tx.personLabel.createMany({
          data: labelIds.map((labelId) => ({ personId, labelId })),
          skipDuplicates: true,
        });
      }
      // Labels decide Google group membership, so a change here is a change to
      // every copy — the owner's and each recipient's.
      await requeueEveryCopy(tx, personId, person.addToGoogle);
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return actionOk("Labels saved.");
}

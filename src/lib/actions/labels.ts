"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserForAction, requireWritablePerson } from "@/lib/access";
import { isLabelColor, normaliseLabelName, labelKey } from "@/lib/labels";
import {
  applicableLabelsWhere,
  reapForLostRecipients,
  reconcileLabelShares,
  reconcilePersonShares,
} from "@/lib/shares/sticky";
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
      // Who the label was sharing contacts with. Read BEFORE the delete for the same reason
      // the groups are: the rows cascade away and take the only record of them with them.
      impliedShares: { select: { withUserId: true } },
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

  // The shares the label implied cascaded with it, so whoever held one may no longer be able
  // to see the contact at all — and a Google copy nothing will ever update again is worse
  // than no copy.
  await reapForLostRecipients(label.impliedShares.map((s) => s.withUserId));

  revalidatePath("/settings/labels");
  revalidatePath("/settings/sharing");
  revalidatePath("/people");
}

/**
 * Who a label shares its contacts with.
 *
 * Owner-only, and that is load-bearing rather than tidy: a participant who could edit the set
 * could add somebody and expose the owner's contacts to them. Participants see the set — they
 * are consenting to it — but only the owner changes it.
 *
 * The whole set is replaced rather than added to, because it is presented as a list of every
 * user with a permission each: a form that shows all three states has to be read as all three
 * states, or unticking somebody would do nothing.
 */
export async function setLabelParticipants(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let summary = "";
  try {
    const user = await requireUserForAction();
    const labelId = readString(form, "labelId");

    const label = await prisma.label.findFirst({
      where: { id: labelId, ownerId: user.id },
      select: { id: true, name: true },
    });
    if (!label) return actionError("That label no longer exists, or is not yours to share.");

    // One entry per user, as `userId:PERMISSION`. Anything unrecognised is dropped rather
    // than erroring: the only way to submit one is a stale form or a hand-made request, and
    // in both cases the user's intent is served by applying the rest.
    const wanted = new Map<string, "VIEW" | "EDIT">();
    for (const raw of form.getAll("participant").map(String)) {
      const [userId, permission] = raw.split(":");
      if (!userId || (permission !== "VIEW" && permission !== "EDIT")) continue;
      wanted.set(userId, permission);
    }

    const real = await prisma.user.findMany({
      where: { id: { in: [...wanted.keys()] } },
      select: { id: true },
    });
    const valid = new Set(real.map((u) => u.id));

    await prisma.$transaction(async (tx) => {
      await tx.labelShare.deleteMany({
        where: { labelId: label.id, withUserId: { notIn: [...valid] } },
      });
      for (const [withUserId, permission] of wanted) {
        if (!valid.has(withUserId)) continue;
        await tx.labelShare.upsert({
          where: { labelId_withUserId: { labelId: label.id, withUserId } },
          create: { labelId: label.id, withUserId, permission },
          update: { permission },
        });
      }
    });

    // Reaching the contacts already filed under it, not only the next one. Outside the
    // transaction above because it takes one per contact — see reconcileLabelShares.
    const run = await reconcileLabelShares(label.id);
    await reapForLostRecipients(run.lost);

    summary =
      valid.size === 0
        ? `“${label.name}” no longer shares anything.`
        : `“${label.name}” shares with ${valid.size} ${valid.size === 1 ? "person" : "people"}: ` +
          `${run.created} share${run.created === 1 ? "" : "s"} added, ${run.removed} withdrawn.`;
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/settings/labels");
  revalidatePath("/settings/sharing");
  revalidatePath("/people");
  return actionOk(summary);
}

/**
 * Replace a contact's labels.
 *
 * The labels must be ones the contact's OWNER may use, not ones whoever is editing may use. A
 * shared contact carries one set of labels so it looks the same to everyone who can see it,
 * which means that set has to be a function of the contact rather than of the viewer — the
 * same rule the field registry already follows.
 *
 * With sticky shares that rule does a second job for free. "Usable by the owner" means the
 * owner's own labels plus sticky labels the owner participates in, so a recipient with EDIT
 * can still file the contact under its owner's labels — unchanged — but cannot drag it into a
 * sharing circle of their own, because a label they participate in and the owner does not is
 * not applicable here.
 */
export async function setPersonLabels(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const personId = readString(form, "personId");
  let lost: string[] = [];
  try {
    const user = await requireUserForAction();
    const person = await requireWritablePerson(user.id, personId);

    const requested = [...new Set(form.getAll("labelId").map(String).filter(Boolean))];
    // A label typed here is created and applied in one step. Requiring a trip to
    // Settings to invent "Book club" before you can put anyone in it puts the
    // administration of labels in the way of the only reason to have one.
    const typed = normaliseLabelName(readString(form, "newLabel"));

    // Silently dropping foreign ids rather than erroring: the only way to submit
    // one is a stale form or a hand-made request, and in both cases the user's
    // intent is served by applying the labels that do belong here.
    const owned = await prisma.label.findMany({
      where: { AND: [{ id: { in: requested } }, applicableLabelsWhere(person.ownerId)] },
      select: { id: true },
    });
    const labelIds: string[] = owned.map((l) => l.id);

    await prisma.$transaction(async (tx) => {
      if (typed) {
        // Created against the contact's OWNER, like every other label on it: a shared
        // contact carries one set of labels so it reads the same to everyone, and a
        // label invented here has to live where those live.
        const made = await ensureLabel(tx, person.ownerId, typed);
        if (!labelIds.includes(made.id)) labelIds.push(made.id);
      }

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

      // And labels may decide who the contact is shared WITH. Inside the same
      // transaction, because a contact filed somewhere it is not shared from is a
      // half-applied change nobody would think to look for.
      lost = (await reconcilePersonShares(tx, personId)).lost;
    });

    // After the commit: withdrawing access withdraws it from that person's Google too, and
    // the reaper writes tombstones in a transaction of its own.
    await reapForLostRecipients(lost);
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return actionOk("Labels saved.");
}

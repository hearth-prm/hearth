"use server";

import { revalidatePath } from "next/cache";
import { reconcilePersonShares } from "@/lib/shares/sticky";
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
import { recordPersonVersionAfter } from "@/lib/person-versions";
import { AccessDeniedError, trashedPeopleWhere } from "@/lib/access";
import { getUserSettings } from "@/lib/settings";
import { actionError, type ActionState } from "@/lib/actions/types";
import { asColumnData, isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";
import { queueContactDeletionEverywhere } from "@/lib/sync/tombstones";
import { requeueEveryCopy } from "@/lib/sync/requeue";

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
        // No PersonSync rows yet: the engine creates one per Google account the
        // first time it pushes there, which is also when it learns which accounts
        // those are.
        contactPoints: contacts.items.length
          ? { create: contacts.items }
          : undefined,
      },
      select: { id: true },
    });
    newId = created.id;
    // After the write, so the snapshot is of what was stored rather than what was asked
    // for. Outside the transaction on purpose: a failed history entry must not undo a
    // saved contact.
    await recordPersonVersionAfter(newId, { byUserId: user.id, source: "CREATED" });
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
  let editorId: string | null = null;
  const id = readString(form, "id");
  try {
    // Captured because the recorder runs after the try block, where `user` is out of
    // scope — and history without an author is worth much less on a shared install.
    const user = await requireUserForAction();
    editorId = user.id;
    await requireWritablePerson(user.id, id);

    const existing = await prisma.person.findUniqueOrThrow({
      where: { id },
      select: { custom: true, addToGoogle: true, ownerId: true },
    });

    // The OWNER's registry, not the editor's. A shared contact's custom values are
    // keyed by the owner's field definitions, so parsing an edit through the
    // editor's registry would write foreign keys into the owner's record.
    const registry = await loadRegistry(existing.ownerId, "PERSON");
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
      if (optedOut) {
        // Every account holding a copy, not just the owner's.
        await queueContactDeletionEverywhere(tx, { personId: id, reason: "opted_out" });
      }
      if (optedIn) {
        // Changed their mind before the deletions were processed: drop them so the
        // existing copies are updated rather than deleted and recreated.
        const links = await tx.personSync.findMany({
          where: { personId: id, googleResourceName: { not: null } },
          select: { googleResourceName: true },
        });
        const ids = links.map((l) => l.googleResourceName!).filter(Boolean);
        if (ids.length) {
          await tx.syncTombstone.deleteMany({
            where: { target: "GOOGLE_CONTACT", resourceId: { in: ids }, processedAt: null },
          });
        }
      }

      await tx.person.update({
        where: { id },
        data: {
          ...asColumnData<Prisma.PersonUncheckedUpdateInput>(columns),
          displayName: computeDisplayName(columns as PersonNameParts),
          custom: custom as Prisma.InputJsonValue,
          addToGoogle,
        },
      });

      // An edit makes EVERY copy stale, whoever made it. This is what carries a
      // change your wife makes into your Google account as well as hers.
      await requeueEveryCopy(tx, id, addToGoogle);

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

  await recordPersonVersionAfter(id, { byUserId: editorId, source: "EDITED" });

  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  redirect(`/people/${id}`);
}

/**
 * Move a contact to the trash.
 *
 * This is what Delete does now. It still leaves your Google Contacts, because "deleted"
 * has to mean deleted on your phone — a contact that vanished from Hearth but stayed on a
 * handset would be worse than either outcome. Restoring pushes it back.
 *
 * Nothing is destroyed. The row keeps its id, its history, its gifts and its shares; the
 * trash never empties itself, so the only thing that removes it is somebody saying so.
 */
export async function deletePerson(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();
  // Deleting is the owner's alone: an EDIT share is permission to help maintain a
  // record, not to destroy someone else's.
  await requireOwnedPerson(user.id, id);

  await prisma.$transaction(async (tx) => {
    // The links are read before anything else, as they were for a hard delete: they are
    // the only record of which Google accounts hold a copy.
    await queueContactDeletionEverywhere(tx, { personId: id, reason: "deleted" });
    await tx.person.update({ where: { id }, data: { deletedAt: new Date() } });
  });

  await recordPersonVersionAfter(id, { byUserId: user.id, source: "TRASHED" });

  revalidatePath("/people");
  revalidatePath("/trash");
  redirect("/people");
}

/** Take a contact back out of the trash, and queue it to return to Google. */
export async function restorePerson(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  // Not requireOwnedPerson: that clause excludes trashed contacts, which is the whole
  // point of it — so the check is made here, against the trash.
  const trashed = await prisma.person.findFirst({
    where: { id, ...trashedPeopleWhere(user.id) },
    select: { id: true },
  });
  if (!trashed) throw new AccessDeniedError("That contact is not in your trash");

  await prisma.$transaction(async (tx) => {
    // Drop any deletion still waiting to be sent. A restore that raced its own tombstone
    // would put the contact back and then delete it again on the next sync.
    const links = await tx.personSync.findMany({
      where: { personId: id, googleResourceName: { not: null } },
      select: { googleResourceName: true },
    });
    const resourceIds = links
      .map((l) => l.googleResourceName)
      .filter((r): r is string => Boolean(r));
    if (resourceIds.length > 0) {
      await tx.syncTombstone.deleteMany({
        where: {
          target: "GOOGLE_CONTACT",
          resourceId: { in: resourceIds },
          processedAt: null,
        },
      });
    }
    // PENDING so the next sync pushes it back, whether the deletion already went out or
    // is being cancelled here.
    await tx.personSync.updateMany({
      where: { personId: id },
      data: { googleSyncStatus: "PENDING" },
    });
    await tx.person.update({ where: { id }, data: { deletedAt: null } });

    // Reconciliation skips a trashed contact — its shares are dormant anyway, since every
    // access clause filters deletedAt — so a restore is where its labels get to imply shares
    // again. After the update above, or it would still look trashed and be skipped.
    await reconcilePersonShares(tx, id);
  });

  await recordPersonVersionAfter(id, { byUserId: user.id, source: "RESTORED" });

  revalidatePath("/people");
  revalidatePath("/trash");
  redirect(`/people/${id}`);
}

/**
 * Destroy a contact for good.
 *
 * Only from the trash, so it takes two decisions rather than one. Its history goes with
 * it, which is the honest reading of a permanent delete.
 */
export async function purgePerson(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  const trashed = await prisma.person.findFirst({
    where: { id, ...trashedPeopleWhere(user.id) },
    select: { id: true, displayName: true, linkedUserId: true },
  });
  if (!trashed) throw new AccessDeniedError("That contact is not in your trash");

  // A card belonging to a user of this install may be trashed — that has always been
  // allowed, and it can be restored — but it may not be destroyed while somebody is
  // attached to it. Their thank-yous, their share of the household and their own page all
  // hang off this row, and none of that comes back.
  if (trashed.linkedUserId) {
    throw new AccessDeniedError(
      `${trashed.displayName} is the contact card of a Hearth user. Unlink it in Settings → Household before deleting it for good.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Trashing already queued these, but a contact may have been trashed before this
    // release, or its links may have changed since. Queuing again is harmless: the
    // tombstone worker treats an already-deleted resource as done.
    await queueContactDeletionEverywhere(tx, { personId: id, reason: "deleted" });
    await tx.person.delete({ where: { id } });
  });

  revalidatePath("/people");
  revalidatePath("/trash");
  redirect("/trash");
}

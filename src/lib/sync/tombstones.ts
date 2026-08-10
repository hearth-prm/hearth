import type { Prisma, SyncTarget } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Deletion bookkeeping for Google-synced records.
 *
 * When a synced record is deleted, or "Add to Google" is unchecked, the remote
 * copy still exists — and the only handle to it (the Google resource id) is
 * about to disappear with the local row. Recording it here first is what makes
 * "unchecking removes it from Google" possible at all.
 *
 * Rows are written from M1 onward even though the worker that drains them
 * arrives in M2: the alternative is a window in which deletions silently orphan
 * Google contacts that nothing can ever find again.
 */

export type TombstoneReason = "deleted" | "opted_out";

/**
 * Queue a delete from every Google account holding a copy of this contact.
 *
 * A shared contact exists in the owner's address book and in each recipient's, so
 * removing it means removing N copies. The PersonSync rows are the only record of
 * which accounts those are, and they go with the contact — hence reading them here,
 * before the delete, and returning how many were queued.
 */
export async function queueContactDeletionEverywhere(
  tx: Tx,
  args: { personId: string; reason: TombstoneReason },
): Promise<number> {
  const links = await tx.personSync.findMany({
    where: { personId: args.personId, googleResourceName: { not: null } },
    select: { userId: true, googleResourceName: true, googleEtag: true },
  });

  for (const link of links) {
    await tx.syncTombstone.create({
      data: {
        // ownerId on a tombstone is the account to delete FROM, not the record's
        // owner — the two differ for a shared contact.
        ownerId: link.userId,
        target: "GOOGLE_CONTACT",
        resourceId: link.googleResourceName!,
        etag: link.googleEtag,
        reason: args.reason,
      },
    });
  }
  return links.length;
}

/** Queue a delete from ONE account — used when a single share is withdrawn. */
export async function queueContactDeletionForAccount(
  tx: Tx,
  args: { personId: string; userId: string; reason: TombstoneReason },
): Promise<boolean> {
  const link = await tx.personSync.findFirst({
    where: { personId: args.personId, userId: args.userId, googleResourceName: { not: null } },
    select: { id: true, googleResourceName: true, googleEtag: true },
  });
  if (!link) return false;

  await tx.syncTombstone.create({
    data: {
      ownerId: args.userId,
      target: "GOOGLE_CONTACT",
      resourceId: link.googleResourceName!,
      etag: link.googleEtag,
      reason: args.reason,
    },
  });
  // Forget the link now: the contact is no longer theirs to hold, and leaving it
  // would let a re-share try to update a contact that is about to be deleted.
  await tx.personSync.delete({ where: { id: link.id } });
  return true;
}

export async function queueContactDeletion(
  tx: Tx,
  args: {
    ownerId: string;
    resourceId: string;
    etag?: string | null;
    reason: TombstoneReason;
  },
): Promise<void> {
  await tx.syncTombstone.create({
    data: {
      ownerId: args.ownerId,
      target: "GOOGLE_CONTACT",
      resourceId: args.resourceId,
      etag: args.etag ?? null,
      reason: args.reason,
    },
  });
}

export async function queueEventDeletion(
  tx: Tx,
  args: {
    ownerId: string;
    eventId: string;
    calendarId: string | null;
    etag?: string | null;
    reason: TombstoneReason;
  },
): Promise<void> {
  await tx.syncTombstone.create({
    data: {
      ownerId: args.ownerId,
      target: "GOOGLE_EVENT",
      resourceId: args.eventId,
      calendarId: args.calendarId,
      etag: args.etag ?? null,
      reason: args.reason,
    },
  });
}

/**
 * Undo a queued deletion.
 *
 * Covers the "unchecked, changed my mind, re-checked" case: the remote copy has
 * not been touched yet, so dropping the tombstone leaves it in place and the
 * next push updates it rather than creating a duplicate.
 */
export async function cancelPendingDeletion(
  tx: Tx,
  target: SyncTarget,
  resourceId: string,
): Promise<void> {
  await tx.syncTombstone.deleteMany({
    where: { target, resourceId, processedAt: null },
  });
}

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

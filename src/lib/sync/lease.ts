import { prisma } from "@/lib/db";

/**
 * Per-user sync lease.
 *
 * Stops the scheduled loop and a manual "Sync now" from running at the same time
 * and racing on the same records.
 *
 * A row-based lease rather than a Postgres advisory lock, because advisory locks
 * are held by a *connection* and Prisma hands out pooled connections: the lock
 * would be taken on one and the release attempted on another, leaking it until
 * the pool recycled. A lease also survives the process dying — it simply expires,
 * where an advisory lock on a crashed connection would need the pool to notice.
 */

/** Long enough for a slow run, short enough that a crash is not a long outage. */
const LEASE_MS = 10 * 60 * 1000;

/**
 * Take the lease if it is free or expired.
 *
 * The whole decision is one conditional UPDATE, so two callers racing cannot both
 * win: Postgres serialises the row update and the loser matches zero rows.
 */
export async function acquireSyncLease(
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const until = new Date(now.getTime() + LEASE_MS);
  const { count } = await prisma.userSettings.updateMany({
    where: {
      userId,
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: until },
  });
  return count === 1;
}

export async function releaseSyncLease(userId: string): Promise<void> {
  await prisma.userSettings.updateMany({
    where: { userId },
    data: { syncLockedUntil: null },
  });
}

/**
 * Run `fn` while holding the lease, or return null if someone else holds it.
 *
 * Releases in a finally block so a thrown error cannot strand the lease for the
 * full expiry window.
 */
export async function withSyncLease<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!(await acquireSyncLease(userId))) return null;
  try {
    return await fn();
  } finally {
    await releaseSyncLease(userId).catch(() => undefined);
  }
}

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readablePeopleWhere } from "@/lib/access";

/**
 * Withdraw Google contacts that Hearth has stopped managing for an account.
 *
 * The alternative to deleting them is leaving them behind, and a copy that nothing
 * will ever update again is worse than no copy: it looks current, ages silently, and
 * the person holding it has no way to tell. So whenever a contact stops being
 * Hearth's to maintain in a given account, it stops existing there.
 *
 * Both callers work by asking "which copies should this account no longer hold?"
 * rather than by reasoning forward from whatever just changed. Overlapping grants
 * make the forward version wrong — a recipient may hold a contact through both a
 * blanket share and a per-record one — and the backward version is equally correct
 * for one revocation or a hundred.
 */
async function reap(
  userId: string,
  person: Prisma.PersonWhereInput,
): Promise<number> {
  const doomed = await prisma.personSync.findMany({
    where: { userId, googleResourceName: { not: null }, person },
    select: { id: true, googleResourceName: true, googleEtag: true },
  });
  if (doomed.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const link of doomed) {
      await tx.syncTombstone.create({
        data: {
          // ownerId on a tombstone is the account to delete FROM, which for a shared
          // contact is not the record's owner.
          ownerId: userId,
          target: "GOOGLE_CONTACT",
          resourceId: link.googleResourceName!,
          etag: link.googleEtag,
          reason: "opted_out",
        },
      });
    }
    // Dropping the links in the same transaction is what makes an immediate
    // change-of-mind safe. The tombstone still holds the old resource id, so a
    // re-enable creates a fresh contact under a new id and the queued delete removes
    // the old one — the two cannot collide whichever order they run in.
    await tx.personSync.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });
  });

  return doomed.length;
}

/** Copies of contacts the user can no longer read at all — a share was withdrawn. */
export function reapUnreachableCopies(userId: string): Promise<number> {
  return reap(userId, { NOT: readablePeopleWhere(userId) });
}

/**
 * Copies of other people's contacts, when the user has asked not to receive them.
 *
 * Deliberately keyed on ownership rather than on readability: these contacts are
 * still perfectly visible in Hearth. The user has declined to have them in *Google*,
 * which is a narrower request than losing access.
 */
export function reapSharedCopies(userId: string): Promise<number> {
  return reap(userId, { ownerId: { not: userId } });
}

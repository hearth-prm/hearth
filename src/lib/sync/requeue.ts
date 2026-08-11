import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Mark every Google copy of a contact stale.
 *
 * "Every" is the point: an edit by any one person has to reach the owner's address
 * book and each recipient's, so this cannot be scoped to whoever made the change.
 * It is also what carries a label change outward, since a contact's labels decide
 * its Google group memberships.
 *
 * Resets the backoff as well as the status. A contact that failed five times and is
 * now waiting an hour has just been edited — the edit may well be the fix, so making
 * it wait out a penalty earned by a previous version would be wrong.
 */
export async function requeueEveryCopy(
  tx: Tx,
  personId: string,
  addToGoogle: boolean,
): Promise<void> {
  await tx.personSync.updateMany({
    where: { personId },
    data: {
      googleSyncStatus: addToGoogle ? "PENDING" : "DISABLED",
      googleSyncError: null,
      googleSyncAttempts: 0,
      googleSyncNextAttemptAt: null,
    },
  });
}

/**
 * Mark every copy of every contact carrying a given label stale.
 *
 * Renaming a label changes the Google group name for all of them, and deleting one
 * changes their memberships, so the unit of invalidation is the label rather than
 * the contact.
 */
export async function requeueLabelledContacts(
  tx: Tx,
  labelId: string,
): Promise<number> {
  const links = await tx.personLabel.findMany({
    where: { labelId },
    select: { personId: true },
  });
  if (links.length === 0) return 0;

  const personIds = links.map((l) => l.personId);
  // addToGoogle is per contact, so a blanket PENDING would wake copies the owner
  // has opted out of. Restricting the update to opted-in contacts leaves the rest
  // DISABLED, which is what they already are.
  await tx.personSync.updateMany({
    where: { personId: { in: personIds }, person: { addToGoogle: true } },
    data: {
      googleSyncStatus: "PENDING",
      googleSyncError: null,
      googleSyncAttempts: 0,
      googleSyncNextAttemptAt: null,
    },
  });
  return personIds.length;
}

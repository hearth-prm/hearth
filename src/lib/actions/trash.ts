"use server";

import { revalidatePath } from "next/cache";
import { requireUserForAction, trashedEventsWhere, trashedPeopleWhere } from "@/lib/access";
// Counting what is in the trash is done by the page itself, not here: every export from a
// "use server" module is a callable endpoint, and one taking a userId would answer for
// anybody's bin.
import { prisma } from "@/lib/db";
import { queueContactDeletionEverywhere, queueEventDeletion } from "@/lib/sync/tombstones";

/**
 * Destroy everything in this user's trash, for good.
 *
 * The reason to have this at all: thirty deleted contacts should not be thirty decisions.
 * The single decision is made here, once, in front of a count.
 *
 * Deliberately NOT one transaction around the lot. Prisma's interactive transactions time
 * out after a few seconds, and each record costs a tombstone query plus a write per Google
 * account holding a copy — so a big trash would fail as a whole and destroy nothing, which
 * is a worse answer than a partly emptied bin. One transaction per record keeps each
 * record's tombstones and its deletion atomic, which is the pairing that actually matters:
 * a row must never disappear without its Google copy being queued to follow it.
 */
export async function emptyTrash(): Promise<void> {
  const user = await requireUserForAction();

  // Ids first, so the loop is not iterating a moving target.
  const [people, events] = await Promise.all([
    prisma.person.findMany({
      where: { ...trashedPeopleWhere(user.id), linkedUserId: null },
      select: { id: true },
    }),
    prisma.event.findMany({
      where: trashedEventsWhere(user.id),
      select: {
        id: true,
        googleEventId: true,
        googleCalendarId: true,
        googleEtag: true,
      },
    }),
  ]);

  for (const person of people) {
    await prisma.$transaction(async (tx) => {
      // Trashing queued these already. Queuing again is harmless — the worker treats a
      // resource Google no longer has as done — and it covers a record trashed before
      // this release, or whose links changed since.
      await queueContactDeletionEverywhere(tx, { personId: person.id, reason: "deleted" });
      await tx.person.delete({ where: { id: person.id } });
    });
  }

  for (const event of events) {
    await prisma.$transaction(async (tx) => {
      if (event.googleEventId) {
        await queueEventDeletion(tx, {
          ownerId: user.id,
          eventId: event.googleEventId,
          calendarId: event.googleCalendarId,
          etag: event.googleEtag,
          reason: "deleted",
        });
      }
      await tx.event.delete({ where: { id: event.id } });
    });
  }

  revalidatePath("/trash");
  revalidatePath("/people");
  revalidatePath("/events");
}

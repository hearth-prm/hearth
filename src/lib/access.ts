import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Authorisation boundary.
 *
 * Every query that reads or writes user data goes through a `*Where` helper or a
 * `require*` guard from this module — none of them inline `{ ownerId }`
 * themselves. That was the bet made in M1, and sharing is where it paid: making
 * records shareable meant rewriting the clauses below and nothing else.
 *
 * A record is readable if you own it, if it was shared with you directly, or if its
 * owner shared their whole collection with you. Writable narrows that to EDIT
 * grants. Deleting is deliberately absent from both: it stays with the owner, since
 * an EDIT grant is permission to help maintain a record, not to destroy it.
 *
 * Sync DOES use these clauses, and must: a contact shared with you belongs in your
 * Google Contacts too, which is the whole point of sharing one. (An earlier version of
 * this comment claimed the opposite, and so did the code.)
 *
 * Household cards — the contact representing each user of the install — need no special
 * case here. They are owned by the head of the household and shared with everyone
 * through ordinary Share rows, so every clause below already covers them.
 */

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export class AccessDeniedError extends Error {
  constructor(message = "You do not have access to that record") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return {
    id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
}

/** For pages: redirect anonymous visitors to sign-in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

/** For server actions: throw rather than redirect, so the action can report. */
export async function requireUserForAction(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new AccessDeniedError("You must be signed in");
  return user;
}

// --- scope clauses ---------------------------------------------------------

export function readablePeopleWhere(userId: string): Prisma.PersonWhereInput {
  return {
    OR: [
      { ownerId: userId },
      // Shared as a single record.
      { shares: { some: { withUserId: userId } } },
      // The owner shared their whole address book, which covers contacts added
      // after the grant — the reason blanket scopes exist rather than expanding to
      // one row per record.
      {
        owner: {
          sharesGiven: { some: { withUserId: userId, scope: "ALL_PEOPLE" } },
        },
      },
    ],
  };
}

export function writablePeopleWhere(userId: string): Prisma.PersonWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { shares: { some: { withUserId: userId, permission: "EDIT" } } },
      {
        owner: {
          sharesGiven: {
            some: { withUserId: userId, scope: "ALL_PEOPLE", permission: "EDIT" },
          },
        },
      },
    ],
  };
}

export function readableEventsWhere(userId: string): Prisma.EventWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { shares: { some: { withUserId: userId } } },
      {
        owner: {
          sharesGiven: { some: { withUserId: userId, scope: "ALL_EVENTS" } },
        },
      },
    ],
  };
}

export function writableEventsWhere(userId: string): Prisma.EventWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { shares: { some: { withUserId: userId, permission: "EDIT" } } },
      {
        owner: {
          sharesGiven: {
            some: { withUserId: userId, scope: "ALL_EVENTS", permission: "EDIT" },
          },
        },
      },
    ],
  };
}

/**
 * A gift follows its RECIPIENT.
 *
 * Not its own sharing dimension, and not its recorder: the question a gift answers is
 * "what does this person have to say thank you for", so whoever may see that person
 * may see it. That makes a gift for a contact your partner shared with you appear
 * without a second set of rules to keep in step with the first — and it means a gift
 * cannot become a back door to a contact you were never given.
 *
 * The giver is deliberately not consulted. Being able to see Mary does not entitle you
 * to the list of what she gave a household you have no access to.
 */
export function readableGiftsWhere(userId: string): Prisma.GiftWhereInput {
  return { recipient: readablePeopleWhere(userId) };
}

export function writableGiftsWhere(userId: string): Prisma.GiftWhereInput {
  return { recipient: writablePeopleWhere(userId) };
}

/** Deleting is the owner's alone, whatever has been shared. */
export function ownedPeopleWhere(userId: string): Prisma.PersonWhereInput {
  return { ownerId: userId };
}

export function ownedEventsWhere(userId: string): Prisma.EventWhereInput {
  return { ownerId: userId };
}

export async function requireOwnedPerson(
  userId: string,
  personId: string,
): Promise<string> {
  const found = await prisma.person.findFirst({
    where: { id: personId, ...ownedPeopleWhere(userId) },
    select: { id: true },
  });
  if (!found) {
    throw new AccessDeniedError("Only the owner of a contact can delete it");
  }
  return found.id;
}

export async function requireOwnedEvent(
  userId: string,
  eventId: string,
): Promise<string> {
  const found = await prisma.event.findFirst({
    where: { id: eventId, ...ownedEventsWhere(userId) },
    select: { id: true },
  });
  if (!found) {
    throw new AccessDeniedError("Only the owner of an event can delete it");
  }
  return found.id;
}

// --- rendering questions --------------------------------------------------
//
// Pages need "may this person edit?" as a boolean, not as a throw. Asked through the
// same writable*Where predicate the action guards use, so a control can never be
// offered by a page that the action behind it will refuse — the bug these fix.

export async function canWritePerson(userId: string, personId: string): Promise<boolean> {
  const found = await prisma.person.findFirst({
    where: { id: personId, ...writablePeopleWhere(userId) },
    select: { id: true },
  });
  return found !== null;
}

export async function canWriteEvent(userId: string, eventId: string): Promise<boolean> {
  const found = await prisma.event.findFirst({
    where: { id: eventId, ...writableEventsWhere(userId) },
    select: { id: true },
  });
  return found !== null;
}

// --- guards ---------------------------------------------------------------

/**
 * Returns the person if the user may edit it, else throws.
 *
 * Yields `ownerId` and `addToGoogle` as well as the id, because callers acting on a
 * shared record almost always need them next — the owner decides which field
 * definitions and labels apply, and whether the record belongs in Google at all.
 * The row is already being read for the access check, so returning it saves a
 * second query rather than costing anything.
 */
export async function requireWritablePerson(
  userId: string,
  personId: string,
): Promise<{ id: string; ownerId: string; addToGoogle: boolean }> {
  const found = await prisma.person.findFirst({
    where: { id: personId, ...writablePeopleWhere(userId) },
    select: { id: true, ownerId: true, addToGoogle: true },
  });
  if (!found) throw new AccessDeniedError();
  return found;
}

export async function requireWritableEvent(
  userId: string,
  eventId: string,
): Promise<string> {
  const found = await prisma.event.findFirst({
    where: { id: eventId, ...writableEventsWhere(userId) },
    select: { id: true },
  });
  if (!found) throw new AccessDeniedError();
  return found.id;
}

/** Verify a set of person ids are all readable — used when attaching attendees. */
export async function filterReadablePeopleIds(
  userId: string,
  personIds: readonly string[],
): Promise<string[]> {
  if (personIds.length === 0) return [];
  const rows = await prisma.person.findMany({
    where: { id: { in: [...personIds] }, ...readablePeopleWhere(userId) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

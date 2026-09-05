import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isThankYouManagerEmail } from "@/lib/thank-you-managers";
// Type-only: the query language is handed its clauses by loadViewer below rather than
// importing this module, so that a client component importing people-filter.ts does not
// reach auth.ts through it. See the note in search/predicates.ts.
import type { Viewer } from "@/lib/search/predicates";

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
 * Deleting is a soft delete. Every clause below filters `deletedAt: null`, so a trashed
 * contact or event is invisible in every list, search, export, picker and sync push
 * without any of those needing to know that a trash can exists. Getting at the trash means
 * asking for it explicitly, through trashedPeopleWhere / trashedEventsWhere.
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
    // Trashed contacts are invisible everywhere, for everybody, including whoever they
    // were shared with. This one line is what a soft delete needs to be safe, and it is
    // only enough because every read goes through a clause in this file.
    deletedAt: null,
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
    deletedAt: null,
    OR: [
      { ownerId: userId },
      { shares: { some: { withUserId: userId, permission: "EDIT" } } },
      {
        owner: {
          sharesGiven: {
            some: {
              withUserId: userId,
              scope: "ALL_PEOPLE",
              permission: "EDIT",
            },
          },
        },
      },
    ],
  };
}

export function readableEventsWhere(userId: string): Prisma.EventWhereInput {
  return {
    deletedAt: null,
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
    deletedAt: null,
    OR: [
      { ownerId: userId },
      { shares: { some: { withUserId: userId, permission: "EDIT" } } },
      {
        owner: {
          sharesGiven: {
            some: {
              withUserId: userId,
              scope: "ALL_EVENTS",
              permission: "EDIT",
            },
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
  return { recipients: { some: { person: readablePeopleWhere(userId) } } };
}

export function writableGiftsWhere(userId: string): Prisma.GiftWhereInput {
  return { recipients: { some: { person: writablePeopleWhere(userId) } } };
}

/**
 * Whose thank-yous this user may write.
 *
 * Returns contact-card ids, not people: a thank-you is signed by whoever sends it, so
 * the question is never "whose record may I edit" — you may edit the contacts of
 * everyone you have ever recorded — but "who am I entitled to speak for".
 *
 * Two answers qualify. Your own card, always. And the card of any user who has ticked
 * *allow the head of household to write my thank-yous*, if you are that head — which is
 * how a parent writes a small child's notes. The permission is granted by the person
 * being spoken for and by nobody else, which is why it is read from their settings
 * rather than from the head's.
 *
 * A contact who is not a user of this install therefore has nobody to write for them,
 * and that is intended rather than an omission: thank-yous are sent by the people using
 * Hearth. A recipient who needs one written has an account.
 */
export async function thankableCardIds(userId: string): Promise<Set<string>> {
  const isManager = await isThankYouManager(userId);
  const rows = await prisma.person.findMany({
    where: thankableCardsWhere(userId, isManager),
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * The same question as a where-clause, so it can be a condition inside a larger query.
 *
 * One definition for both: the id list above is what an action needs to check a request,
 * and this is what `has:unthanked` needs to ask "does this contact owe anybody a note" in
 * one round trip instead of loading every gift. Two spellings of a permission rule is how
 * one of them comes to be fixed alone.
 *
 * Narrower than the id list used to be in one respect, deliberately: a card in the trash is
 * not thankable, because a trashed contact is invisible everywhere else too.
 */
/**
 * Whether this user is a thank-you manager.
 *
 * Read from the environment against their address, never from a column — see
 * `thank-you-managers.ts` for why. One query, because the role is about the person and the session
 * carries only what Auth.js put in it.
 */
export async function isThankYouManager(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return isThankYouManagerEmail(me?.email);
}

/**
 * Whose outstanding thank-yous this viewer may see.
 *
 * The ONE place the sharing boundary is deliberately crossed, and only for the thank-yous
 * page: a thank-you manager sees every user's outstanding notes, which means seeing gift
 * descriptions and giver names from households they cannot otherwise read. That is the
 * point of the role, and it is expressed here rather than inlined in the page because a
 * second way to read a gift is exactly what `access.ts` exists to prevent.
 *
 * Everyone else gets `thankableCardsWhere` unchanged — their own card, plus anybody who
 * ticked "let the head of the household write my thank-yous" if they are that head.
 *
 * "Every user's" means every card LINKED to a user. A contact who is not a user has nobody
 * to write for them, which is the same answer `thankableCardsWhere` gives and not a gap.
 */
export async function thankYouAuditCardsWhere(
  userId: string,
): Promise<{ cards: Prisma.PersonWhereInput; everyone: boolean }> {
  const isManager = await isThankYouManager(userId);
  if (!isManager)
    return { cards: thankableCardsWhere(userId, false), everyone: false };
  return {
    cards: { deletedAt: null, linkedUserId: { not: null } },
    everyone: true,
  };
}

export function thankableCardsWhere(
  userId: string,
  isManager: boolean,
): Prisma.PersonWhereInput {
  return {
    deletedAt: null,
    OR: [
      // Your own card, always.
      { linkedUserId: userId },
      // And anybody who ticked "let a thank-you manager write my thank-yous", if you are
      // one. The relation implies linkedUserId is set, so no separate test.
      //
      // This was the head of the household until now. The two roles answer different
      // questions — the head owns the household's contact cards and can hand that custody
      // over, while writing somebody's letters for them is an errand — and tying the second
      // to the first meant you could not have one without the other.
      ...(isManager
        ? [{ linkedUser: { settings: { allowManagerThankYous: true } } }]
        : []),
    ],
  };
}

export async function isHeadOfHousehold(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { isHeadOfHousehold: true },
  });
  return me?.isHeadOfHousehold ?? false;
}

/**
 * Everything the query language needs to know about who is asking.
 *
 * Assembled here, in the access module, because every clause in it is an access decision;
 * the search code receives them and cannot compute its own. One extra query, for the head
 * of the household flag — which is read from the database rather than the session so that
 * promoting somebody takes effect on their next page load rather than their next sign-in.
 * Callers put this in the Promise.all they already have, so it costs no extra round trip.
 */
export async function loadViewer(userId: string): Promise<Viewer> {
  const isManager = await isThankYouManager(userId);
  return {
    id: userId,
    isThankYouManager: isManager,
    readablePeople: readablePeopleWhere(userId),
    readableEvents: readableEventsWhere(userId),
    thankableCards: thankableCardsWhere(userId, isManager),
  };
}

/** Deleting is the owner's alone, whatever has been shared. */
export function ownedPeopleWhere(userId: string): Prisma.PersonWhereInput {
  return { ownerId: userId, deletedAt: null };
}

export function ownedEventsWhere(userId: string): Prisma.EventWhereInput {
  return { ownerId: userId, deletedAt: null };
}

/**
 * What is in the trash, which only its owner may see.
 *
 * A separate pair of clauses rather than a flag on the ones above, so that no ordinary
 * query can be talked into including deleted records by passing an argument. Reaching the
 * trash means asking for it by name.
 *
 * Sharing does not extend here. A contact shared with you and then deleted by its owner is
 * gone as far as you are concerned; whether it is recoverable is theirs to decide, and
 * their bin is not a place you can look.
 */
export function trashedPeopleWhere(userId: string): Prisma.PersonWhereInput {
  return { ownerId: userId, deletedAt: { not: null } };
}

export function trashedEventsWhere(userId: string): Prisma.EventWhereInput {
  return { ownerId: userId, deletedAt: { not: null } };
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

export async function canWritePerson(
  userId: string,
  personId: string,
): Promise<boolean> {
  const found = await prisma.person.findFirst({
    where: { id: personId, ...writablePeopleWhere(userId) },
    select: { id: true },
  });
  return found !== null;
}

export async function canWriteEvent(
  userId: string,
  eventId: string,
): Promise<boolean> {
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

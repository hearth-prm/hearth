import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Authorisation boundary.
 *
 * Every query that reads or writes user data goes through a `*Where` helper or
 * a `require*` guard from this module — none of them inline `{ ownerId }`
 * themselves. Today the rules are pure ownership; when record sharing lands
 * (M4) the read clauses become `OR: [{ ownerId }, { shares: { some: ... } }]`
 * and the write clauses gain a permission check, and nothing outside this file
 * has to change.
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
  return { ownerId: userId };
}

export function writablePeopleWhere(userId: string): Prisma.PersonWhereInput {
  return { ownerId: userId };
}

export function readableEventsWhere(userId: string): Prisma.EventWhereInput {
  return { ownerId: userId };
}

export function writableEventsWhere(userId: string): Prisma.EventWhereInput {
  return { ownerId: userId };
}

// --- guards ---------------------------------------------------------------

/** Returns the id if the user may edit this person, else throws. */
export async function requireWritablePerson(
  userId: string,
  personId: string,
): Promise<string> {
  const found = await prisma.person.findFirst({
    where: { id: personId, ...writablePeopleWhere(userId) },
    select: { id: true },
  });
  if (!found) throw new AccessDeniedError();
  return found.id;
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

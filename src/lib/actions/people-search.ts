"use server";

import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUserForAction } from "@/lib/access";

export interface PersonHit {
  id: string;
  displayName: string;
  detail: string | null;
}

const MAX_HITS = 10;

/**
 * Typeahead search over people.
 *
 * Wildcarded at both ends — Prisma's `contains` is a LIKE '%q%' — so "ell" finds
 * both "Ellery" and "Campbell". Deliberately unanchored: someone searching a
 * contact list is usually recalling a fragment, not a prefix.
 *
 * Also matches organisation and email, because "the person from Acme" or a
 * half-remembered address is often all you have.
 */
export async function searchPeople(
  query: string,
  options: { excludeEventId?: string } = {},
): Promise<PersonHit[]> {
  const user = await requireUserForAction();
  return findPeopleMatching(user.id, query, options);
}

/**
 * The query itself, separated from the auth wrapper above.
 *
 * Split so it can be exercised directly: anything calling requireUserForAction
 * reads request headers, which only exist inside a request, so the search
 * behaviour would otherwise be untestable outside a browser.
 */
export async function findPeopleMatching(
  ownerId: string,
  query: string,
  options: { excludeEventId?: string } = {},
): Promise<PersonHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const people = await prisma.person.findMany({
    where: {
      AND: [
        readablePeopleWhere(ownerId),
        options.excludeEventId
          ? { eventAttendances: { none: { eventId: options.excludeEventId } } }
          : {},
        {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { nickname: { contains: q, mode: "insensitive" } },
            { organization: { contains: q, mode: "insensitive" } },
            { contactPoints: { some: { value: { contains: q, mode: "insensitive" } } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      organization: true,
      contactPoints: {
        where: { kind: "EMAIL" },
        orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
        take: 1,
        select: { value: true },
      },
    },
    orderBy: { displayName: "asc" },
    take: MAX_HITS,
  });

  return people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    // Enough to tell two people with the same name apart.
    detail: p.organization || p.contactPoints[0]?.value || null,
  }));
}

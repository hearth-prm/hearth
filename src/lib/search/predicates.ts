import type { ContactKind, Prisma } from "@prisma/client";
// Type-only, so this module never imports people-filter at runtime and the dependency runs
// one way: people-filter -> compile -> predicates.
import type { GoogleState, Relation } from "@/lib/people-filter";

/**
 * The clause builders shared by the filter chips and the query language.
 *
 * They live here rather than in people-filter.ts because both sides need them and the
 * alternative is either a circular import or two copies of the "waiting to sync" subtlety
 * below — which is exactly the sort of thing that gets fixed in one copy.
 */

export function relationClause(
  relation: Relation,
  userId: string,
): Prisma.PersonWhereInput {
  /**
   * "Somebody else can see this" is two different facts: a share naming the record, or a
   * blanket grant from its owner that sweeps it up. A blanket grant is not recorded per
   * record — that is the whole point of it — so it has to be tested through the owner.
   */
  const visibleToSomeoneElse: Prisma.PersonWhereInput = {
    OR: [
      { shares: { some: {} } },
      { owner: { sharesGiven: { some: { scope: "ALL_PEOPLE" } } } },
    ],
  };

  switch (relation) {
    case "mine":
      return { ownerId: userId };
    case "shared-with-me":
      return { ownerId: { not: userId } };
    case "shared-by-me":
      return { ownerId: userId, ...visibleToSomeoneElse };
    case "private":
      return { ownerId: userId, NOT: visibleToSomeoneElse };
  }
}

export function googleClause(
  state: GoogleState,
  userId: string,
): Prisma.PersonWhereInput {
  switch (state) {
    case "on":
      return { addToGoogle: true };
    case "off":
      return { addToGoogle: false };
    case "synced":
      return { googleSyncs: { some: { userId, googleSyncStatus: "SYNCED" } } };
    case "error":
      return { googleSyncs: { some: { userId, googleSyncStatus: "ERROR" } } };
    case "pending":
      // A contact with no PersonSync row for this account has never been pushed, so it is
      // waiting just as much as one explicitly marked PENDING. Leaving that case out would
      // make the filter miss every newly added contact.
      return {
        addToGoogle: true,
        OR: [
          { googleSyncs: { some: { userId, googleSyncStatus: "PENDING" } } },
          { googleSyncs: { none: { userId } } },
        ],
      };
  }
}

/** What `has:` can ask about, and the clause for each. */
export const PRESENCE: Record<string, Prisma.PersonWhereInput> = {
  email: { contactPoints: { some: { kind: "EMAIL" } } },
  phone: { contactPoints: { some: { kind: "PHONE" } } },
  address: { contactPoints: { some: { kind: "ADDRESS" } } },
  url: { contactPoints: { some: { kind: "URL" } } },
  photo: { photos: { some: {} } },
  label: { labels: { some: {} } },
  notes: { notes: { not: null } },
  birthday: { birthday: { not: null } },
  organisation: { organization: { not: null } },
  organization: { organization: { not: null } },
  nickname: { nickname: { not: null } },
};

/** Text search across the columns and contact points a person is findable by. */
export function anywhereClause(q: string): Prisma.PersonWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" } as const;
  return {
    OR: [
      { displayName: contains },
      { nickname: contains },
      { organization: contains },
      { jobTitle: contains },
      { notes: contains },
      { contactPoints: { some: { value: contains } } },
      // Labels are searchable by name too: typing "family" into the box should find the
      // label's members even if the user never touched the filter UI.
      { labels: { some: { label: { name: contains } } } },
    ],
  };
}

/** Contact-point kinds addressable by name in a query. */
export const POINT_KINDS: Record<string, ContactKind> = {
  email: "EMAIL",
  phone: "PHONE",
  url: "URL",
  website: "URL",
  address: "ADDRESS",
  social: "SOCIAL",
  chat: "IM",
  im: "IM",
  sip: "SIP",
  calendar: "CALENDAR",
  keyword: "KEYWORD",
  interest: "INTEREST",
  skill: "SKILL",
  occupation: "OCCUPATION",
  location: "LOCATION",
};

/** Parts of a structured address, by the names somebody would type. */
export const ADDRESS_PARTS: Record<string, string> = {
  street: "streetAddress",
  city: "city",
  town: "city",
  region: "region",
  state: "region",
  county: "region",
  postcode: "postalCode",
  postalcode: "postalCode",
  zip: "postalCode",
  country: "country",
  pobox: "poBox",
};

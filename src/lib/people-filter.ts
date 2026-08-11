import type { Prisma } from "@prisma/client";
import { readablePeopleWhere } from "@/lib/access";

/**
 * Contact list filtering.
 *
 * Kept as a pure translation from URL parameters to a Prisma where-clause so the
 * filters are expressible as links — a filtered list can be bookmarked, shared with
 * yourself, and hit Back out of. That is also why state lives in the URL rather than
 * in component state: a label chip anywhere in the app can link straight to
 * "contacts labelled Family" without coordinating with the list page.
 *
 * Every clause is ANDed with readablePeopleWhere, so no filter can widen what the
 * viewer is allowed to see — filters narrow, access decides.
 */

/** How a contact relates to the viewer. */
export const RELATIONS = ["mine", "private", "shared-by-me", "shared-with-me"] as const;
export type Relation = (typeof RELATIONS)[number];

export const RELATION_LABELS: Record<Relation, string> = {
  mine: "Mine",
  private: "Mine, not shared",
  "shared-by-me": "Shared by me",
  "shared-with-me": "Shared with me",
};

/** Google state, as it stands for the viewer's own account. */
export const GOOGLE_STATES = ["on", "off", "synced", "pending", "error"] as const;
export type GoogleState = (typeof GOOGLE_STATES)[number];

export const GOOGLE_STATE_LABELS: Record<GoogleState, string> = {
  on: "Add to Google on",
  off: "Add to Google off",
  synced: "Synced to my Google",
  pending: "Waiting to sync",
  error: "Sync failed",
};

export const HAS_OPTIONS = ["email", "phone", "no-email"] as const;
export type HasOption = (typeof HAS_OPTIONS)[number];

export const HAS_LABELS: Record<HasOption, string> = {
  email: "Has an email",
  phone: "Has a phone",
  "no-email": "No email",
};

export interface PeopleFilter {
  q: string;
  labelIds: string[];
  /** True when every selected label must be present, rather than any of them. */
  allLabels: boolean;
  relation: Relation | null;
  google: GoogleState | null;
  has: HasOption | null;
}

/** Raw searchParams as Next.js hands them over. */
export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function many(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(list.map((v) => v.trim()).filter(Boolean))];
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseFilter(params: RawParams): PeopleFilter {
  return {
    q: one(params.q),
    labelIds: many(params.label),
    allLabels: one(params.labelMode) === "all",
    relation: pick(one(params.rel), RELATIONS),
    google: pick(one(params.google), GOOGLE_STATES),
    has: pick(one(params.has), HAS_OPTIONS),
  };
}

export function isFilterActive(f: PeopleFilter): boolean {
  return Boolean(
    f.q || f.labelIds.length || f.relation || f.google || f.has,
  );
}

/** Text search across the columns and contact points a person is findable by. */
function searchClause(q: string): Prisma.PersonWhereInput {
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
      // Labels are searchable by name too: typing "family" into the box should
      // find the label's members even if the user never touched the filter UI.
      { labels: { some: { label: { name: contains } } } },
    ],
  };
}

function labelClause(f: PeopleFilter): Prisma.PersonWhereInput {
  if (f.labelIds.length === 0) return {};
  if (!f.allLabels) {
    return { labels: { some: { labelId: { in: f.labelIds } } } };
  }
  // "All of these" cannot be one `some`: a single PersonLabel row matches one label,
  // so requiring three means three separate existence checks.
  return { AND: f.labelIds.map((labelId) => ({ labels: { some: { labelId } } })) };
}

function relationClause(relation: Relation, userId: string): Prisma.PersonWhereInput {
  /**
   * "Somebody else can see this" is two different facts: a share naming the record,
   * or a blanket grant from its owner that sweeps it up. A blanket grant is not
   * recorded per record — that is the whole point of it — so it has to be tested
   * through the owner.
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

function googleClause(state: GoogleState, userId: string): Prisma.PersonWhereInput {
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
      // A contact with no PersonSync row for this account has never been pushed, so
      // it is waiting just as much as one explicitly marked PENDING. Leaving that
      // case out would make the filter miss every newly added contact.
      return {
        addToGoogle: true,
        OR: [
          { googleSyncs: { some: { userId, googleSyncStatus: "PENDING" } } },
          { googleSyncs: { none: { userId } } },
        ],
      };
  }
}

function hasClause(has: HasOption): Prisma.PersonWhereInput {
  switch (has) {
    case "email":
      return { contactPoints: { some: { kind: "EMAIL" } } };
    case "phone":
      return { contactPoints: { some: { kind: "PHONE" } } };
    case "no-email":
      return { contactPoints: { none: { kind: "EMAIL" } } };
  }
}

/** The complete where-clause: access first, then every active filter. */
export function peopleWhere(
  f: PeopleFilter,
  userId: string,
): Prisma.PersonWhereInput {
  const clauses: Prisma.PersonWhereInput[] = [readablePeopleWhere(userId)];

  if (f.q) clauses.push(searchClause(f.q));
  const labels = labelClause(f);
  if (Object.keys(labels).length) clauses.push(labels);
  if (f.relation) clauses.push(relationClause(f.relation, userId));
  if (f.google) clauses.push(googleClause(f.google, userId));
  if (f.has) clauses.push(hasClause(f.has));

  return { AND: clauses };
}

/**
 * Rebuild a query string with one parameter changed.
 *
 * Filters have to compose — picking a label should not discard the search term —
 * and every control is a link, so each one needs the current state plus its own
 * change. Passing null removes a parameter, which is how "clear this filter" works.
 */
export function filterHref(
  f: PeopleFilter,
  change: Partial<Record<"q" | "rel" | "google" | "has" | "label" | "labelMode", string | string[] | null>>,
): string {
  const params = new URLSearchParams();

  const current: Record<string, string | string[]> = {
    q: f.q,
    rel: f.relation ?? "",
    google: f.google ?? "",
    has: f.has ?? "",
    label: f.labelIds,
    labelMode: f.allLabels ? "all" : "",
  };

  for (const key of ["q", "rel", "google", "has", "label", "labelMode"] as const) {
    const next = key in change ? change[key] : current[key];
    if (next === null || next === undefined) continue;
    for (const v of Array.isArray(next) ? next : [next]) {
      if (v) params.append(key, v);
    }
  }

  const qs = params.toString();
  return qs ? `/people?${qs}` : "/people";
}

/** Toggle one label in or out of the current selection. */
export function toggleLabelHref(f: PeopleFilter, labelId: string): string {
  const next = f.labelIds.includes(labelId)
    ? f.labelIds.filter((id) => id !== labelId)
    : [...f.labelIds, labelId];
  return filterHref(f, { label: next });
}

import type { Prisma } from "@prisma/client";
import { readablePeopleWhere } from "@/lib/access";
import type { FieldDef } from "@/lib/fields/types";
import { compileQuery, QueryError } from "@/lib/search/compile";
import { googleClause, relationClause } from "@/lib/search/predicates";

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

/**
 * Parameters the list page understands that are NOT filters.
 *
 * Listed so the export link and filter links can drop them: carrying a one-off
 * confirmation into every subsequent URL would make it reappear on every click.
 */
export const NON_FILTER_PARAMS = ["gave", "kept"] as const;

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

function labelClause(f: PeopleFilter): Prisma.PersonWhereInput {
  if (f.labelIds.length === 0) return {};
  if (!f.allLabels) {
    return { labels: { some: { labelId: { in: f.labelIds } } } };
  }
  // "All of these" cannot be one `some`: a single PersonLabel row matches one label,
  // so requiring three means three separate existence checks.
  return { AND: f.labelIds.map((labelId) => ({ labels: { some: { labelId } } })) };
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

/**
 * The complete where-clause: access first, then every active filter.
 *
 * `q` is a query language now rather than a bare phrase, and the two are compatible on
 * purpose: anything without a `field:` prefix is still the seven-column text search it always
 * was, so every bookmarked URL keeps meaning what it meant. The chips are unchanged and ANDed
 * alongside, which is why they can stay while the language grows.
 *
 * A registry is needed to resolve custom field names. A caller without one gets the language
 * minus custom fields rather than an error — a where-clause builder is not the place to make
 * loading the registry compulsory.
 */
export function peopleWhere(
  f: PeopleFilter,
  userId: string,
  registry: readonly FieldDef[] = [],
): Prisma.PersonWhereInput {
  const clauses: Prisma.PersonWhereInput[] = [readablePeopleWhere(userId)];

  if (f.q) {
    try {
      clauses.push(compileQuery(f.q, userId, registry).where);
    } catch (err) {
      // A malformed query narrows to nothing rather than widening to everything. The page
      // reports the message through parsePeopleQuery; this is the safety net for callers that
      // only want a clause — the export endpoint and the bulk actions.
      if (!(err instanceof QueryError)) throw err;
      clauses.push({ id: "" });
    }
  }
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

export interface FilterPill {
  /** Stable key for React, and what the × is removing. */
  id: string;
  label: string;
  /** Where the × goes: the same view minus this one filter. */
  href: string;
}

/**
 * The active filters, as removable chips.
 *
 * Built here rather than in the component so "what is currently narrowing this list"
 * has one definition, shared by the chips and by the count line. Label names have to
 * be supplied because only the caller has them — the filter itself holds ids.
 */
export function activePills(
  f: PeopleFilter,
  labelNames: ReadonlyMap<string, string>,
): FilterPill[] {
  const pills: FilterPill[] = [];

  if (f.q) {
    pills.push({ id: "q", label: `“${f.q}”`, href: filterHref(f, { q: null }) });
  }
  if (f.relation) {
    pills.push({
      id: "rel",
      label: RELATION_LABELS[f.relation],
      href: filterHref(f, { rel: null }),
    });
  }
  if (f.google) {
    pills.push({
      id: "google",
      label: GOOGLE_STATE_LABELS[f.google],
      href: filterHref(f, { google: null }),
    });
  }
  if (f.has) {
    pills.push({ id: "has", label: HAS_LABELS[f.has], href: filterHref(f, { has: null }) });
  }
  for (const id of f.labelIds) {
    pills.push({
      id: `label:${id}`,
      // A label whose name is unknown was probably deleted; showing the raw id would
      // be worse than admitting it.
      label: labelNames.get(id) ?? "unknown label",
      href: toggleLabelHref(f, id),
    });
  }
  return pills;
}

/** Toggle one label in or out of the current selection. */
export function toggleLabelHref(f: PeopleFilter, labelId: string): string {
  const next = f.labelIds.includes(labelId)
    ? f.labelIds.filter((id) => id !== labelId)
    : [...f.labelIds, labelId];
  return filterHref(f, { label: next });
}

/**
 * The query, and anything worth saying about it.
 *
 * Separate from peopleWhere because a page wants the message and a clause builder does not:
 * the export endpoint and the bulk actions need a clause and nothing else, while the list
 * needs to say "there is a quote without a closing quote" beside the box.
 */
export function parsePeopleQuery(
  q: string,
  userId: string,
  registry: readonly FieldDef[],
): { error: string | null; warnings: string[] } {
  if (!q) return { error: null, warnings: [] };
  try {
    return { error: null, warnings: compileQuery(q, userId, registry).warnings };
  } catch (err) {
    if (err instanceof QueryError) return { error: err.message, warnings: [] };
    throw err;
  }
}

import type { Prisma } from "@prisma/client";
import type { FieldDef } from "@/lib/fields/types";
import { chipsFromQuery } from "@/lib/search/chips";
import { compileQuery, QueryError, type SemanticRequest } from "@/lib/search/compile";
import {
  googleClause,
  presenceClause,
  relationClause,
  type Viewer,
} from "@/lib/search/predicates";

/**
 * Contact list filtering.
 *
 * Kept as a pure translation from URL parameters to a Prisma where-clause so the
 * filters are expressible as links — a filtered list can be bookmarked, shared with
 * yourself, and hit Back out of. That is also why state lives in the URL rather than
 * in component state: a label chip anywhere in the app can link straight to
 * "contacts labelled Family" without coordinating with the list page.
 *
 * Every clause is ANDed with the viewer's own readable-people clause, so no filter can
 * widen what the viewer is allowed to see — filters narrow, access decides. The clause is
 * passed in rather than imported because a client component imports this module for its
 * links and labels, and an import of access.ts here puts auth.ts and googleapis one
 * tree-shake away from the browser bundle.
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

/**
 * The Details section of the Filter menu.
 *
 * Deliberately a short curated list where `has:` in the query language has forty options: a
 * menu is read top to bottom by somebody who does not yet know what they want, and forty
 * entries in a dropdown is not a menu. These are the questions worth a single click; the
 * rest are worth typing.
 *
 * A `no-` prefix negates the option it names, which is how one enum covers both directions
 * without a second table to keep in step.
 */
export const HAS_OPTIONS = [
  "email",
  "no-email",
  "phone",
  "no-phone",
  "address",
  "photo",
  "birthday",
  "unthanked",
] as const;
export type HasOption = (typeof HAS_OPTIONS)[number];

export const HAS_LABELS: Record<HasOption, string> = {
  email: "Has an email",
  "no-email": "No email",
  phone: "Has a phone",
  "no-phone": "No phone",
  address: "Has an address",
  photo: "Has a picture",
  birthday: "Has a birthday",
  unthanked: "Needs a thank-you",
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

/**
 * The chip and the query language answer the same question with the same clause.
 *
 * Written out separately at first, which meant `has=email` in a URL and `has:email` in the
 * box were two implementations of one idea — and the sort of pair where a fix lands on one of
 * them. The presence table is now the only definition; a `no-` option is its negation.
 */
function hasClause(has: HasOption, viewer: Viewer): Prisma.PersonWhereInput {
  const negated = has.startsWith("no-");
  const key = negated ? has.slice(3) : has;
  const clause = presenceClause(key, viewer);
  // Unreachable while HAS_OPTIONS only names presence keys, which §29.17 checks. Narrowed
  // rather than asserted so that adding an option the table does not know cannot silently
  // become "match everything".
  if (!clause) return { id: "" };
  return negated ? { NOT: clause } : clause;
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
  viewer: Viewer,
  registry: readonly FieldDef[] = [],
): Prisma.PersonWhereInput {
  const clauses: Prisma.PersonWhereInput[] = [viewer.readablePeople];

  if (f.q) {
    try {
      clauses.push(compileQuery(f.q, viewer, registry).where);
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
  if (f.relation) clauses.push(relationClause(f.relation, viewer));
  if (f.google) clauses.push(googleClause(f.google, viewer));
  if (f.has) clauses.push(hasClause(f.has, viewer));

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
  const qs = filterSearch(f, change);
  return qs ? `/people?${qs}` : "/people";
}

/**
 * The same thing as a bare search string.
 *
 * Split out because a saved filter stores exactly this: "the list I was looking at" is its URL,
 * and restoring one is then a navigation rather than a second way of setting the same state.
 */
export function filterSearch(
  f: PeopleFilter,
  change: Partial<Record<"q" | "rel" | "google" | "has" | "label" | "labelMode", string | string[] | null>> = {},
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

  return params.toString();
}

/** A stored search string back to the shape parseFilter reads. */
export function rawParamsFromSearch(search: string): RawParams {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  const out: RawParams = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    // `label` repeats and the rest do not, so the shape follows the data rather than a list of
    // which keys are plural — one less thing to keep in step with parseFilter.
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
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
/**
 * The filter dimensions that are still URL PARAMETERS rather than query terms.
 *
 * `q` is deliberately absent: the search box renders it as a row of chips, one per term. It
 * used to be one pill here, and suppressing it by passing a blanked filter was a bug worth
 * remembering — every pill's remove link is built from the filter it is handed, so a blanked
 * `q` meant removing a label also cleared the search.
 */
export function activePills(
  f: PeopleFilter,
  labelNames: ReadonlyMap<string, string>,
): FilterPill[] {
  const pills: FilterPill[] = [];

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

/**
 * A filter in words, for the hover text on a saved one.
 *
 * Built from the same chip decomposition the box renders, so the tooltip says what the chips
 * would say if you loaded it — rather than a second description that drifts from the first.
 */
export function describeFilter(
  f: PeopleFilter,
  labelNames: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  if (f.q) {
    const row = chipsFromQuery(f.q);
    parts.push(
      row && row.chips.length > 0
        ? row.chips
            .map((chip, i) => (i === 0 ? chip : `${row.connectors[i - 1]!.toUpperCase()} ${chip}`))
            .join(" ")
        : f.q,
    );
  }
  for (const pill of activePills(f, labelNames)) parts.push(pill.label);
  return parts.length > 0 ? parts.join(" · ") : "everything";
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
  viewer: Viewer,
  registry: readonly FieldDef[],
): { error: string | null; warnings: string[]; semantic?: SemanticRequest } {
  if (!q) return { error: null, warnings: [] };
  try {
    const compiled = compileQuery(q, viewer, registry);
    return {
      error: null,
      warnings: compiled.warnings,
      ...(compiled.semantic ? { semantic: compiled.semantic } : {}),
    };
  } catch (err) {
    if (err instanceof QueryError) return { error: err.message, warnings: [] };
    throw err;
  }
}

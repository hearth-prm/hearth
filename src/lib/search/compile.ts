import type { Prisma } from "@prisma/client";
import type { FieldDef } from "@/lib/fields/types";
import { GOOGLE_STATES, RELATIONS, type GoogleState, type Relation } from "@/lib/people-filter";
import {
  ADDRESS_PARTS,
  ALSO_POINT,
  COLUMNS,
  FIELD_KEYS,
  FIELD_LABELS,
  POINT_KINDS,
  PRESENCE_KEYS,
  PRESENCE_LABELS,
  anywhereClause,
  googleClause,
  presenceClause,
  relationClause,
  type Viewer,
} from "./predicates";
import { QueryError, parseQuery, type Comparison, type Node, type Term } from "./parse";
import type { Vocabulary } from "./suggest";

/**
 * Syntax tree to Prisma where-clause.
 *
 * The clause this returns is meant to be ANDed with readablePeopleWhere and never to replace
 * it. That is not a convention: `compileQuery` returns one object which the caller wraps, and
 * an OR inside it can only ever be an OR between predicates, so no query can widen what its
 * asker may see. §26 checks that property directly by running every form of query as a second
 * user.
 *
 * Two rules about names, which between them decide how forgiving this is:
 *
 *   * an UNKNOWN field name is treated as ordinary text, so `10:30` and `re:union` keep
 *     working the way they did before there was a query language — with a warning, because a
 *     mistyped `labl:Family` would otherwise silently match nothing;
 *   * a KNOWN field with a value it cannot take is an error. `google:banana` is a mistake
 *     worth stopping for, where guessing would show a list nobody asked for.
 */

export interface Compiled {
  where: Prisma.PersonWhereInput;
  /** Things worth telling the user that are not errors. */
  warnings: string[];
  /**
   * The one predicate that is not a where-clause.
   *
   * `semantic:` ranks; it does not filter, so there is nothing to AND it into. The caller
   * resolves it after the SQL half has run — see search/resolve.ts — which is also what makes
   * it rank WITHIN what the rest of the query and the access clauses allowed.
   */
  semantic?: SemanticRequest;
}

export interface SemanticRequest {
  text: string;
  /** How many to keep, best first. */
  limit: number;
}

/** Field names that mean "rank by similarity to this". */
const SEMANTIC_FIELDS = ["semantic", "about", "means"];

/**
 * How many results a ranking keeps.
 *
 * A ranking has no natural cut-off — every contact has some cosine distance to every query —
 * so this is a count rather than a threshold. A threshold would have to be tuned per model
 * and would silently return everything or nothing when the model changed; a count is
 * something a person can reason about, and `semantic:nurse~50` says it out loud.
 */
const DEFAULT_SEMANTIC_LIMIT = 25;
const MAX_SEMANTIC_LIMIT = 200;

/**
 * Lift `semantic:` out of the tree, refusing the places it cannot mean anything.
 *
 * Only at the top level, and only ANDed. That is not a simplification — it is the honest
 * consequence of what an embedding is. There is no mechanism in a cosine distance for "not
 * similar to healthcare": every contact is some distance from every query, so a negated
 * ranking is either everybody or nobody depending on an arbitrary cut. `a or semantic:b` is
 * the same problem wearing a different hat. Refusing both is better than picking a meaning
 * nobody asked for, which is the mistake `>` on a text field used to make.
 *
 * Returns the tree with the semantic terms removed; null means nothing was left, i.e. the
 * query was a ranking and no filter at all.
 */
function liftSemantic(
  node: Node,
  top: boolean,
  found: SemanticRequest[],
): Node | null {
  if (node.kind === "term") {
    if (node.field === null || !SEMANTIC_FIELDS.includes(node.field.toLowerCase())) return node;
    if (!top) {
      // The message names the fix, because the fix is not obvious: `a or b semantic:c` puts
      // the ranking inside the `or` — AND binds tighter — and bracketing the `or` is what
      // somebody meant. Telling them only that it is refused leaves them to guess.
      throw new QueryError(
        `“${node.field}:” ranks results, so it cannot be negated or put inside an “or”. If you meant to rank what the “or” matched, bracket it: (a or b) ${node.field}:${node.value}`,
      );
    }
    // A trailing ~N sets how many to keep. Outside any quotes, so semantic:"a nurse"~50
    // works: the tokeniser has already dropped the quotes by the time this sees the value.
    const withCount = /^(.*?)~(\d+)$/.exec(node.value);
    const text = (withCount ? withCount[1]! : node.value).trim();
    if (!text) {
      throw new QueryError(`“${node.field}:” needs something to be similar to.`);
    }
    const asked = withCount ? Number.parseInt(withCount[2]!, 10) : DEFAULT_SEMANTIC_LIMIT;
    if (withCount && (asked < 1 || asked > MAX_SEMANTIC_LIMIT)) {
      throw new QueryError(
        `“~${withCount[2]}” is not a number of results to keep. Try 1 to ${MAX_SEMANTIC_LIMIT}.`,
      );
    }
    found.push({ text, limit: asked });
    return null;
  }
  if (node.kind === "not") {
    const inner = liftSemantic(node.node, false, found);
    return inner ? { kind: "not", node: inner } : null;
  }
  if (node.kind === "or") {
    return { kind: "or", nodes: node.nodes.map((n) => liftSemantic(n, false, found)!) };
  }
  const kept = node.nodes
    .map((n) => liftSemantic(n, top, found))
    .filter((n): n is Node => n !== null);
  if (kept.length === 0) return null;
  return kept.length === 1 ? kept[0]! : { kind: "and", nodes: kept };
}

/** Columns compared as dates rather than as text. */
const DATES: Record<string, string> = {
  birthday: "birthday",
  created: "createdAt",
  added: "createdAt",
  updated: "updatedAt",
  changed: "updatedAt",
};

/**
 * Text matching: substring by default, whole value on `=`.
 *
 * `city:Sun` finding Sun Prairie AND Sun Gorge is usually what somebody wants, which is why
 * substring is the default and there is no wildcard syntax — there would be nothing for it to
 * enable. `city:="Sun Prairie"` is the way to say only that one, and it exists because the
 * parser already accepted `=` and the compiler used to throw it away: a query that quietly
 * means something other than what it says is worse than one that is refused.
 */
function text(value: string, op: Comparison) {
  return op === "="
    ? { equals: value, mode: "insensitive" as const }
    : { contains: value, mode: "insensitive" as const };
}

/**
 * A date written the way somebody types it.
 *
 * Absolute (2026-08-01, 2026-08), or relative (30d, 6m, 1y) meaning "that long ago". Relative
 * is the form that makes `updated:>30d` read correctly: everything touched since then.
 */
function parseDate(value: string, field: string): Date {
  const relative = /^(\d+)\s*([dwmy])$/i.exec(value.trim());
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const now = new Date();
    const out = new Date(now);
    if (unit === "d") out.setUTCDate(now.getUTCDate() - n);
    if (unit === "w") out.setUTCDate(now.getUTCDate() - n * 7);
    if (unit === "m") out.setUTCMonth(now.getUTCMonth() - n);
    if (unit === "y") out.setUTCFullYear(now.getUTCFullYear() - n);
    return out;
  }

  const ymd = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!ymd) {
    throw new QueryError(
      `“${field}:${value}” is not a date. Try 2026-08-01, 2026-08, or 30d for “30 days ago”.`,
    );
  }
  return new Date(
    Date.UTC(Number(ymd[1]), ymd[2] ? Number(ymd[2]) - 1 : 0, ymd[3] ? Number(ymd[3]) : 1),
  );
}

function dateClause(column: string, op: Comparison, value: string, field: string) {
  const at = parseDate(value, field);
  switch (op) {
    case "<":
      return { [column]: { lt: at } };
    case "<=":
      return { [column]: { lte: at } };
    case ">":
      return { [column]: { gt: at } };
    case ">=":
      return { [column]: { gte: at } };
    default: {
      // A bare date means that day, or that month if no day was given — "created:2026-08" is
      // a question about August, not about the first of it.
      const end = new Date(at);
      if (/^\d{4}$/.test(value.trim())) end.setUTCFullYear(at.getUTCFullYear() + 1);
      else if (/^\d{4}-\d{2}$/.test(value.trim())) end.setUTCMonth(at.getUTCMonth() + 1);
      else end.setUTCDate(at.getUTCDate() + 1);
      return { [column]: { gte: at, lt: end } };
    }
  }
}

function oneOf(value: string, allowed: readonly string[], field: string): string {
  const lower = value.toLowerCase();
  if (!allowed.includes(lower)) {
    throw new QueryError(
      `“${field}:${value}” is not something ${field} can be. Try ${allowed.join(", ")}.`,
    );
  }
  return lower;
}

function compileTerm(
  term: Term,
  viewer: Viewer,
  custom: Map<string, FieldDef>,
  warnings: string[],
): Prisma.PersonWhereInput {
  if (term.field === null) return anywhereClause(term.value);

  const field = term.field.toLowerCase();
  const value = term.value;

  // A comparison only means something on a date. Accepting `org:>Acme` and quietly treating
  // it as a substring search is how a query comes to mean something other than it says.
  if ((term.op === "<" || term.op === ">" || term.op === "<=" || term.op === ">=") &&
      !(field in DATES)) {
    throw new QueryError(
      `“${term.op}” only works on a date. For an exact match use ${field}:=${value}.`,
    );
  }

  // The bare-word search, spelled out.
  //
  // Exists so a chip can say what the URL says: a word with no field prints as `like:bob`,
  // and a chip whose label differs from the query it stands for is the bug the chip row is
  // built to avoid. Typing it by hand does the same thing a bare word does.
  if (field === "like" || field === "text" || field === "anywhere") {
    return anywhereClause(value);
  }
  if (field === "label") {
    return { labels: { some: { label: { name: text(value, term.op) } } } };
  }
  if (field === "has") {
    const clause = presenceClause(value, viewer);
    if (!clause) {
      // Truncated on purpose: there are forty-odd of these and an error message that lists
      // them all is one nobody reads. The panel under the box has the whole list.
      throw new QueryError(
        `“has:${value}” is not something to look for. Try ${PRESENCE_KEYS.slice(0, 10).join(
          ", ",
        )} — the panel under the search box lists them all.`,
      );
    }
    return clause;
  }
  if (field === "google" || field === "sync") {
    return googleClause(oneOf(value, GOOGLE_STATES, field) as GoogleState, viewer);
  }
  if (field === "is" || field === "rel" || field === "relation") {
    return relationClause(oneOf(value, RELATIONS, field) as Relation, viewer);
  }
  if (field in DATES) {
    return dateClause(DATES[field]!, term.op, value, field);
  }
  if (field in ADDRESS_PARTS) {
    return {
      contactPoints: {
        some: { kind: "ADDRESS", [ADDRESS_PARTS[field]!]: text(value, term.op) },
      },
    };
  }
  if (field in POINT_KINDS) {
    return {
      contactPoints: { some: { kind: POINT_KINDS[field]!, value: text(value, term.op) } },
    };
  }
  if (field in COLUMNS) {
    const column = { [COLUMNS[field]!]: text(value, term.op) };
    // A couple of columns have a contact-point kind holding the same sort of value —
    // Google keeps one nickname on the name and any others as a list — so asking about
    // the column alone would silently miss half the answer.
    const kind = ALSO_POINT[field];
    return kind
      ? { OR: [column, { contactPoints: { some: { kind, value: text(value, term.op) } } }] }
      : column;
  }

  // A custom field, by its own key. Resolved against the ASKER's registry, because a shared
  // contact's custom values are already hidden unless the viewer has a field of that key —
  // a query must not be a way around that.
  const def = custom.get(field);
  if (def) {
    // Path-and-equals rather than contains: jsonb has no case-insensitive substring operator
    // through Prisma, and an exact match on a value somebody chose is the common case.
    return { custom: { path: [def.key], equals: value } };
  }

  // Unknown: treat the whole token as text, which is what it was before this language
  // existed, and say so rather than returning nothing for a typo.
  warnings.push(
    `“${term.field}” is not a field, so “${term.field}:${value}” was searched for as text.`,
  );
  return anywhereClause(`${term.field}:${value}`);
}

function compileNode(
  node: Node,
  viewer: Viewer,
  custom: Map<string, FieldDef>,
  warnings: string[],
): Prisma.PersonWhereInput {
  switch (node.kind) {
    case "term":
      return compileTerm(node, viewer, custom, warnings);
    case "and":
      return { AND: node.nodes.map((n) => compileNode(n, viewer, custom, warnings)) };
    case "or":
      return { OR: node.nodes.map((n) => compileNode(n, viewer, custom, warnings)) };
    case "not":
      return { NOT: compileNode(node.node, viewer, custom, warnings) };
  }
}

/**
 * Parse and compile in one call.
 *
 * Throws QueryError for anything a person can fix by retyping, which the caller turns into a
 * message beside the box. Anything else is a bug and should not be caught.
 */
export function compileQuery(
  input: string,
  viewer: Viewer,
  registry: readonly FieldDef[],
): Compiled {
  const parsed = parseQuery(input);
  if (!parsed) return { where: {}, warnings: [] };

  const semantic: SemanticRequest[] = [];
  const tree = liftSemantic(parsed, true, semantic);
  if (semantic.length > 1) {
    throw new QueryError(
      "Only one “semantic:” per search — two rankings have no combined order.",
    );
  }
  if (!tree) {
    return { where: {}, warnings: [], ...(semantic[0] ? { semantic: semantic[0] } : {}) };
  }

  const custom = new Map<string, FieldDef>();
  for (const def of registry) {
    if (!def.core) custom.set(def.key.toLowerCase(), def);
  }

  const warnings: string[] = [];
  return {
    where: compileNode(tree, viewer, custom, warnings),
    warnings,
    ...(semantic[0] ? { semantic: semantic[0] } : {}),
  };
}

/** Every field name the language accepts, for autocomplete and for the help panel. */
export function knownFields(registry: readonly FieldDef[]): string[] {
  return [
    "label",
    "has",
    "google",
    "is",
    "like",
    ...SEMANTIC_FIELDS,
    ...Object.keys(DATES),
    // The offered spelling of each, not every alias: `surname` still works, but a list
    // holding both `last` and `surname` teaches that they are different fields.
    ...FIELD_KEYS,
    ...registry.filter((d) => !d.core).map((d) => d.key),
  ].sort();
}

/**
 * Everything the search box needs to complete what somebody is typing.
 *
 * Built here rather than in the component because the answers have to be the SAME ones the
 * compiler accepts. A field offered by autocomplete that the compiler treats as text, or a
 * value it refuses, is worse than no autocomplete: it teaches the wrong language.
 */
export function searchVocabulary(
  registry: readonly FieldDef[],
  labelNames: readonly string[],
): Vocabulary {
  const describe: Record<string, string> = {
    label: "a label by name",
    has: "something a contact does or does not have",
    google: "how it stands with Google",
    is: "how it relates to you",
    like: "anywhere a bare word would look",
    ...Object.fromEntries(
      SEMANTIC_FIELDS.map((k) => [k, "what a contact is about, ranked by meaning"]),
    ),
    ...Object.fromEntries(Object.keys(DATES).map((k) => [k, "a date, or 30d for “30 days ago”"])),
    // The field's own description, from the table that defines it — so the box says
    // "middle name" rather than "the middleName field".
    ...FIELD_LABELS,
    ...Object.fromEntries(
      registry.filter((d) => !d.core).map((d) => [d.key, `your “${d.label}” field`]),
    ),
  };

  return {
    fields: knownFields(registry),
    values: {
      label: [...labelNames],
      // Each with what it means: there are forty of these, and a bare list of names is a
      // list nobody can navigate.
      has: PRESENCE_KEYS.map((k) => ({ value: k, detail: PRESENCE_LABELS[k] ?? "" })),
      google: [...GOOGLE_STATES],
      sync: [...GOOGLE_STATES],
      is: [...RELATIONS],
      rel: [...RELATIONS],
      relation: [...RELATIONS],
    },
    describe,
  };
}

export { QueryError } from "./parse";

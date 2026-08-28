import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FieldDef } from "@/lib/fields/types";
import { parsePeopleQuery, peopleWhere, type PeopleFilter } from "@/lib/people-filter";
import type { Viewer } from "./predicates";
import { embedTexts, embeddingModel } from "./embed";
import { scoreAgainst } from "./indexer";

/**
 * The whole query, including the half that is not SQL.
 *
 * `peopleWhere` answers "which contacts match" and stays synchronous, which is what lets the
 * chips and the language share it. `semantic:` cannot be answered that way — it needs a model
 * call and a sort — so it is resolved here, and every caller that decides WHICH CONTACTS
 * something applies to goes through this function.
 *
 * That last point is the one that matters. The list, the CSV export and "select all matching"
 * must agree on the set, because the next thing somebody does with a selection is bulk-edit
 * or bulk-delete it. A caller that used peopleWhere alone would silently ignore the ranking
 * and act on every contact matching the rest of the query — which for a bulk delete is the
 * worst possible place for a disagreement.
 */

export interface ResolvedQuery {
  where: Prisma.PersonWhereInput;
  /** A message to show beside the box instead of results. */
  error: string | null;
  warnings: string[];
  /**
   * Ranked ids, best first, when the query ranked. The list orders by these rather than by
   * name — for a similarity search, "closest first" is the answer, and alphabetical would
   * throw away the only thing the ranking produced.
   */
  ranked: string[] | null;
  /** What the ranking did, in words, including what it could not do. */
  note: string | null;
}

export async function resolvePeopleQuery(
  filter: PeopleFilter,
  viewer: Viewer,
  registry: readonly FieldDef[],
): Promise<ResolvedQuery> {
  const where = peopleWhere(filter, viewer, registry);
  const parsed = parsePeopleQuery(filter.q, viewer, registry);
  if (parsed.error || !parsed.semantic) {
    return {
      where,
      error: parsed.error,
      warnings: parsed.warnings,
      ranked: null,
      note: null,
    };
  }

  const { text, limit } = parsed.semantic;
  const embedded = await embedTexts([text], "query");
  if (!embedded.ok || !embedded.vectors[0]) {
    // Fail CLOSED. Ignoring the ranking would quietly widen the selection to everything
    // matching the rest of the query, and "select all" would then mean something other than
    // what the page showed. Narrowing to nothing is wrong in a way somebody can see.
    return {
      where: { id: "" },
      error: `Could not rank by meaning: ${embedded.message ?? "the model did not answer."}`,
      warnings: parsed.warnings,
      ranked: null,
      note: null,
    };
  }

  // Candidates first, ranking second: the SQL half has already applied the access clauses and
  // every other predicate, so the ranking happens inside what this viewer may see. Scoring
  // first and filtering afterwards would be the same answer only until the top matches were
  // all contacts somebody else owns.
  const candidates = await prisma.person.findMany({ where, select: { id: true } });
  const scored = await scoreAgainst(embedded.vectors[0], candidates.map((c) => c.id));
  const kept = scored.slice(0, limit);

  const unindexed = candidates.length - scored.length;
  const notes: string[] = [];
  notes.push(
    kept.length === 0
      ? "Nothing in the search index matched"
      : `Closest ${kept.length} of ${scored.length} by meaning`,
  );
  if (unindexed > 0) {
    // Said out loud, because a contact that is not indexed cannot be ranked and its absence
    // would otherwise look like an answer. Settings has the full count and a Rebuild button.
    notes.push(
      unindexed === 1
        ? "1 matching contact is not indexed yet"
        : `${unindexed} matching contacts are not indexed yet`,
    );
  }

  return {
    where: { AND: [where, { id: { in: kept.map((k) => k.personId) } }] },
    error: null,
    warnings: parsed.warnings,
    ranked: kept.map((k) => k.personId),
    note: `${notes.join(" · ")}. Ranked with ${embeddingModel()}.`,
  };
}

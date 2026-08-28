import { prisma } from "@/lib/db";
import { embedTexts, embeddingConfigured, embeddingModel } from "./embed";
import { INDEXABLE_SELECT, indexableText, sourceHash } from "./index-text";

/**
 * Keeping the vectors in step with the contacts.
 *
 * **Stale embeddings are silently wrong answers**, which is the one thing this feature can do
 * that a query language cannot: a contact whose notes now say "moved to nursing" and whose
 * vector still says "warehouse" is not an error anybody sees, it is a contact that quietly
 * stops turning up. So staleness is decided by HASHING the text rather than by trusting a
 * timestamp: adding a label or recording a gift changes what a contact means without touching
 * Person.updatedAt, and a queue keyed on that column would go stale in exactly the cases
 * embeddings exist for.
 *
 * The cost of a hash check is one read of a few hundred rows and no model call at all, which
 * at this size is cheaper than being clever. If this ever runs at a size where that is not
 * true, the fix is a trigger writing a dirty flag — not a timestamp comparison.
 *
 * There is no per-user index: a contact's vector is built from text every reader of that
 * contact can already read (see index-text.ts), so one index serves everybody and the access
 * clauses do the rest at query time.
 */

/** How many documents go to Ollama in one request. */
const BATCH = 24;

/**
 * How many contacts one pass will embed.
 *
 * A cap rather than "all of them": the first pass on a real address book is three hundred
 * documents, and a pass that takes four minutes is a pass that overlaps the next one. What
 * is left over is picked up five minutes later, and the count is visible in Settings so that
 * "not finished yet" is never mistaken for "not working".
 */
const PER_PASS = 96;

export interface IndexStatus {
  /** Contacts whose current text is embedded with the current model. */
  fresh: number;
  /** Contacts that would be re-embedded by the next pass. */
  stale: number;
  model: string;
  configured: boolean;
}

interface Pending {
  personId: string;
  text: string;
  hash: string;
}

/**
 * Which contacts need embedding, and what text for.
 *
 * One query for every live contact plus its label, point and gift text. Trashed contacts are
 * skipped — they are excluded from every search by the access clauses, so embedding them
 * would be work nobody can ever see — but their vectors are LEFT ALONE, because restoring a
 * contact has to keep working and re-embedding on restore would need a hook that does not
 * exist.
 */
async function pending(): Promise<{ pending: Pending[]; total: number }> {
  const model = embeddingModel();
  const people = await prisma.person.findMany({
    where: { deletedAt: null },
    select: { id: true, embedding: { select: { sourceHash: true } }, ...INDEXABLE_SELECT },
  });

  const out: Pending[] = [];
  for (const person of people) {
    const text = indexableText(person);
    const hash = sourceHash(text, model);
    if (person.embedding?.sourceHash === hash) continue;
    // A contact with nothing to say is not embedded at all: an empty vector would rank
    // against every query and mean nothing. Any stale row for one is removed below.
    out.push({ personId: person.id, text, hash });
  }
  return { pending: out, total: people.length };
}

export async function indexStatus(): Promise<IndexStatus> {
  const configured = embeddingConfigured();
  if (!configured) {
    return { fresh: 0, stale: 0, model: embeddingModel(), configured };
  }
  const { pending: todo, total } = await pending();
  // Contacts with no indexable text are neither fresh nor stale — there is nothing to embed
  // and nothing waiting — so they are counted out of both rather than sitting in a queue
  // that never empties.
  const nothingToSay = todo.filter((p) => p.text.length === 0).length;
  return {
    fresh: total - todo.length,
    stale: todo.length - nothingToSay,
    model: embeddingModel(),
    configured,
  };
}

export interface IndexRun {
  embedded: number;
  removed: number;
  remaining: number;
  message?: string;
}

/**
 * Embed what is waiting, up to one pass's worth.
 *
 * Idempotent, so two app instances or a manual rebuild landing mid-pass cost duplicated work
 * and nothing else — which is why this needs no lease where the Google sync does: sync has
 * side effects on somebody else's address book, and this writes only derived data it can
 * recompute.
 */
export async function indexPending(limit = PER_PASS): Promise<IndexRun> {
  if (!embeddingConfigured()) {
    return { embedded: 0, removed: 0, remaining: 0, message: "No model is configured." };
  }
  const model = embeddingModel();
  const { pending: todo } = await pending();

  // Contacts with no indexable text: drop any vector they used to have, so emptying a
  // contact's notes removes it from semantic results rather than leaving the old meaning
  // behind.
  const empties = todo.filter((p) => p.text.length === 0).map((p) => p.personId);
  let removed = 0;
  if (empties.length > 0) {
    removed = (await prisma.personEmbedding.deleteMany({ where: { personId: { in: empties } } }))
      .count;
  }

  const work = todo.filter((p) => p.text.length > 0).slice(0, limit);
  let embedded = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    const slice = work.slice(i, i + BATCH);
    const result = await embedTexts(slice.map((p) => p.text), "document");
    if (!result.ok) {
      // Stop the pass rather than continue: if the model is unreachable the next batch will
      // fail the same way, and the rows already written are correct.
      return {
        embedded,
        removed,
        remaining: todo.filter((p) => p.text.length > 0).length - embedded,
        message: result.message,
      };
    }
    for (let j = 0; j < slice.length; j += 1) {
      const row = slice[j]!;
      const vector = result.vectors[j]!;
      await prisma.personEmbedding.upsert({
        where: { personId: row.personId },
        create: { personId: row.personId, model, vector, sourceHash: row.hash },
        update: { model, vector, sourceHash: row.hash, embeddedAt: new Date() },
      });
      embedded += 1;
    }
  }

  return {
    embedded,
    removed,
    remaining: todo.filter((p) => p.text.length > 0).length - embedded,
  };
}

export interface Scored {
  personId: string;
  score: number;
}

/**
 * Score every stored vector against one query, best first.
 *
 * Brute force in Node, deliberately: a few hundred dot products over 768 floats is under a
 * millisecond, and the alternative is a database extension the alpine image does not have.
 * The candidate ids come from the SQL half of the query, so the ranking happens WITHIN what
 * the rest of the search and the access clauses already allowed — "healthcare among my
 * family" rather than "the nearest healthcare match, then check if it was allowed".
 */
export async function scoreAgainst(
  queryVector: readonly number[],
  candidateIds: readonly string[],
): Promise<Scored[]> {
  if (candidateIds.length === 0) return [];
  const { cosine } = await import("./embed");
  const rows = await prisma.personEmbedding.findMany({
    where: { personId: { in: [...candidateIds] }, model: embeddingModel() },
    select: { personId: true, vector: true },
  });
  return rows
    .map((row) => ({ personId: row.personId, score: cosine(queryVector, row.vector) }))
    .sort((a, b) => b.score - a.score);
}

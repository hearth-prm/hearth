/**
 * Turning text into a vector, through the same Ollama the "ask" button uses.
 *
 * Embeddings are the part of this that is not a query language: two pieces of text that mean
 * the same thing land near each other whether or not they share a word, which is how
 * "healthcare" finds "Registered Nurse at UW Health". Nothing else in the search box can do
 * that.
 *
 * It is also the part that cannot say "no". A cosine distance has no mechanism for negation
 * or conjunction — ask for similarity to "no email" and you get people with email — so this
 * is exposed as ONE predicate inside the language and never as the whole search. See
 * docs/design-search.md.
 *
 * Optional in the same shape as the rest: with OLLAMA_URL unset there is no index, no
 * predicate and no button, and everything else works exactly as before.
 */

const DEFAULT_EMBED_MODEL = "nomic-embed-text";

/**
 * Longer than a chat translation's timeout, and for a different reason.
 *
 * A batch of thirty documents is thirty forward passes, and the model may have to load
 * first. This runs in a background pass rather than in front of somebody waiting, so the
 * generous number costs nothing; the QUERY side gets the short timeout below, because that
 * one is in front of a search box.
 */
const INDEX_TIMEOUT_MS = 120_000;
const QUERY_TIMEOUT_MS = 20_000;

export function embeddingConfigured(): boolean {
  return Boolean(process.env.OLLAMA_URL);
}

export function embeddingModel(): string {
  return process.env.OLLAMA_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

/**
 * nomic-embed-text is trained for ASYMMETRIC search and expects a task prefix.
 *
 * `search_document:` on what is stored, `search_query:` on what is typed. Without them the
 * model is being used off-label and the ranking is measurably worse — a short query and a
 * long document are different shapes of text, and the prefixes are how the model is told
 * which it is looking at.
 *
 * Applied only to nomic-family models, because for anything else the prefix is not a
 * convention but literally seven extra tokens of noise at the front of every vector.
 */
function withPrefix(text: string, kind: "document" | "query"): string {
  if (!/nomic/i.test(embeddingModel())) return text;
  return kind === "document" ? `search_document: ${text}` : `search_query: ${text}`;
}

export interface EmbedResult {
  ok: boolean;
  vectors: number[][];
  message?: string;
}

/**
 * Embed a batch.
 *
 * Batched because Ollama's /api/embed takes an array and one round trip for thirty documents
 * is thirty times less waiting than thirty round trips. The result order is the input order,
 * which the caller relies on to match vectors back to rows — so a reply of the wrong length
 * is an error rather than something to zip up hopefully.
 */
export async function embedTexts(
  texts: readonly string[],
  kind: "document" | "query",
): Promise<EmbedResult> {
  const base = process.env.OLLAMA_URL;
  if (!base) return { ok: false, vectors: [], message: "No model is configured for this install." };
  if (texts.length === 0) return { ok: true, vectors: [] };

  const model = embeddingModel();
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts.map((t) => withPrefix(t, kind)) }),
      signal: AbortSignal.timeout(kind === "query" ? QUERY_TIMEOUT_MS : INDEX_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        vectors: [],
        message: `The model answered with ${response.status}. Is ${model} pulled on that host?`,
      };
    }
    const body = (await response.json()) as { embeddings?: unknown };
    const raw = body.embeddings;
    if (
      !Array.isArray(raw) ||
      raw.length !== texts.length ||
      !raw.every((v) => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number"))
    ) {
      return { ok: false, vectors: [], message: "The model replied with something unreadable." };
    }
    return { ok: true, vectors: raw as number[][] };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      vectors: [],
      message: timedOut
        ? "The model took too long. It may still be loading — try again in a moment."
        : "Could not reach the model. The ordinary search still works.",
    };
  }
}

/**
 * Cosine similarity.
 *
 * Not shortened to a dot product: Ollama's embeddings are close to unit length but not
 * guaranteed to be, and a normalisation assumption that is true for one model and false for
 * the next is the kind of thing that produces a ranking nobody can explain. Two vectors of
 * different length mean two different models, which is a bug rather than a score of zero —
 * but returning 0 keeps it out of the results rather than throwing inside a search.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

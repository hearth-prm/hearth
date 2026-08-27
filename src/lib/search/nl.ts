import { parseQuery, QueryError } from "./parse";
import type { Vocabulary } from "./suggest";

/**
 * Turning a sentence into a query, through a model on your own network.
 *
 * The model writes into the SEARCH BOX rather than into the database. That is the whole design
 * and the reason this is safe to have: a misunderstanding produces a visibly wrong query you
 * can edit, not a quietly wrong list you then bulk-delete from. Nothing here executes
 * anything; it returns a string that has been through the same parser as anything typed by
 * hand, and if the model's output does not parse then the parse error is what you see.
 *
 * Optional, in the shape places/index.ts already uses for Google Places: with OLLAMA_URL unset
 * the feature is not offered at all, and with it set but unreachable the ordinary filter still
 * works. Nothing about the household leaves the network — only the sentence, the field names
 * and your label names are sent, and only to the host you named.
 */

const DEFAULT_MODEL = "qwen2.5:7b-instruct";

/**
 * Generous, deliberately.
 *
 * A cold model has to be loaded before it can answer, which can take tens of seconds; after
 * that a query is a second or two. Failing fast would mean the first search of the day always
 * failing, so the wait is long and the UI says what it is waiting for. A long
 * OLLAMA_KEEP_ALIVE on the Ollama side is what makes the cold case rare.
 */
const TIMEOUT_MS = 60_000;

export function naturalLanguageConfigured(): boolean {
  return Boolean(process.env.OLLAMA_URL);
}

export function naturalLanguageModel(): string {
  return process.env.OLLAMA_CHAT_MODEL || DEFAULT_MODEL;
}

export interface Translation {
  ok: boolean;
  /** The query, when there is one. Always parsed before being returned. */
  query?: string;
  /** What to tell the user when there is not. */
  message?: string;
}

/**
 * The instructions.
 *
 * Everything the model needs is in here, because a model cannot be expected to know a grammar
 * invented last week. The field list and label names come from the same vocabulary the
 * autocomplete uses, so the three of them cannot drift apart.
 *
 * The examples do most of the work. They are chosen to demonstrate one thing each: a label by
 * name, an address part, negation, a date, an OR, and — the important one — leaving a plain
 * phrase alone when no field applies.
 */
function buildPrompt(sentence: string, vocab: Vocabulary): string {
  const values = Object.entries(vocab.values)
    .filter(([, v]) => v.length > 0)
    .map(([field, v]) => `  ${field}: ${v.slice(0, 40).join(", ")}`)
    .join("\n");

  return `You translate a person's request into a search query for a contacts app.

Reply with JSON only: {"query": "..."}

QUERY SYNTAX
  field:value            a term; the value matches anywhere in the field
  field:="exact value"   the whole field value rather than part of it
  "two words"            quote any value containing a space
  -term                  exclude
  term term              both (AND)
  term or term           either
  (a or b) c             brackets group
  plain words            searches names, organisations, notes, contact details and labels

FIELDS
${vocab.fields.join(", ")}

VALUES THAT ARE FIXED
${values}

DATES take 2026-08-01, 2026-08, or a relative age like 30d, 6m, 1y, and accept > and <.
  updated:>30d means changed within the last 30 days.

EXAMPLES
  family in sun prairie with no email
    {"query": "label:Family city:\\"Sun Prairie\\" -has:email"}
  anyone at thestreet in the technology department
    {"query": "org:TheStreet dept:Technology"}
  contacts I have not touched in six months
    {"query": "-updated:>6m"}
  people whose sync failed
    {"query": "google:error"}
  friends or family
    {"query": "label:Friends or label:Family"}
  someone called mayhew
    {"query": "mayhew"}

RULES
  Use only the fields listed. If no field fits part of the request, leave those words as
  plain text rather than inventing a field.
  Use a label name only if it appears in the list above; otherwise use plain text.
  Do not explain. JSON only.

REQUEST
${sentence}`;
}

/**
 * Ask the model, then check its answer with the parser.
 *
 * Validation is not a formality here. A model will occasionally reply with prose, a fenced
 * code block, or a field that does not exist — and the parser is the only thing that decides
 * whether a string is a query. Anything it rejects comes back as an error rather than being
 * put in the box for somebody to run.
 */
export async function translateToQuery(
  sentence: string,
  vocab: Vocabulary,
): Promise<Translation> {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    return { ok: false, message: "No model is configured for this install." };
  }
  const trimmed = sentence.trim();
  if (!trimmed) return { ok: false, message: "Type what you are looking for first." };

  let body: unknown;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: naturalLanguageModel(),
        prompt: buildPrompt(trimmed, vocab),
        // Ollama's own JSON mode, so the reply is parseable without stripping fences and
        // apologies out of prose.
        format: "json",
        stream: false,
        options: {
          // Translation, not composition: the same sentence should give the same query.
          temperature: 0,
          num_predict: 200,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `The model answered with ${response.status}. Is ${naturalLanguageModel()} pulled on that host?`,
      };
    }
    body = await response.json();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? "The model took too long. It may still be loading — try again in a moment."
        : "Could not reach the model. The ordinary search still works.",
    };
  }

  const raw = (body as { response?: unknown }).response;
  if (typeof raw !== "string") {
    return { ok: false, message: "The model replied with something unreadable." };
  }

  let query: unknown;
  try {
    query = (JSON.parse(raw) as { query?: unknown }).query;
  } catch {
    return { ok: false, message: "The model replied with something unreadable." };
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, message: "The model did not produce a query." };
  }

  const cleaned = query.trim();
  try {
    parseQuery(cleaned);
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof QueryError
          ? `The model wrote something that is not a valid query: ${err.message}`
          : "The model wrote something that is not a valid query.",
    };
  }

  return { ok: true, query: cleaned };
}

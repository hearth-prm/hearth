/**
 * What to offer somebody halfway through typing a query.
 *
 * Pure, and given the whole input plus a cursor rather than "the word so far", because the
 * word so far is the thing that is hard: `city:"Sun Pr` is one token containing a space, and
 * deciding where it began needs to know which quotes are open.
 *
 * Returns the span it would replace along with the candidates, so the component applying a
 * suggestion does not have to work that out a second time and get a different answer.
 */

export interface Suggestion {
  /** Text to put in place of the span. */
  insert: string;
  /** What to show in the list. */
  label: string;
  /** A word about what it does, shown dimmed. */
  detail?: string;
}

/**
 * A value worth offering, with an optional line about what it means.
 *
 * A bare string was enough while `has:` had eleven options whose names said everything;
 * with forty it does not, so a value may now describe itself. The union rather than a
 * required object because most value lists — label names, sync states — have nothing to add
 * beyond the name itself.
 */
export type ValueOption = string | { value: string; detail: string };

export interface Vocabulary {
  /** Every field name the language accepts. */
  fields: readonly string[];
  /** Values worth offering for a field, keyed by field name. */
  values: Readonly<Record<string, readonly ValueOption[]>>;
  /** One-line description per field, for the list and the help panel. */
  describe?: Readonly<Record<string, string>>;
}

function optionValue(option: ValueOption): string {
  return typeof option === "string" ? option : option.value;
}

function optionDetail(option: ValueOption, field: string): string {
  return typeof option === "string" ? field : option.detail;
}

export interface SuggestResult {
  /** Index in the input where the replacement starts. */
  from: number;
  /** Index where it ends — the cursor, so text after it is left alone. */
  to: number;
  items: Suggestion[];
}

/**
 * Where the token under the cursor begins.
 *
 * Scans forward tracking quote parity, so whitespace inside quotes does not count as a
 * boundary. An opening bracket is a boundary; a closing one cannot be, since it would end the
 * token anyway.
 */
function tokenStart(input: string, cursor: number): number {
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < cursor; i += 1) {
    const c = input[i]!;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (/\s/.test(c) || c === "(")) start = i + 1;
  }
  return start;
}

/** A value with a space in it has to go back in quoted, or it becomes two terms. */
function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

const MAX = 8;

export function suggestQuery(
  input: string,
  cursor: number,
  vocab: Vocabulary,
): SuggestResult {
  const from = tokenStart(input, cursor);
  const raw = input.slice(from, cursor);

  // A leading minus is part of the query, not of the word being completed, so it is set aside
  // and put back on whatever is inserted.
  const negated = raw.startsWith("-");
  const token = negated ? raw.slice(1) : raw;
  const prefix = negated ? "-" : "";

  // The first colon, ignoring any inside quotes — the same rule the parser uses, because
  // suggesting on a different reading of the token than the parser will use is worse than
  // suggesting nothing.
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i]!;
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes && colon === -1) colon = i;
  }

  if (colon === -1) {
    // Still typing a name. An empty token offers nothing: a dropdown covering the list the
    // moment the box is focused is noise, not help.
    if (token.length === 0) return { from, to: cursor, items: [] };
    const lower = token.toLowerCase();
    const items = vocab.fields
      .filter((f) => f.toLowerCase().startsWith(lower))
      .slice(0, MAX)
      .map((f) => ({
        insert: `${prefix}${f}:`,
        label: `${f}:`,
        detail: vocab.describe?.[f],
      }));
    return { from, to: cursor, items };
  }

  const field = token.slice(0, colon).toLowerCase();
  const partial = token.slice(colon + 1).replace(/^["<>=]+/, "");
  const values = vocab.values[field];
  if (!values) return { from, to: cursor, items: [] };

  const lower = partial.toLowerCase();
  const items = values
    .filter((v) => optionValue(v).toLowerCase().includes(lower))
    .slice(0, MAX)
    .map((v) => ({
      insert: `${prefix}${field}:${quoteIfNeeded(optionValue(v))}`,
      label: optionValue(v),
      detail: optionDetail(v, field),
    }));
  return { from, to: cursor, items };
}

/** Apply a suggestion, returning the new text and where the cursor should land. */
export function applySuggestion(
  input: string,
  result: SuggestResult,
  item: Suggestion,
): { value: string; cursor: number } {
  const before = input.slice(0, result.from);
  const after = input.slice(result.to);
  // A field name ends in a colon and wants the cursor left against it, ready for a value.
  // A completed value wants a space, because the next thing is another term.
  const tail = item.insert.endsWith(":") ? "" : " ";
  const value = `${before}${item.insert}${tail}${after}`;
  return { value, cursor: before.length + item.insert.length + tail.length };
}

import { parseQuery, type Node, type Term } from "./parse";

/**
 * A query as a row of chips.
 *
 * The chips ARE the query string — there is no separate state. Editing one re-prints the
 * whole row back into `q`, which is what keeps a filtered list a URL you can bookmark, share
 * with yourself and hit Back out of one step at a time. A chip row held in component state
 * would look identical and be none of those things.
 *
 * Pure, and knows nothing about Prisma or React: the same functions decide what the box
 * renders and what the tests assert.
 *
 * ## Why a row and not a tree
 *
 * The language has brackets and the grammar is a tree; a row of chips with connectors between
 * them is flat. Every flat row is expressible as a query — `a AND b OR c` is `a b or c` — but
 * not every query is expressible as a row: `(a or b) c` is not. So `chipsFromQuery` returns
 * null for those, and the caller shows the query as one chip rather than pretending. Silently
 * dropping the brackets would change what somebody's bookmark means.
 */

export type Connector = "and" | "or";

export interface ChipRow {
  /** One per chip, in source form: `-has:email`, `city:"Sun Prairie"`, `like:bob`. */
  chips: string[];
  /** What joins chip i to chip i+1. Always chips.length - 1 long. */
  connectors: Connector[];
}

export const EMPTY_ROW: ChipRow = { chips: [], connectors: [] };

/** A value goes back in quoted when it would otherwise tokenise as more than one thing. */
function quoteValue(value: string): string {
  // Inner quotes are dropped rather than escaped: the tokeniser has no escape, so a value
  // containing a quote never came from a query in the first place and cannot round-trip.
  const stripped = value.replace(/"/g, "");
  return stripped === "" || /[\s"()]/.test(stripped) ? `"${stripped}"` : stripped;
}

/**
 * A term back to the text somebody would have typed.
 *
 * A bare word prints as `like:bob`, which is why `like:` is a real predicate rather than a
 * display convention: a chip that says one thing while the URL says another is the bug this
 * whole module exists to avoid, and the round trip has to be exact.
 */
export function printTerm(term: Term): string {
  const field = term.field ?? "like";
  const op = term.op === ":" ? "" : term.op;
  return `${field}:${op}${quoteValue(term.value)}`;
}

function printNode(node: Node): string | null {
  if (node.kind === "term") return printTerm(node);
  if (node.kind === "not") {
    const inner = printNode(node.node);
    return inner === null ? null : `-${inner}`;
  }
  return null;
}

function join(rows: ChipRow[], between: Connector): ChipRow {
  const chips: string[] = [];
  const connectors: Connector[] = [];
  rows.forEach((row, i) => {
    if (i > 0) connectors.push(between);
    row.chips.forEach((chip, j) => {
      if (j > 0) connectors.push(row.connectors[j - 1]!);
      chips.push(chip);
    });
  });
  return { chips, connectors };
}

function rowFor(node: Node): ChipRow | null {
  const single = printNode(node);
  if (single !== null) return { chips: [single], connectors: [] };

  if (node.kind === "and" || node.kind === "or") {
    const parts: ChipRow[] = [];
    for (const child of node.nodes) {
      // An `and` inside an `or` is the ordinary shape of `a b or c` and flattens; anything
      // deeper came from brackets and does not.
      const part = node.kind === "or" && child.kind === "and" ? rowFor(child) : printNodeRow(child);
      if (part === null) return null;
      parts.push(part);
    }
    return join(parts, node.kind);
  }
  return null;
}

function printNodeRow(node: Node): ChipRow | null {
  const single = printNode(node);
  return single === null ? null : { chips: [single], connectors: [] };
}

/**
 * Decompose a query into chips, or say it cannot be done.
 *
 * Null means "this query has a shape a flat row cannot hold" — brackets, or a negated group.
 * An empty query is an empty row, which is different from null and matters: one means "no
 * filter", the other means "a filter I must not pretend to have taken apart".
 */
export function chipsFromQuery(q: string): ChipRow | null {
  let tree: Node | null;
  try {
    tree = parseQuery(q);
  } catch {
    // A query that does not parse cannot be chipped. The page reports the parse error
    // separately; here it is simply not a row.
    return null;
  }
  if (!tree) return EMPTY_ROW;
  return rowFor(tree);
}

/** The row back to a query string. */
export function queryFromChips(row: ChipRow): string {
  return row.chips
    .map((chip, i) => (i === 0 ? chip : `${row.connectors[i - 1] === "or" ? "or " : ""}${chip}`))
    .join(" ")
    .trim();
}

/**
 * Add what somebody typed to the end of the row.
 *
 * The typed text is parsed, so typing `-has:email -has:phone` and pressing Enter produces TWO
 * chips rather than one chip containing two terms. That is the whole point of the interaction:
 * what you get back is the thing you can then take apart.
 *
 * Text that will not parse is added as one chip of plain text, because refusing to accept it
 * would leave somebody with a box they cannot empty.
 */
export function appendTyped(row: ChipRow, typed: string, connector: Connector = "and"): ChipRow {
  const trimmed = typed.trim();
  if (!trimmed) return row;
  const added = chipsFromQuery(trimmed) ?? { chips: [`like:${quoteValue(trimmed)}`], connectors: [] };
  if (added.chips.length === 0) return row;
  if (row.chips.length === 0) return added;
  return join([row, added], connector);
}

/** Remove one chip, and the connector that attached it. */
export function removeChip(row: ChipRow, index: number): ChipRow {
  if (index < 0 || index >= row.chips.length) return row;
  const chips = row.chips.filter((_, i) => i !== index);
  // The connector BEFORE the chip goes with it, except for the first chip, which has none —
  // there the connector after it is the one that would be left dangling.
  const drop = index === 0 ? 0 : index - 1;
  const connectors = row.connectors.filter((_, i) => i !== drop);
  return { chips, connectors };
}

export function setConnector(row: ChipRow, index: number, value: Connector): ChipRow {
  if (index < 0 || index >= row.connectors.length) return row;
  const connectors = [...row.connectors];
  connectors[index] = value;
  return { chips: row.chips, connectors };
}

/**
 * The query somebody would get by pressing Enter now.
 *
 * Used for the hidden input the form actually submits, so the no-JavaScript path appends in
 * exactly the way the visible one does.
 */
export function combineQuery(existing: string, typed: string): string {
  const row = chipsFromQuery(existing);
  if (row === null) {
    // Not chippable — brackets, most likely. Appending as text is still correct as a query,
    // and leaves the brackets alone.
    const trimmed = typed.trim();
    return trimmed ? `${existing} ${trimmed}`.trim() : existing;
  }
  return queryFromChips(appendTyped(row, typed));
}

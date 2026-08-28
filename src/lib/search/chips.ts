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
 * ## A row, with groups
 *
 * The language has brackets and the grammar is a tree; a row of chips with connectors between
 * them is flat. The two are reconciled by letting a chip BE a bracketed group:
 * `(-has:email or -has:phone) semantic:cars` is two chips, the first of which is a group.
 *
 * Brackets appear in a chip exactly when they are load-bearing — an `or` sitting inside an
 * `and`. Redundant ones normalise away, so `(a b) or c` comes back as three ordinary chips
 * rather than a group nobody needs. A group is not editable from the row: removing it removes
 * the whole group, and changing what is inside means retyping it. That is a real limit and
 * the tooltip says so, but it beats the previous behaviour, which was to refuse to chip a
 * bracketed query at all and show it as one anonymous blob.
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

/**
 * Any node back to source, bracketing only where the meaning needs it.
 *
 * `and` binds tighter than `or`, so an `or` inside an `and` needs its brackets and nothing
 * else does. Printing brackets everywhere would be safe and would also mean every chip
 * arrived wearing parentheses it did not need.
 */
export function printAny(node: Node): string {
  switch (node.kind) {
    case "term":
      return printTerm(node);
    case "not": {
      const inner = node.node;
      return inner.kind === "term" ? `-${printTerm(inner)}` : `-(${printAny(inner)})`;
    }
    case "and":
      return node.nodes
        .map((n) => (n.kind === "or" ? `(${printAny(n)})` : printAny(n)))
        .join(" ");
    case "or":
      return node.nodes.map((n) => printAny(n)).join(" or ");
  }
}

/** A chip that stands for a bracketed group rather than a single term. */
export function isGroupChip(chip: string): boolean {
  return chip.startsWith("(") || chip.startsWith("-(");
}

/** Whether a row would be misread if something were ANDed onto the end of it. */
function hasOr(row: ChipRow): boolean {
  return row.connectors.includes("or");
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

function chip(text: string): ChipRow {
  return { chips: [text], connectors: [] };
}

function rowFor(node: Node): ChipRow {
  switch (node.kind) {
    case "term":
    case "not":
      return chip(printAny(node));
    case "and":
      // An `or` child is where the brackets were, and where they have to stay: it becomes one
      // group chip. Anything else flattens, so `a b c` is three chips and not a nest.
      return join(
        node.nodes.map((n) => (n.kind === "or" ? chip(`(${printAny(n)})`) : rowFor(n))),
        "and",
      );
    case "or":
      // Nothing binds looser than `or`, so no child of it ever needs brackets — an `and`
      // child flattens into chips joined by AND, which is exactly how `a b or c` reads.
      return join(node.nodes.map((n) => rowFor(n)), "or");
  }
}

/**
 * Decompose a query into chips.
 *
 * Null now means only one thing: the query does not PARSE. Every query that parses is a row,
 * because a group is a chip. An empty query is an empty row, which is different from null and
 * matters — one means "no filter", the other means "a filter I cannot read at all".
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
  let rest = typed.trim();
  if (!rest) return row;

  // A leading "or" or "and" says how to JOIN, which is what somebody typing `or -has:email`
  // into a box that already has chips means. Without this the whole phrase failed to parse —
  // "or" has nothing before it — and landed in the box as one `like:"or -has:email"` chip,
  // which is how it was reported.
  let joinWith = connector;
  const lead = /^(or|and)(?:\s+|$)/i.exec(rest);
  // A lone "or" is a connector only when there is a row for it to join to — somebody who
  // pressed Enter a word early. Typed into an empty box there is nothing to join, so it stays
  // an ordinary word search, and the two cases are asymmetric on purpose.
  if (lead && (rest.length > lead[0].length || row.chips.length > 0)) {
    joinWith = lead[1]!.toLowerCase() as Connector;
    rest = rest.slice(lead[0].length).trim();
  }
  if (!rest) return row;

  let added = chipsFromQuery(rest) ?? chip(`like:${quoteValue(rest)}`);
  if (added.chips.length === 0) return row;
  if (row.chips.length === 0) return added;

  // Brackets where the precedence would otherwise change the meaning.
  //
  // `and` binds tighter than `or`, so ANDing onto `a or b` would give `a or (b and c)` — not
  // what somebody adding a term to a row of two means. Bracketing the side that contains the
  // `or` keeps the meaning AND shows it: the row comes back with a group chip in it, which is
  // the same thing they would have typed by hand.
  let left = row;
  if (joinWith === "and" && hasOr(row)) left = chip(`(${queryFromChips(row)})`);
  if (joinWith === "and" && hasOr(added)) added = chip(`(${queryFromChips(added)})`);

  return join([left, added], joinWith);
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
    // The existing query does not parse, so there is nothing to append to safely. Left alone
    // rather than concatenated: whatever is wrong with it, adding to it will not help, and the
    // page is already reporting the parse error.
    const trimmed = typed.trim();
    return trimmed ? `${existing} ${trimmed}`.trim() : existing;
  }
  return queryFromChips(appendTyped(row, typed));
}

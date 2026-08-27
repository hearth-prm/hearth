/**
 * The query language, string to syntax tree.
 *
 * Deliberately knows nothing about Prisma, fields, or who is asking. That is what makes it
 * testable exhaustively without a database, and it is the half most likely to be wrong: a
 * parser has hundreds of inputs and a compiler has a handful of shapes.
 *
 * Grammar, loosest binding first:
 *
 *   or    := and ( "or" and )*
 *   and   := not ( "and"? not )*        juxtaposition is AND
 *   not   := "-" not | atom
 *   atom  := "(" or ")" | term
 *   term  := ( field ":" op? )? value
 *
 * So `label:Family -has:email or org:Acme` reads as
 * `(label:Family AND NOT has:email) OR org:Acme`, which is how every search box people
 * already use behaves.
 */

export type Comparison = ":" | "=" | "<" | ">" | "<=" | ">=";

export interface Term {
  kind: "term";
  /** null for a bare word or phrase, which searches the fields a person is findable by. */
  field: string | null;
  op: Comparison;
  value: string;
  /** True when the value arrived in quotes, which suppresses "did you mean a field?" hints. */
  quoted: boolean;
}

export type Node =
  | Term
  | { kind: "and"; nodes: Node[] }
  | { kind: "or"; nodes: Node[] }
  | { kind: "not"; node: Node };

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

// --- tokens ---------------------------------------------------------------

type Token =
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "or" }
  | { t: "and" }
  | { t: "minus" }
  | {
      t: "word";
      text: string;
      /**
       * Offset in `text` of the first colon that was NOT inside quotes, or -1.
       *
       * A single "was any of this quoted" flag is not enough, which is what the first version
       * had: in `city:"Sun Prairie"` the field is outside the quotes and the colon must still
       * split, while in `notes:"see me: tomorrow"` the second colon must not. Only the
       * tokeniser knows which colons were quoted, so it records the one that matters.
       */
      colonAt: number;
      quoted: boolean;
    };

/**
 * A quoted run is one token, quotes and all, so `city:"Sun Prairie"` survives being split on
 * spaces. An unterminated quote is an error rather than a silent run to end-of-input: the
 * second is how `city:"Sun` quietly searches for everything after it.
 */
function tokenise(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i]!;

    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lparen" });
      i += 1;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rparen" });
      i += 1;
      continue;
    }
    // A minus negates when it begins a token, whatever came before it.
    //
    // The first version also required the previous token not to be a word, meaning to protect
    // "well-known" — which needed no protection: that hyphen is consumed by the inner loop
    // below and never reaches here. What the condition actually did was stop `Qa -has:email`
    // from negating anything, because the term before it was a word. A hyphen mid-query is
    // the common case, not the exception.
    if (c === "-") {
      const next = input[i + 1];
      if (next !== undefined && !/[\s)]/.test(next)) {
        out.push({ t: "minus" });
        i += 1;
        continue;
      }
    }

    // One word, which may carry a field prefix and may contain a quoted section.
    let text = "";
    let quoted = false;
    let colonAt = -1;
    while (i < input.length) {
      const ch = input[i]!;
      if (/\s/.test(ch) || ch === "(" || ch === ")") break;
      if (ch === '"') {
        const end = input.indexOf('"', i + 1);
        if (end === -1) {
          throw new QueryError("There is a quote without a closing quote.");
        }
        text += input.slice(i + 1, end);
        quoted = true;
        i = end + 1;
        continue;
      }
      if (ch === ":" && colonAt === -1) colonAt = text.length;
      text += ch;
      i += 1;
    }

    const lower = text.toLowerCase();
    if (!quoted && lower === "or") out.push({ t: "or" });
    else if (!quoted && lower === "and") out.push({ t: "and" });
    else if (text.length > 0) out.push({ t: "word", text, colonAt, quoted });
  }

  return out;
}

/**
 * Split a word into field, comparison and value.
 *
 * The FIRST colon separates: `notes:see me:tomorrow` is the notes field containing
 * "see me:tomorrow", which is what somebody typing a sentence means. A value that was quoted
 * never contributes its colons, since the quotes were stripped before this point — hence the
 * separate flag rather than looking for quotes here.
 */
function splitTerm(text: string, colonAt: number, quoted: boolean): Term {
  const colon = colonAt;
  if (colon <= 0) {
    return { kind: "term", field: null, op: ":", value: text, quoted };
  }

  const field = text.slice(0, colon);
  let rest = text.slice(colon + 1);
  let op: Comparison = ":";
  for (const candidate of ["<=", ">=", "<", ">", "="] as const) {
    if (rest.startsWith(candidate)) {
      op = candidate;
      rest = rest.slice(candidate.length);
      break;
    }
  }
  if (rest.length === 0) {
    throw new QueryError(`“${field}:” has nothing after it. Give it a value, or drop it.`);
  }
  return { kind: "term", field, op, value: rest, quoted };
}

// --- parser ---------------------------------------------------------------

export function parseQuery(input: string): Node | null {
  const tokens = tokenise(input);
  if (tokens.length === 0) return null;

  let pos = 0;
  const peek = () => tokens[pos];

  function parseOr(): Node {
    const nodes = [parseAnd()];
    while (peek()?.t === "or") {
      pos += 1;
      if (pos >= tokens.length) throw new QueryError("“or” has nothing after it.");
      nodes.push(parseAnd());
    }
    return nodes.length === 1 ? nodes[0]! : { kind: "or", nodes };
  }

  function parseAnd(): Node {
    const nodes = [parseNot()];
    for (;;) {
      const next = peek();
      if (!next || next.t === "or" || next.t === "rparen") break;
      if (next.t === "and") {
        pos += 1;
        if (pos >= tokens.length) throw new QueryError("“and” has nothing after it.");
      }
      nodes.push(parseNot());
    }
    return nodes.length === 1 ? nodes[0]! : { kind: "and", nodes };
  }

  function parseNot(): Node {
    if (peek()?.t === "minus") {
      pos += 1;
      if (pos >= tokens.length) throw new QueryError("“-” has nothing after it.");
      return { kind: "not", node: parseNot() };
    }
    return parseAtom();
  }

  function parseAtom(): Node {
    const token = peek();
    if (!token) throw new QueryError("The query ends where a term was expected.");
    if (token.t === "lparen") {
      pos += 1;
      const inner = parseOr();
      if (peek()?.t !== "rparen") throw new QueryError("There is a “(” without a “)”.");
      pos += 1;
      return inner;
    }
    if (token.t === "rparen") throw new QueryError("There is a “)” without a “(”.");
    if (token.t === "or" || token.t === "and") {
      throw new QueryError(`“${token.t}” needs a term before it.`);
    }
    if (token.t !== "word") {
      // parseNot consumes every minus, so this is unreachable — stated as a narrowing rather
      // than a cast, so a new token type has to come back here and be thought about.
      throw new QueryError("A term was expected.");
    }
    pos += 1;
    return splitTerm(token.text, token.colonAt, token.quoted);
  }

  const tree = parseOr();
  if (pos < tokens.length) {
    // Only a stray ")" can get here; everything else is consumed by parseAnd.
    throw new QueryError("There is a “)” without a “(”.");
  }
  return tree;
}

/** Every field name mentioned, for hints and for deciding whether a query is "advanced". */
export function fieldsUsed(node: Node | null): string[] {
  if (!node) return [];
  if (node.kind === "term") return node.field ? [node.field] : [];
  if (node.kind === "not") return fieldsUsed(node.node);
  return node.nodes.flatMap(fieldsUsed);
}

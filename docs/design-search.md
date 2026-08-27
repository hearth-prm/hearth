# Design: search and filtering

Status: **agreed, not started.** Supersedes the four fixed filter dimensions in
[src/lib/people-filter.ts](../src/lib/people-filter.ts), which stay working throughout.

## The problem

Today the contact list filters on four dimensions — labels (any/all), relation to the viewer,
Google state, has-email/phone — plus free text across seven columns. That is a fixed menu, and
the questions a relationship manager is actually asked are not on it:

- family in Sun Prairie with no email address
- everyone from TheStreet, whatever label they ended up under
- whose birthday is next month
- who was at Christmas last year
- who works in healthcare — where nobody's record contains the word "healthcare"

The first four are **exact set logic**. The last one is not. That split runs through this whole
document and decides which tool answers which question.

## The one decision everything else follows from

**There will be a query language, and every other front-end compiles into it.**

Not because a DSL is nicer than a builder or a chat box, but because:

- a visual builder has to serialise to *something* to stay bookmarkable, and the URL is where
  this app already keeps filter state;
- a natural-language front-end has to *produce* something, or there is nothing to test and
  nothing to show the person who typed the sentence;
- exact predicates and fuzzy similarity have to be intersectable — `semantic:"healthcare"
  label:Family` — and intersection needs a language to intersect in.

Build the language first and the rest are front-ends. Build a chat box first and there is
nothing underneath it.

## Phase 1 — the language

Two pure modules, both exhaustively testable with no database:

| Module | Job |
|---|---|
| `src/lib/search/parse.ts` | string → AST. No knowledge of Prisma, fields or users |
| `src/lib/search/compile.ts` | AST + field registry + viewer → `Prisma.PersonWhereInput` |

Grammar, roughly:

```
label:Family label:Medical          bare juxtaposition is AND
label:Family or label:Medical       explicit OR
-label:Work_CMC                     leading minus negates
city:"Sun Prairie"                  quoted values; any address part
org:TheStreet                        substring, case-insensitive
howWeMet:"at work"                   custom fields, by their own key
has:email  -has:phone  has:photo     presence
birthday:december    birthday:<30d   dates: month names, absolute, relative
google:error                         what the current filter offers
"sun prairie"                        bare text: today's seven-column search
```

**Scope of phase 1 is single-entity only**: person columns, contact points and their parts,
custom fields, labels, presence, Google state, relation, dates. Events, relationships and
gifts wait for phase 5 — they need their own access clauses and roughly double the compiler.

### Field names come from the registry, not a list

`loadRegistry(viewerId, "PERSON")` already describes every field including custom ones, so
`howWeMet:` becomes queryable the moment the field is created, with no second place to edit.
Core columns get short aliases (`org`, `city`, `dept`) resolved through the same table.

### Invariants the compiler must hold

1. **It returns a clause to be ANDed with `readablePeopleWhere`, never a replacement.** The
   compiler must be structurally unable to emit a top-level `OR` that escapes the wrapper.
   Tested by running every query form as a second user and asserting the first user's private
   contacts never appear.
2. **Custom fields resolve against the viewer's registry**, because a shared contact's custom
   values are already hidden unless the viewer has a field of the same key. A query must not
   be a way around that.
3. **The trash stays out.** It does, via `deletedAt: null` in the access clause — and a query
   language is exactly how someone would accidentally reach it, so it gets a check.
4. **An unparseable query is an error, loudly.** Ignoring a term nobody understood would show
   everything and look like a filter that matched.

### Performance

`contains` compiles to `LIKE '%x%'` and cannot use an index. At a few hundred contacts that is
irrelevant. The answer at tens of thousands is a `pg_trgm` index, and it is not this work.

## Phase 2 — autocomplete

The language is only as good as its discoverability. Typing `c` offers `city:`, `created:`;
typing `label:` offers the viewer's actual label names; a panel lists every available key with
one example each. Same box, same URL, no new state.

## Phase 3 — natural language into the language

An LLM translates a sentence into a query. **Local by default, through Ollama**, which the
Unraid host can run: nothing about the household leaves the house, which is a better story
than the Google integration this app already relies on.

Follows the existing optional-service pattern —
[places/index.ts](../src/lib/places/index.ts) gates a whole feature on an env var and names
what you get instead when it is missing. `OLLAMA_URL` unset means the feature is not offered;
set but unreachable means the plain filter still works.

**The design rule that makes this trustworthy: the model writes into the search box, not into
the database.**

```
you type:   family in sun prairie with no email
box shows:  label:Family city:"Sun Prairie" -has:email
```

Visible, editable, bookmarkable, and parsed by the same parser as anything typed by hand. A
model that misunderstands you produces a visibly wrong *query* rather than a quietly wrong
*list* — which matters because the next thing someone does with a selection is bulk-edit or
bulk-delete it.

Model output is validated by parsing it. If it does not parse, the parse error is what you
see; there is no second interpretation path.

## Phase 4 — semantic search, the Immich-shaped part

This is what Immich's smart search actually is: not query translation but **embeddings**. Each
photo becomes a vector, the search text becomes a vector in the same space, and the answer is
nearest neighbours. That is why "a dog on a beach" works.

Applied here, over the text a contact carries — notes, organisation, job title, gift
descriptions, event titles — it answers *"who works in healthcare"* for a record that says
"Registered Nurse at UW Health". Nothing else in this document can do that.

It also **cannot do negation or conjunction**. Ask a similarity score for "no email" and it
will return people with email, because there is no mechanism in a cosine distance for "no".
So it is exposed as one predicate inside the language — `semantic:"healthcare" label:Family` —
and never as the whole search.

### No pgvector, at this size

The database image is `postgres:16-alpine`, which has no vector extension; adding one means
swapping the image and a `CREATE EXTENSION`. Skip it. A `Float[]` column and brute-force
cosine scoring in Node over a few hundred rows is under a millisecond and an afternoon's work.
pgvector earns its keep somewhere in the tens of thousands of rows.

### Things that go wrong

- **Stale embeddings are silently wrong answers.** They need a queue keyed on `updatedAt`, in
  the shape of the sync queue, and a count visible in Settings the way sync state already is.
- **An embedding is only comparable to others from the same model**, so the model name is
  stored beside the vector and a change means re-embedding rather than a silent mix.
- **Ollama down** degrades to the ordinary filter.

## The option with no AI in it

Postgres `pg_trgm` gives typo tolerance ("Hammerlng" finds "Hammerling") and full-text search
gives stemming ("nurse" finds "nursing"). One migration, no container, entirely deterministic.
It will never connect *healthcare* to *nurse* — that is precisely what phase 4 buys — but it
is worth knowing what the cheap majority looks like.

## Testing

- **Parser**: table-driven, pure. Every operator, precedence, quoting, negation, the empty
  string, and a dozen malformed inputs that must each produce a specific message.
- **Compiler**: assert the clause shape for simple cases, then run the real queries against
  the embedded Postgres for anything involving joins or JSONB.
- **The access property**: every query form, run as a second user, must never return a private
  contact. This is the check that matters most and the one a query language is most likely to
  break.
- **Phase 3**: the parser is the oracle. A fixed set of sentences, asserted to produce
  queries that parse — not asserted to produce one exact string, which would test the model
  rather than the plumbing.
- **Phase 4**: embed two contacts with known text, assert ordering by a query that should
  favour one. Fuzzy in principle, deterministic for a fixed model and fixed input.

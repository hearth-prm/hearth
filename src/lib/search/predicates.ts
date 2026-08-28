import type { ContactKind, Prisma } from "@prisma/client";
// Type-only, so this module never imports people-filter at runtime and the dependency runs
// one way: people-filter -> compile -> predicates.
import type { GoogleState, Relation } from "@/lib/people-filter";
import type { PersonNameParts } from "@/lib/people";
import { QueryError, type Comparison } from "./parse";

/**
 * The tables and clause builders shared by the filter chips and the query language.
 *
 * They live here rather than in people-filter.ts because both sides need them and the
 * alternative is either a circular import or two copies of the "waiting to sync" subtlety
 * below — which is exactly the sort of thing that gets fixed in one copy.
 *
 * NOTHING here imports at runtime. That is deliberate and load-bearing: people-filters.tsx
 * is a client component and imports people-filter.ts for its links and labels, so this
 * module sits in the client's import graph. An access clause imported from access.ts would
 * put auth.ts — and through it googleapis — one tree-shake away from the browser bundle,
 * which is a trap this codebase has already fallen into once. Hence Viewer below: the
 * clauses the predicates need are INJECTED by a server caller rather than imported here.
 */

/**
 * Who is asking, and what they may see.
 *
 * The three clauses are the access module's answers, passed in. A predicate that needs to
 * know what somebody may see uses these and never builds its own — a query must not be a
 * way around the boundary, and the only way to guarantee that is for the boundary to be
 * something the query language is handed rather than something it computes.
 */
export interface Viewer {
  id: string;
  /**
   * Whether this user may write thank-yous for anyone who delegated to the head of the
   * household. Read from the database rather than the session, so promoting somebody takes
   * effect on their next page load rather than their next sign-in.
   */
  isHeadOfHousehold: boolean;
  readablePeople: Prisma.PersonWhereInput;
  readableEvents: Prisma.EventWhereInput;
  /** The cards whose thanks this viewer may write; see thankableCardIds. */
  thankableCards: Prisma.PersonWhereInput;
}

// --- the field tables -----------------------------------------------------

/**
 * One addressable thing, in the spellings people actually type.
 *
 * `key` is the spelling offered by autocomplete and listed in the help panel; `aliases` are
 * accepted but not offered, so the list stays readable while `surname` still works. Every
 * consumer — the field syntax, `has:`, the autocomplete and the help text — is derived from
 * these three tables, because the alternative is four lists that agree until they don't.
 */
interface Addressable<T> {
  key: string;
  aliases?: readonly string[];
  /** A noun phrase for the suggestion list and the help panel. */
  label: string;
  target: T;
  /**
   * How to answer `has:` for this field, when the column itself cannot.
   *
   * Only `displayName` needs it, and it needs it badly: the column is denormalised and falls
   * back through nickname, organisation and finally the literal "Unnamed contact", so it is
   * NEVER empty and "is it filled in" always answered yes. `-has:name` therefore returned
   * nothing at all while the contacts it should have found sat there reading "Unnamed
   * contact" — which is how it was reported.
   *
   * The lesson generalises past this one column: for a field whose value is COMPUTED, "is it
   * set" is not a question about the field, it is a question about whatever it was computed
   * from. Deriving presence from a column list is right for every column a person types into
   * and wrong for every column the application fills in.
   */
  presence?: () => Prisma.PersonWhereInput;
  /**
   * A contact-point kind holding the same sort of value as the column.
   *
   * Only nickname has one: Google keeps one nickname on the name and any others as a list,
   * so a column-only lookup silently misses half of them.
   */
  also?: ContactKind;
}

/**
 * The columns computeDisplayName consults, which is exactly what "has a name" means: it
 * returns "Unnamed contact" if and only if all four of these are blank.
 *
 * A Record rather than an array, so that adding a part to PersonNameParts breaks HERE rather
 * than quietly leaving `has:name` behind. `satisfies keyof` would check one direction — and
 * the direction it checks is the one that does not matter.
 */
const NAME_PARTS: Record<keyof PersonNameParts, true> = {
  givenName: true,
  familyName: true,
  nickname: true,
  organization: true,
};

/** Person columns addressable by name. */
export const TEXT_FIELDS: readonly Addressable<string>[] = [
  {
    key: "name",
    aliases: ["displayname"],
    label: "a name, nickname or organisation to go by",
    target: "displayName",
    presence: () => ({ OR: Object.keys(NAME_PARTS).map((column) => presentText(column)) }),
  },
  { key: "first", aliases: ["firstname", "given"], label: "first name", target: "givenName" },
  { key: "middle", aliases: ["middlename"], label: "middle name", target: "middleName" },
  {
    key: "last",
    aliases: ["lastname", "surname", "family"],
    label: "last name",
    target: "familyName",
  },
  {
    key: "nickname",
    aliases: ["nick"],
    label: "nickname",
    target: "nickname",
    also: "NICKNAME",
  },
  { key: "prefix", aliases: ["honorificprefix"], label: "a title before the name", target: "honorificPrefix" },
  { key: "suffix", aliases: ["honorificsuffix"], label: "letters after the name", target: "honorificSuffix" },
  {
    key: "phoneticfirst",
    aliases: ["phoneticgiven"],
    label: "how the first name sounds",
    target: "phoneticGivenName",
  },
  { key: "phoneticmiddle", label: "how the middle name sounds", target: "phoneticMiddleName" },
  {
    key: "phoneticlast",
    aliases: ["phoneticfamily"],
    label: "how the last name sounds",
    target: "phoneticFamilyName",
  },
  {
    key: "org",
    aliases: ["organisation", "organization", "company"],
    label: "organisation",
    target: "organization",
  },
  { key: "title", aliases: ["jobtitle", "job"], label: "job title", target: "jobTitle" },
  { key: "dept", aliases: ["department"], label: "department", target: "orgDepartment" },
  { key: "office", label: "where they work", target: "orgLocation" },
  {
    key: "description",
    aliases: ["jobdescription"],
    label: "what the job involves",
    target: "orgJobDescription",
  },
  { key: "symbol", aliases: ["orgsymbol"], label: "ticker or short code", target: "orgSymbol" },
  { key: "domain", aliases: ["orgdomain"], label: "the organisation's domain", target: "orgDomain" },
  { key: "orgtype", label: "kind of organisation", target: "orgType" },
  {
    key: "phoneticorg",
    aliases: ["orgphonetic"],
    label: "how the organisation sounds",
    target: "orgPhoneticName",
  },
  { key: "notes", aliases: ["note"], label: "notes", target: "notes" },
  { key: "gender", label: "gender", target: "gender" },
];

/** Contact-point kinds addressable by name. */
export const POINT_FIELDS: readonly Addressable<ContactKind>[] = [
  { key: "email", label: "an email address", target: "EMAIL" },
  { key: "phone", label: "a phone number", target: "PHONE" },
  { key: "address", label: "a postal address", target: "ADDRESS" },
  { key: "url", aliases: ["website"], label: "a website", target: "URL" },
  { key: "social", label: "a social profile", target: "SOCIAL" },
  { key: "chat", aliases: ["im"], label: "a chat account", target: "IM" },
  { key: "sip", label: "a SIP address", target: "SIP" },
  { key: "calendar", label: "a calendar address", target: "CALENDAR" },
  { key: "externalid", aliases: ["extid"], label: "an id from another system", target: "EXTERNAL_ID" },
  { key: "keyword", label: "a keyword", target: "KEYWORD" },
  { key: "interest", label: "an interest", target: "INTEREST" },
  { key: "skill", label: "a skill", target: "SKILL" },
  { key: "occupation", label: "an occupation", target: "OCCUPATION" },
  { key: "location", label: "a location", target: "LOCATION" },
];

/** Parts of a structured address, by the names somebody would type. */
export const ADDRESS_FIELDS: readonly Addressable<string>[] = [
  { key: "street", label: "street", target: "streetAddress" },
  { key: "city", aliases: ["town"], label: "city or town", target: "city" },
  { key: "region", aliases: ["state", "county"], label: "state or region", target: "region" },
  { key: "postcode", aliases: ["postalcode", "zip"], label: "postcode", target: "postalCode" },
  { key: "country", label: "country", target: "country" },
  { key: "pobox", label: "PO box", target: "poBox" },
];

function names<T>(entry: Addressable<T>): string[] {
  return [entry.key, ...(entry.aliases ?? [])];
}

function aliasMap<T>(table: readonly Addressable<T>[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const entry of table) {
    for (const name of names(entry)) out[name] = entry.target;
  }
  return out;
}

export const COLUMNS: Record<string, string> = aliasMap(TEXT_FIELDS);
export const POINT_KINDS: Record<string, ContactKind> = aliasMap(POINT_FIELDS);
export const ADDRESS_PARTS: Record<string, string> = aliasMap(ADDRESS_FIELDS);

/** The contact-point kind that holds the same value as a column, for the few that have one. */
export const ALSO_POINT: Record<string, ContactKind> = Object.fromEntries(
  TEXT_FIELDS.flatMap((f) => (f.also ? names(f).map((n) => [n, f.also!]) : [])),
);

/** Every spelling to its own description, for the suggestion list and the help panel. */
export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...TEXT_FIELDS, ...POINT_FIELDS, ...ADDRESS_FIELDS].flatMap((f) =>
    names(f).map((n) => [n, f.label]),
  ),
);

/** The offered spelling of every field in the three tables, aliases excluded. */
export const FIELD_KEYS: readonly string[] = [
  ...TEXT_FIELDS,
  ...POINT_FIELDS,
  ...ADDRESS_FIELDS,
].map((f) => f.key);

// --- clauses --------------------------------------------------------------

export function relationClause(
  relation: Relation,
  viewer: Viewer,
): Prisma.PersonWhereInput {
  /**
   * "Somebody else can see this" is two different facts: a share naming the record, or a
   * blanket grant from its owner that sweeps it up. A blanket grant is not recorded per
   * record — that is the whole point of it — so it has to be tested through the owner.
   */
  const visibleToSomeoneElse: Prisma.PersonWhereInput = {
    OR: [
      { shares: { some: {} } },
      { owner: { sharesGiven: { some: { scope: "ALL_PEOPLE" } } } },
    ],
  };

  switch (relation) {
    case "mine":
      return { ownerId: viewer.id };
    case "shared-with-me":
      return { ownerId: { not: viewer.id } };
    case "shared-by-me":
      return { ownerId: viewer.id, ...visibleToSomeoneElse };
    case "private":
      return { ownerId: viewer.id, NOT: visibleToSomeoneElse };
  }
}

export function googleClause(
  state: GoogleState,
  viewer: Viewer,
): Prisma.PersonWhereInput {
  const userId = viewer.id;
  switch (state) {
    case "on":
      return { addToGoogle: true };
    case "off":
      return { addToGoogle: false };
    case "synced":
      return { googleSyncs: { some: { userId, googleSyncStatus: "SYNCED" } } };
    case "error":
      return { googleSyncs: { some: { userId, googleSyncStatus: "ERROR" } } };
    case "pending":
      // A contact with no PersonSync row for this account has never been pushed, so it is
      // waiting just as much as one explicitly marked PENDING. Leaving that case out would
      // make the filter miss every newly added contact.
      return {
        addToGoogle: true,
        OR: [
          { googleSyncs: { some: { userId, googleSyncStatus: "PENDING" } } },
          { googleSyncs: { none: { userId } } },
        ],
      };
  }
}

/**
 * "This column holds something."
 *
 * Empty string as well as null, because the two arrive from different places and mean the
 * same thing to a person: the form normalises a cleared field to null, but an import writes
 * whatever the other system sent, and `{ not: null }` alone counts an empty string as
 * present. Written as a NOT-OR rather than `{ not: "" }` because Prisma's `not` on a
 * nullable column has to decide what to do about NULL and this way nothing has to be
 * remembered about which way it went.
 */
function presentText(column: string): Prisma.PersonWhereInput {
  return { NOT: { OR: [{ [column]: null }, { [column]: "" }] } };
}

/**
 * The same for a column that is not text.
 *
 * Separate because `{ birthday: "" }` is not a comparison Postgres will make, and the key
 * here is computed — so TypeScript checks nothing and the mistake would be a runtime error
 * in a search box. §29.2 runs every option against the database for exactly this reason.
 */
function presentValue(column: string): Prisma.PersonWhereInput {
  return { [column]: { not: null } };
}

/**
 * The same question about a column on a contact point rather than on the contact.
 *
 * A second function rather than a generic one with a cast: the type is the only thing
 * standing between a where-clause and the wrong table, as TypeScript demonstrated by
 * refusing the first version of this — which spread a Person clause into a ContactPoint
 * filter. Losing that to a cast would be losing the check that found the bug.
 */
function presentPart(column: string): Prisma.ContactPointWhereInput {
  return { NOT: { OR: [{ [column]: null }, { [column]: "" }] } };
}

/**
 * A gift follows its recipient, spelled through the GIVER.
 *
 * The same rule readableGiftsWhere applies, and for the same reason: being able to see Mary
 * does not entitle you to the list of what she gave a household you have no access to. So
 * "has given a gift" means "has given a gift I could already see on her page".
 */
function giftGiven(viewer: Viewer): Prisma.PersonWhereInput {
  return { giftsGiven: { some: { recipients: { some: { person: viewer.readablePeople } } } } };
}

/**
 * Received one. No scoping needed: a gift is readable to whoever may read its RECIPIENT,
 * and the recipient here is the contact being matched, which the outer clause has already
 * restricted to people this viewer may read.
 */
function giftReceived(): Prisma.PersonWhereInput {
  return { giftsReceived: { some: {} } };
}

/**
 * Somebody who is owed a thank-you.
 *
 * Scoped to the cards this viewer may WRITE FOR, not to the ones they may read, and that is
 * the whole difference between a to-do list and a list of things nobody can ever do. A
 * contact who is not a user of the install has nobody to write for them — so a gift to them
 * is never "needing a thank-you", it is simply a gift that was recorded.
 *
 * Both conditions sit inside one `some`, so it is the SAME recipient row that is unthanked
 * and thankable. Two separate `some` clauses would match a gift with a thanked card and an
 * unthankable stranger on it, which is neither.
 */
function unthanked(viewer: Viewer): Prisma.PersonWhereInput {
  return {
    giftsGiven: {
      some: { recipients: { some: { thankedAt: null, person: viewer.thankableCards } } },
    },
  };
}

/** One thing `has:` can ask about. */
export interface PresenceDef {
  key: string;
  aliases?: readonly string[];
  /** Completes the sentence "contacts with …". */
  label: string;
  clause: (viewer: Viewer) => Prisma.PersonWhereInput;
}

/**
 * What `has:` can ask about beyond the three field tables.
 *
 * Everything derivable is derived below, so this list is only the questions that are not
 * "one field, filled in": relations, the two-column ones, and the two that depend on who is
 * asking.
 */
const EXTRA_PRESENCE: readonly PresenceDef[] = [
  { key: "photo", aliases: ["picture"], label: "a picture", clause: () => ({ photos: { some: {} } }) },
  { key: "label", aliases: ["labels"], label: "any label", clause: () => ({ labels: { some: {} } }) },
  {
    key: "birthday",
    aliases: ["dob"],
    label: "a birthday, as a date or in words",
    clause: () => ({ OR: [presentValue("birthday"), presentText("birthdayText")] }),
  },
  {
    key: "birthdaytext",
    label: "a birthday written in words rather than as a date",
    clause: () => presentText("birthdayText"),
  },
  {
    key: "honorific",
    label: "a title before or letters after the name",
    clause: () => ({ OR: [presentText("honorificPrefix"), presentText("honorificSuffix")] }),
  },
  {
    key: "phonetic",
    label: "any phonetic spelling",
    clause: () => ({
      OR: [
        presentText("phoneticGivenName"),
        presentText("phoneticMiddleName"),
        presentText("phoneticFamilyName"),
        presentText("orgPhoneticName"),
      ],
    }),
  },
  {
    key: "custom",
    aliases: ["ownfields"],
    label: "any of your own fields filled in",
    // Compared against the empty object rather than key by key: `custom` is never null (it
    // defaults to {}), and clearing a field deletes its key rather than storing a null, so
    // "not empty" is exactly "something is set".
    clause: () => ({ NOT: { custom: { equals: {} } } }),
  },
  {
    key: "relationship",
    aliases: ["relationships"],
    label: "a relationship to somebody you can see",
    clause: (v) => ({
      OR: [
        { relationshipsFrom: { some: { to: v.readablePeople } } },
        { relationshipsTo: { some: { from: v.readablePeople } } },
      ],
    }),
  },
  {
    key: "event",
    aliases: ["events"],
    label: "been on the guest list of an event you can see",
    clause: (v) => ({ eventAttendances: { some: { event: v.readableEvents } } }),
  },
  {
    key: "gift",
    aliases: ["gifts"],
    label: "given or received a gift you can see",
    clause: (v) => ({ OR: [giftGiven(v), giftReceived()] }),
  },
  { key: "giftgiven", aliases: ["gave"], label: "given a gift you can see", clause: giftGiven },
  {
    key: "giftreceived",
    aliases: ["received"],
    label: "received a gift",
    clause: () => giftReceived(),
  },
  {
    key: "unthanked",
    aliases: ["thanksowed", "owed"],
    label: "given a gift that still needs a thank-you from somebody you write for",
    clause: unthanked,
  },
  {
    key: "user",
    aliases: ["account", "card"],
    label: "a card for a user of this install",
    clause: () => ({ linkedUserId: { not: null } }),
  },
  {
    key: "trash",
    aliases: ["trashed"],
    label: "nothing — trashed contacts are not searchable, use the trash page",
    // Present so that `has:trash` says what it says here instead of "not something to look
    // for", which reads as though the trash were searchable with the right spelling.
    clause: () => ({ id: "" }),
  },
];

/**
 * Every `has:` option: one per field in the three tables, plus the list above.
 *
 * Derived rather than written out, so a field added to a table is answerable by `has:` on the
 * same commit — the mirror of the bug where `gender` and `birthdayText` were stored and
 * synced while being invisible everywhere else.
 */
export const PRESENCE_DEFS: readonly PresenceDef[] = [
  ...TEXT_FIELDS.map((f) => ({
    key: f.key,
    aliases: f.aliases,
    label: f.label,
    clause:
      f.presence ??
      ((): Prisma.PersonWhereInput =>
        f.also
          ? { OR: [presentText(f.target), { contactPoints: { some: { kind: f.also } } }] }
          : presentText(f.target)),
  })),
  ...POINT_FIELDS.map((f) => ({
    key: f.key,
    aliases: f.aliases,
    label: f.label,
    clause: (): Prisma.PersonWhereInput => ({ contactPoints: { some: { kind: f.target } } }),
  })),
  ...ADDRESS_FIELDS.map((f) => ({
    key: f.key,
    aliases: f.aliases,
    label: `an address with a ${f.label}`,
    clause: (): Prisma.PersonWhereInput => ({
      contactPoints: { some: { kind: "ADDRESS", ...presentPart(f.target) } },
    }),
  })),
  ...EXTRA_PRESENCE,
];

/**
 * Name to definition, built once and loudly.
 *
 * A duplicate throws at import rather than letting one definition quietly win — the same
 * failure as two same-named interfaces merging into a type nothing satisfies, and the tables
 * above are now big enough that a collision is a matter of when.
 */
const PRESENCE_BY_NAME = new Map<string, PresenceDef>();
for (const def of PRESENCE_DEFS) {
  for (const name of [def.key, ...(def.aliases ?? [])]) {
    const clash = PRESENCE_BY_NAME.get(name);
    if (clash) {
      throw new Error(
        `Two “has:” options are both called “${name}” (${clash.key} and ${def.key}); one would silently win.`,
      );
    }
    PRESENCE_BY_NAME.set(name, def);
  }
}

export function presenceClause(name: string, viewer: Viewer): Prisma.PersonWhereInput | null {
  const def = PRESENCE_BY_NAME.get(name.toLowerCase());
  return def ? def.clause(viewer) : null;
}

/**
 * The order `has:` options are offered in, most-asked first.
 *
 * Written out rather than left to the order the tables happen to declare things, and the
 * reason is concrete: the suggestion list shows eight at a time, so table order meant
 * typing `has:` offered eight kinds of name and never `email`. §27.4 asserts the head of
 * this list for that reason — the first version of it only asserted membership, which stayed
 * true while the list became useless.
 *
 * Anything not named here follows in table order, which is where the long tail belongs: it
 * is reached by typing, not by scrolling.
 */
const PRESENCE_ORDER: readonly string[] = [
  "email",
  "phone",
  "address",
  "photo",
  "label",
  "notes",
  "birthday",
  "unthanked",
  "gift",
  "relationship",
  "event",
  "org",
  "title",
  "url",
  "nickname",
  "custom",
  "user",
];

/** The offered spellings, most-asked first. */
export const PRESENCE_KEYS: readonly string[] = PRESENCE_DEFS.map((d) => d.key)
  .filter((k) => k !== "trash")
  .map((key, index) => {
    const rank = PRESENCE_ORDER.indexOf(key);
    // Unranked keys keep their table order behind every ranked one.
    return { key, rank: rank === -1 ? PRESENCE_ORDER.length + index : rank };
  })
  .sort((a, b) => a.rank - b.rank)
  .map((entry) => entry.key);

/** Offered spelling to description, for the suggestion list and the help panel. */
export const PRESENCE_LABELS: Record<string, string> = Object.fromEntries(
  PRESENCE_DEFS.map((d) => [d.key, d.label]),
);

/**
 * Text matching: substring by default, whole value on `=`.
 *
 * `city:Sun` finding Sun Prairie AND Sun Gorge is usually what somebody wants, which is why
 * substring is the default and there is no wildcard syntax — there would be nothing for it to
 * enable. `city:="Sun Prairie"` is the way to say only that one, and it exists because the
 * parser already accepted `=` and the compiler used to throw it away: a query that quietly
 * means something other than what it says is worse than one that is refused.
 *
 * Lives here rather than in the compiler because the cross-entity predicates below need the
 * same rule applied to an event's title and a gift's description, and two spellings of "how a
 * value matches" is one that gets fixed alone.
 */
export function matches(value: string, op: Comparison) {
  return op === "="
    ? { equals: value, mode: "insensitive" as const }
    : { contains: value, mode: "insensitive" as const };
}

/** Absolute (2026-08-01, 2026-08, 2026) or relative (30d, 6m, 1y). */
const RELATIVE_DATE = /^(\d+)\s*([dwmy])$/i;
const ABSOLUTE_DATE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** Whether a value would be read as a date if it were given to one. */
export function looksLikeDate(value: string): boolean {
  const trimmed = value.trim();
  return RELATIVE_DATE.test(trimmed) || ABSOLUTE_DATE.test(trimmed);
}

/**
 * A date written the way somebody types it.
 *
 * Relative means "that long ago", which is the form that makes `updated:>30d` read correctly:
 * everything touched since then.
 */
function parseDate(value: string, field: string): Date {
  const relative = RELATIVE_DATE.exec(value.trim());
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

  const ymd = ABSOLUTE_DATE.exec(value.trim());
  if (!ymd) {
    throw new QueryError(
      `“${field}:${value}” is not a date. Try 2026-08-01, 2026-08, or 30d for “30 days ago”.`,
    );
  }
  return new Date(
    Date.UTC(Number(ymd[1]), ymd[2] ? Number(ymd[2]) - 1 : 0, ymd[3] ? Number(ymd[3]) : 1),
  );
}

/**
 * The comparison itself, without a column name attached.
 *
 * Returned bare so the same function can filter a contact's `updatedAt` and an event's
 * `startAt` — the two are different Prisma types and a helper that baked the column in could
 * only ever serve one of them.
 */
export function dateFilter(
  op: Comparison,
  value: string,
  field: string,
): { gte?: Date; gt?: Date; lte?: Date; lt?: Date } {
  const at = parseDate(value, field);
  switch (op) {
    case "<":
      return { lt: at };
    case "<=":
      return { lte: at };
    case ">":
      return { gt: at };
    case ">=":
      return { gte: at };
    default: {
      // A bare date means that day, or that month if no day was given — "created:2026-08" is
      // a question about August, not about the first of it.
      const end = new Date(at);
      const trimmed = value.trim();
      if (/^\d{4}$/.test(trimmed)) end.setUTCFullYear(at.getUTCFullYear() + 1);
      else if (/^\d{4}-\d{2}$/.test(trimmed)) end.setUTCMonth(at.getUTCMonth() + 1);
      else end.setUTCDate(at.getUTCDate() + 1);
      return { gte: at, lt: end };
    }
  }
}

// --- the cross-entity predicates -------------------------------------------

/**
 * These three ask about a contact through another record, which makes each of them an access
 * decision as much as a query. The rule is the same every time: the OTHER record has to be one
 * this viewer could already have found on its own page. A predicate that reveals the existence
 * of an event, a relationship or a gift you cannot open is a leak even when it never shows you
 * what it was.
 */

/**
 * On the guest list of an event.
 *
 * By title, or by WHEN — because "who have I not seen in a year" is the question a relationship
 * manager exists to answer, and it needs the event's date rather than its name. A comparison
 * always means the date; a plain value means the date only if it looks like one. That is
 * stated in the help panel, and the alternative was a second field name for the same idea.
 */
export function attendedClause(
  value: string,
  op: Comparison,
  viewer: Viewer,
): Prisma.PersonWhereInput {
  const byDate = op === ":" || op === "=" ? looksLikeDate(value) : true;
  const event: Prisma.EventWhereInput = byDate
    ? { startAt: dateFilter(op, value, "attended") }
    : { title: matches(value, op) };
  return {
    eventAttendances: { some: { event: { AND: [viewer.readableEvents, event] } } },
  };
}

/**
 * Related to somebody, or related in some way.
 *
 * The value matches EITHER the other person's name or the kind of relationship, because both
 * readings are useful and neither is what somebody would call the other: `related:Mary` and
 * `related:Parent` are both obvious once you know it does both, and a second field name for
 * the second reading would be a thing to remember rather than a thing to guess.
 *
 * Either way the other end must be readable — otherwise `related:Parent` would report that a
 * contact has a parent in a household you have no access to.
 */
export function relatedClause(
  value: string,
  op: Comparison,
  viewer: Viewer,
): Prisma.PersonWhereInput {
  const named = { displayName: matches(value, op) };
  const kind = {
    type: { OR: [{ label: matches(value, op) }, { inverseLabel: matches(value, op) }] },
  };
  return {
    OR: [
      {
        relationshipsFrom: {
          some: { AND: [{ to: viewer.readablePeople }, { OR: [{ to: named }, kind] }] },
        },
      },
      {
        relationshipsTo: {
          some: { AND: [{ from: viewer.readablePeople }, { OR: [{ from: named }, kind] }] },
        },
      },
    ],
  };
}

/**
 * Gave or received a particular gift.
 *
 * Both directions, and scoped the way `has:gift` is: a gift is readable to whoever may read
 * its RECIPIENT, so a received one needs no further test — the recipient is the contact being
 * matched — while a given one is only visible through a recipient this viewer can see.
 */
export function giftClause(
  value: string,
  op: Comparison,
  viewer: Viewer,
): Prisma.PersonWhereInput {
  const gift = {
    OR: [{ description: matches(value, op) }, { notes: matches(value, op) }],
  };
  return {
    OR: [
      { giftsReceived: { some: { gift } } },
      {
        giftsGiven: {
          some: {
            AND: [gift, { recipients: { some: { person: viewer.readablePeople } } }],
          },
        },
      },
    ],
  };
}

/** Fields that take `>` and `<`, because their value is a date somewhere. */
export const COMPARABLE_FIELDS: readonly string[] = ["attended", "event", "seen"];

/** Text search across the columns and contact points a person is findable by. */
export function anywhereClause(q: string): Prisma.PersonWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" } as const;
  return {
    OR: [
      { displayName: contains },
      { nickname: contains },
      { organization: contains },
      { jobTitle: contains },
      { notes: contains },
      { contactPoints: { some: { value: contains } } },
      // Labels are searchable by name too: typing "family" into the box should find the
      // label's members even if the user never touched the filter UI.
      { labels: { some: { label: { name: contains } } } },
    ],
  };
}

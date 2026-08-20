# Working on Hearth

A self-hosted personal relationship manager: contacts, events, relationships, labels,
gifts, one-way sync out to Google. Next.js 15.5 App Router · React 19 · Prisma 6 ·
Postgres 16 · Auth.js v5 · Tailwind 4 · TypeScript. Deployed as a single Docker container
on Unraid behind SWAG, pulled from `gitlab.com/hammerling/hearth`.

[README.md](README.md) is for someone running Hearth. This file is for someone changing it.

## Commands

```bash
npm run typecheck   # app + e2e suite. READ THE OUTPUT — never background it and assume
npm run build       # needs the max-old-space flag it already carries
npm run e2e         # builds, then drives a real browser through 489 checks
npm run e2e:google  # Google-facing half. DESTRUCTIVE — see below
```

## Invariants that are load-bearing

**Every read of a contact or event goes through `src/lib/access.ts`.** No query inlines
`{ ownerId }`. This is the bet the codebase made in M1, and it has paid twice: sharing was
a rewrite of those clauses and nothing else, and the trash was one `deletedAt: null` line
in each. Breaking it costs the next feature, not this one. The one query that broke it —
the event push queue — would have pushed a trashed event back to the calendar it was just
deleted from.

**`MANAGED_PERSON_FIELDS` in `serialize-person.ts` is an update mask.** A field listed
there and not sent is **deleted from Google**. Unlisted fields are untouched; listed
*groups* are replaced wholesale. This is why "a real column for every Google field" was a
bug fix: Hearth had been deleting middle names, address structure and departments on every
push. Adding a field Hearth reads without adding it here is data loss, and it is silent.

**The trash never empties itself.** No retention window, no pruning job, no "after 30
days" setting — ever, by explicit design. Bulk convenience for the human (Empty trash) is
fine; automatic expiry is not. Restoring must keep working, so trashing keeps every related
row and only filters reads.

**Thank-yous are only ever written by users of the install.** `thankableCardIds` returns
your own card plus, if you are head of household, any card whose owner ticked
*allow head of household*. A contact who is not a user has nobody to write for them — that
is the answer, not a gap. A note is signed by whoever sends it.

**A gift follows its recipient, never its giver.** Seeing Mary must not reveal what she
gave a household you cannot access. `GiftRecipient` carries the thanks, because a present
shared between two children earns two notes.

**Events keep no history, deliberately.** An event happened on a date and is then over; a
contact is meant to persist and change for years. Don't propose `EventVersion`.

## Traps this codebase has actually hit

- **TypeScript's excess-property check does not apply to variables or spreads.** Three
  separate times a nested or misspelled field compiled cleanly and dropped data at the
  Prisma boundary. A green typecheck is not evidence at a Prisma or Google boundary.
- **`satisfies keyof Person` only checks one direction.** `gender` and `birthdayText` were
  stored and synced while being invisible in the form, list, mapping and page.
- **Postgres `jsonb` normalises key order.** `JSON.stringify` comparison of a snapshot read
  back always differed; `canonical()` in `person-history.ts` sorts keys recursively.
- **Two same-named interfaces silently merge** into a type nothing satisfies.
- **A dynamic `import()` still creates a bundling edge.** `auth.ts` → googleapis reached a
  client bundle through `access.ts`; hence Prisma-only `google/grant.ts`.
- **Auth.js's adapter writes `Account` once and never updates it.** Reconnect Google did
  nothing for weeks. `persistGoogleGrant` on `events.signIn` fixes it, and leaves a missing
  `refresh_token` alone.
- **React 19 resets an uncontrolled form after its action settles, failure included.** A
  failed thank-you lost what was typed; the textarea is controlled now.
- **`textContent("body")` sees the RSC flight payload** inlined in a `<script>`, so
  `"thanked":false` satisfied a positive assertion. Use Playwright's `text=` engine.
- **Next's build worker OOMs where `tsc` passes.** One unused
  `Awaited<ReturnType<typeof findMany>>[number]` did it. Declare return types explicitly.
- **Tailwind variant guards are tested against the element the utility sits on**, not the
  root. `:not([data-theme="light"])` on `<body>` matched everything; every branch of the
  `dark:` variant is anchored at `:root`.

## Tests

`scripts/e2e/verify.mts`, one long flat `try` block — section numbers match
`docs/verify-*.md`. Consequences:

- **Names collide across sections.** Check before declaring; esbuild's error is the only
  warning you get.
- **Server actions are unreachable**: `requireUserForAction` reads `headers()`. Drive them
  through the browser, or call the split-out helper (`findPeopleMatching`, not
  `searchPeople`). Never assert on a call that throws before reaching the logic — it passes
  for the wrong reason.
- **A check that can pass without the feature working is not a check.** Assert painted
  colours over attributes, counted deltas over absences, a tooltip's own text over the
  page's. Say what failed as the third argument, never bare `true`.
- **`:has-text()` matches substrings.** "Add" found the "Add to Google" button above it, so
  two label checks failed for two runs while the code was right. Use `:text-is()` whenever
  one button's name is a prefix of another's.
- **`waitForDb`, not a toast**, when the assertion is about a write: `revalidatePath` can
  sweep the message away before it is read.
- Leave state clean for later sections, and remember new fixtures invalidate old absence
  assertions.

## Process

- **Migrations are hand-ordered SQL.** Write it, then `./scripts/check-migrations.sh`; it
  refuses destructive statements. Never `prisma migrate dev` against anything real.
- **`.env.e2e` holds real Google refresh tokens and is gitignored.** Never commit it.
- **`npm run e2e:google` is destructive** and refuses to run against an account that looks
  like a real address book (>25 contacts, >12 groups) or when both tokens resolve to the
  same account.
- **Deployment is pull-based, so "pushed" is part of "done".** Reporting a feature
  complete while the commit sits local is a false report.
- **Commit messages**: a short imperative title, then prose explaining *why* and what was
  learned — including the bug that was interesting and how it was caught. End with the
  check count and:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Push only when asked.** Update `## [Unreleased]` in `CHANGELOG.md` with every
  user-visible change, and README when it changes what an operator sees or must configure.

## Known open items

- **The Google round trip is verified against a whole real address book, read and write.**
  330 contacts read (two pages, so paging is exercised) and then **all 330 pushed back** with
  `google-write-check.mts --all`: zero field groups lost, and `memberships` and `photos`
  untouched on every one. Google recomputes `displayName`, `displayNameLastFirst`,
  `unstructuredName`, `canonicalForm` and `formattedValue` from what it is sent, so omitting
  them costs nothing — 300 phone numbers came back identical. `birthdays[].text` is NOT
  regenerated: dropping the echo is a real change, and a deliberate one.
- **A helper with tests and a call site without them is where the bug lives.** The photo
  import had unit tests for choosing the URL, downloading it and storing it, and nothing
  exercising the import that calls all three. `importOne` is now in `google/import-one.ts`
  rather than inside the action, so §17.25 drives a Google payload to the rows it produces —
  picture included — with no request and no Google account.
- **React drops a submitter's `name`/`value`** when a form goes to a function action, so one
  form with several buttons cannot learn which was pressed that way. Every "add" silently
  became the "remove" that was its fallback. `SubmitButton`'s `beforeSubmit` sets a hidden
  input instead.
- **A tombstone must know which record it was queued for.** Matching a queued deletion by
  Google resource id alone meant it settled onto whatever row held that id when it ran, so
  deleting a contact and re-importing the same one disabled the new contact and deleted the
  Google copy. `SyncTombstone.personId` scopes it; `forgetGoogleLink` is the part that
  touches Hearth's rows, split out because that is the part that did the damage.
- **A group-level loss check is not a loss check.** `google-write-check.mts --all` reported
  a clean run while 41 custom fields were deleted from inside `userDefined`, because every
  contact had gained a `hearth_id` and so every group was still non-empty. It compares
  entries now. Any "did anything disappear" check over a repeated field has this trap.
- **Never edit a module while a long write against Google is using it.** A bulk run that
  started on one version of `import-plan.ts` and finished on another cannot be attributed,
  and re-running it is the only fix. `.probe/all-before.json` is saved before the first write
  precisely so a run like that is recoverable — `google-restore-userdefined.mts` put the 41
  fields back.
- **A push is idempotent.** Proven by pushing the same 330 contacts twice: the second run
  came back `0 rewritten, 0 LOST` on every group. The first run trims whitespace (a trailing
  space on an organisation, a leading one in a middle name) and drops Google's redundant
  birthday echo; after that the account holds exactly what Hearth sends.
- Run the read-only probe first on any new address book; it says what a push would clear
  before a push happens. `--field <group>` shows the contacts a named group would change.
- **Nine field groups are unreachable by hand**: `imClients`, `sipAddresses`, `calendarUrls`,
  `externalIds`, `miscKeywords`, `interests`, `skills`, `locations`, `genders`. Not one of
  327 real contacts carried any — Google's own interface does not appear to create them, so
  they arrive only from other clients. Covered by fixtures (§17.11) and not testable against
  a real account without another client to write them; treat that as answered, not pending.
- `birthdays[].text` is deliberately not sent back when it only echoes the date. That is a
  choice, not a measurement: no dummy contact carried an echo, and the ones that did were
  real people.
- Honorifics are NOT lost — Google's own UI stores them structured and Hearth returns them
  there. What is lost is a name that arrived from another client as one unsplit string: it
  comes back as a first name. Preferring `unstructuredName` over the parts would be a change
  to the most dangerous write path in the app, so this stays a stated limit.
- One organisation per contact; `clientData` untouched.
- Contact history is read-only — reverting would have to write back through the same
  validation and sync path as an edit.

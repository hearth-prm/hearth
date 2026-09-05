# Changelog

All notable changes to Hearth are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Hearth uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From `1.0.0` onward this is ordinary Semantic Versioning: a breaking change to the
database, the environment or the Google contract is a **major**, a feature is a
**minor**, a fix is a **patch**.

Up to `1.0.0`, each planned milestone landed as a minor bump, cut once that
milestone had been confirmed working against a real Google account — not when the
code was written. That rule survives in spirit: nothing is released on the strength
of a green test suite alone where a real address book can be asked instead.

| Version | Milestone |
|---|---|
| `0.1.0` | M1 — data model, extensible fields, CRUD, Google sign-in |
| `0.2.0` | M2 — one-way contacts push to Google |
| `0.3.0` | M3 — calendar push, attendee invites, RSVP writeback |
| `0.4.0` | M4 — field↔Google mapping settings, record sharing |
| `0.5.0` | M5 — labels, CSV import/export, contact filtering |
| `0.6.0` | M6 — appearance, gifts and thank-yous, household cards, in-place Google import, contact history, the trash, bulk actions |
| `1.0.0` | M1–M6 shipped, and verified against a real Google address book in both directions |

## [Unreleased]

### Changed

- **An event that does not go to Google no longer asks for an attendee's role.** Host,
  required and optional read as though they described the event, but the only thing that
  value has ever done is set `optional` on a Google invitation — HOST and REQUIRED are one
  value to Google, and nothing else reads it. On an event Hearth keeps to itself it changed
  nothing at all. Role, RSVP and the invite box were the whole of the per-guest form, so the
  form goes with them rather than leaving an Update button that saves nothing; Remove and the
  add form stay, because a guest list is still a list you edit. The stored role is kept, not
  reset, so sending the event to Google later still tells the truth.

### Added

- **`try-hearth.sh` — a throwaway Hearth beside the real one**, for testing a build without
  releasing it. Clone into a temp directory, run it from that clone, try things, `--down`,
  delete the directory. Production's checkout, `.env` and containers are never touched.
  - It uses the checkout it sits in and defaults the image to `sha-<HEAD>`, so cloning at a ref
    tests exactly that commit and the compose file cannot describe a different build than the
    one running.
  - **It reports the schema.** Before starting the app it lists every migration the build will
    apply to the test database and names any marked destructive; afterwards it confirms each one
    landed. That is the whole reason to test on a copy of real data: a migration that *copies*
    data is invisible to the automated suite, whose database is always empty.
  - **`--from ssh://user@host/path`** tests a build on a different machine from the one
    production runs on: the dump and the settings come over ssh — compressed on the far side —
    and everything else stays local. The port and data-directory guards stand down for a remote
    production, since nothing local can collide with it. Password authentication works as well
    as a key: the run shares one connection for both trips to the server, so a password is
    asked for once.
  - **`--down` now actually tears down.** Postgres writes `.try/postgres` as its own uid at
    mode 700, so the person who started the stack could not delete it: the `rm` failed
    partway — after taking the dump with it — and `set -e` ended the run *before* removing
    `.env.try`, leaving production's `AUTH_SECRET`, database password and Google client
    secret on disk. The secrets are now removed first, and the data directory is deleted by
    a throwaway container using the same Postgres image, so no `sudo` is needed. If even
    that fails it says so, and prints the command to run.
  - `--down` no longer prints an image tag it has no use for.
  - Checks the image tag exists **before** asking for an ssh password or dumping
    production. CI builds one image per commit and takes a few minutes, so running this
    straight after a push used to spend the password, the dump, a Postgres container and a
    restore before compose reported the tag missing. The refusal names `--tag edge` and the
    registry listing. An unreachable registry falls back to a copy already pulled.
  - Refuses to start on **Docker Compose v1** with a message naming the cause, instead of
    letting v1 fail on the top-level `name:` with "'name' does not match any of the regexes"
    and advice to add a `version:` key that would not help. `scripts/docker-up.sh` asks the
    same question.
  - The test stack **cannot write to Google**: it sets `HEARTH_GOOGLE_WRITES=off` and clears
    `HEARTH_ENABLE_MAIL`. It holds a copy of production's database, so it holds a working
    Google grant and every unsent thank-you along with it.
  - `--status` and `--down` no longer read production's settings at all — they never needed
    to, and under password authentication it meant logging into a server to tear down a
    local stack.
  - `--status`, `--down`, `--empty`, `--dump`, `--data`, `--port`, `--project`, `--from`.

### Added

- **`HEARTH_GOOGLE_WRITES`** — set it to `off` and this install will not write to Google by
  any route: no contact push, no calendar push, no thank-you mail, whether from the background
  loop or from a button. Default on; you only want this for a test install standing on a copy
  of a real database. Deliberately distinct from `SYNC_ENABLED=false`, which stops the loop and
  leaves the button working on purpose.
  - It exists because `docker-compose.yml` pins `name: hearth`: a second checkout on one host is
    the *same Compose project*, and one forgotten `-p` recreates production with the test
    configuration. That has happened here. Every compose command the script issues carries the
    project name, and it refuses to start if the project, port or data directory would collide —
    each guard exercised, along with the `.env` rewriting against passwords containing `/`, `&`,
    `$` and `=`.
  - Google sync is off in the test stack, since it inherits production's grant and pushing to
    the same account would be indistinguishable from the real install doing it.

### Fixed

- **The time zone picker could not display its own default, and saving Settings overwrote it.**
  `Intl.supportedValuesOf("timeZone")` offers 418 canonical zones and includes neither `UTC` nor
  `Etc/UTC` — while the stored default *is* `UTC`. A `<select>` whose value matches no option
  shows the first one, so every fresh install displayed **Africa/Abidjan** as its default zone,
  and saving that page without touching the picker submitted Africa/Abidjan over the UTC that
  was stored. `commonTimeZones()` now puts UTC back at the front. **Check your Settings** if you
  have ever saved that page.
- **A saved time zone snapped back to the old value.** React 19 resets a form once its action
  returns, and for a controlled select that reset lands on the DOM with no re-render to correct
  it. Re-asserting the value in an effect is not enough — the saved value usually equals what
  state already holds, React bails out of a set with an equal value, and no render happens. A
  counter used as the element's `key` changes every time by construction. Both fixes were proven
  necessary by removing each in turn and watching its own check fail.

### Added

- **The footer shows the commit beside the version** — `v1.2.0 · cc5f8aef` — because the version
  alone does not identify a build: two installs both reporting v1.2.0 may be running different
  code, and a bug report has to be able to say which. The build time stays on hover.
- **Settings offers the time zone your browser reports**, as a one-click suggestion when it
  differs from what is stored. The setting already existed and already defaulted every new event;
  what was missing was any way to find your own IANA name, which is how a setting goes unset for
  months while every event gets its zone corrected by hand.

### Added

- **A gift can be from several people**, because a present from a couple is one present. Both
  sides of the record are checkbox lists now, and a gift's row names everyone on each end.
- **A thank-you goes to all the givers or to each of them separately**, chosen at the moment of
  sending rather than in settings — the right answer depends on who the givers are, which
  varies per gift. The dropdown appears only when there is more than one person to address, and
  each option explains itself on hover:
  - **One email to everyone** (the default) — everyone in the To line, so it reads as a shared
    note. Right for a couple, or a family who know each other.
  - **A separate email to each** — the same words sent individually, so nobody sees the others'
    addresses. Right for people who do not know each other.
  - **One email, addresses hidden** — Bcc, addressed to you. Private, but reads a little oddly.
  - How it was addressed is recorded **on the note**, not read from a setting, because a
    setting describes what happens next and a record has to describe what happened then.
- **Attachments on a thank-you** — up to 5 files and 15MB in total, which is what an email can
  actually carry once base64 has added its third. Stored in the database like contact photos, so
  a dump is still the whole install. A group note carries one copy however many people it goes
  to. Refused *here*, naming the file and its size, rather than at Gmail's API where the same
  problem arrives as an unreadable 400.

### Changed

- **`GiftRecipient.thankedAt` and `Gift.giverId` are gone.** Once a present can come from
  several people, "has this recipient said thank you" stops being a single fact — you may have
  written to Karen and not to Kenny — so the thanks became what they always were in spirit: a
  record of something Hearth sent. There is still no checkbox; writing the note is still the
  record.
  - `has:unthanked` is now exact **per giver**: thank Karen individually and Kenny stays on the
    list. That needed a structural correlation Prisma can express — `ThankYouSendGiver.giftId`
    duplicates `send.giftId` so the row can relate to its `GiftGiver`, because a filter nested
    under Gift cannot refer back to the giver it came from. §37.5 asserts the two always agree.
  - A send that **failed** for one giver is still owed. `sentAt` is stamped per giver as each
    message actually goes, so two succeeding and the third bouncing produces a truthful record
    and an honest message, rather than a note that claims everybody or nobody.
- The migration copies every existing gift and every existing thank-you into the new tables
  before dropping the three old columns, and is marked `allow-destructive` because it must be.
  `npm run check:gift-migration` proves the copy: it applies the 29 migrations before it, writes
  old-shaped rows by hand, applies it, and asserts what came out — including that a note keeps
  the time it was actually sent and gains no invented sender or address. **The e2e suite could
  not have caught a fault there**, because its database is always fresh and the copy runs
  against zero rows.

### Changed

- **An event that does not go to Google no longer asks about RSVPs.** No Google means no
  invitations, and no invitations means nothing anybody could have replied to — so the RSVP
  badge, the RSVP dropdown and the "invite in Google" checkbox are gone from such events, and
  whoever is on the guest list is taken to have been there.
  - This is the *majority* case, not an edge one: `Event.addToGoogle` defaults to **false**,
    precisely because "most of what Hearth records is history — who was at a gathering — and
    history does not belong on a calendar". So a permanent "No reply" has been showing against
    people who were in the room on nearly every event.
  - It also makes the page agree with the search rather than changing what either means:
    `attended:` has always counted anyone on the guest list, regardless of RSVP.
  - The stored `rsvp` column is **interpreted, not rewritten** — nothing is set to "Going".
    Switch such an event to Google later and it starts from "No reply" honestly, instead of
    claiming a roomful of confirmations nobody gave.
  - Hidden inputs carry the current RSVP and invite flag through the edit form, because
    `updateAttendee` writes `rsvp: parseRsvp(readString(form, "rsvp"))` unconditionally and
    `parseRsvp` falls back to `NEEDS_ACTION`. Without them, changing somebody's *role* would
    have silently reset their RSVP and unticked their invite. §36.3 is that guard.

## [1.2.0] — 2026-09-03

### Added

- **Hearth can be installed by somebody else.** The pieces that were missing rather than
  broken:
  - **A published image.** `.gitlab-ci.yml` builds and pushes to the project's own container
    registry — `:edge` from every commit to the default branch, and `:1.2.3`, `:1.2`, `:1`,
    `:latest` from a version tag. No credentials are configured anywhere: CI's own per-job token
    does it, which is why the image lives in this project's registry rather than somewhere that
    would need a personal token in CI settings. amd64 only; arm64 would mean QEMU and most of an
    hour of CI minutes per release, and anyone on arm builds from source.
  - **`docker compose up -d` now pulls instead of building.** A Next.js build wants the
    max-old-space flag the Dockerfile carries and a couple of gigabytes of RAM, which is more
    than a small NAS has spare — an operator should never be asked for it. Building moved to
    `docker-compose.build.yml`, named explicitly rather than as an override that applies by
    accident.
  - **[docs/google-setup.md](docs/google-setup.md)** — the whole OAuth setup for somebody who
    does not know what OAuth is, with *publish the app* given its own step and its own warning,
    because skipping it is the bug everybody would otherwise report: sync works for seven days
    and then stops, for ever. Plus a failure table, the Workspace shortcut, and why verification
    is not needed for an install with one user.
  - **A Community Applications template** for Unraid, with an icon rendered from the app's own
    mark, and `unraid/README.md` covering what CA's policies require of a submission — GitHub
    hosting with 2FA, a forum support thread, a publicly pullable image, no code injection.
    CA templates describe one container and Hearth is two, so the template takes a
    `DATABASE_URL` pointing at a Postgres installed separately; its Overview says so first.
  - **A quickstart, a privacy statement, and reverse-proxy examples** for Caddy, nginx and
    Traefik — SWAG was the only one documented. Plus backup and restore recipes that do not
    assume the Unraid script, since the database is the entire install, photos included.
  - Issue templates asking the four questions that decide whether a bug can be reproduced.

### Changed

- **The Gmail scope is opt-in.** `HEARTH_ENABLE_MAIL=true` turns on thank-you emails; without
  it the scope is never requested, and the sign-in page's consent list does not promise it. Most
  people running a relationship manager will never email a thank-you, and asking every install
  to grant mail-sending access in order to sync contacts is the wrong trade — the consent screen
  is where somebody decides whether to trust this, and it should not carry a permission the
  install has no use for. Gmail is also the scope category Google controls most tightly, which
  matters to anyone who ever wants their app verified.
  - The bug that change would otherwise have shipped with: `needsReconnect` counted a missing
    mail scope as an incomplete grant, so every default install would have shown "Reconnect
    Google" permanently over a permission it deliberately did not want. §35.3 is that check, and
    it had to be taught to hold the other scopes still — it first failed on a grant that was
    missing contacts and calendar for unrelated reasons, which made it a check about the wrong
    thing.
  - Settings now distinguishes *not requested* from *not granted*, since telling somebody to
    reconnect for a scope the install never asks for is advice that cannot work.

### Added

- **Hearth is licensed under the AGPL-3.0.** `LICENSE` carries the full text, and the footer on
  every page offers a link to the source of the running version — which is what the licence asks
  of software people reach over a network. `HEARTH_SOURCE_URL` points that link at a fork, so an
  operator who has modified Hearth is compliant by setting a variable rather than by editing
  code.
- **`HEARTH_ALLOWED_EMAILS` — who may sign in.** Addresses, or `@domain` for anyone at a domain.

### Fixed

- **Anyone with a Google account could join the install.** There was no sign-in gate at all: a
  stranger who reached the sign-in page became a user, was given a contact card, and — because
  every household card is shared with every user — could see every household member's card.
  - It had been invisible because the Google OAuth app was in "Testing", where Google's own
    test-user list *was* the allowlist. Publishing the app removed that gate silently. That is
    the shape of a whole class of self-hosting bug: a control that exists in one environment by
    accident and in nobody else's.
  - Three rules, in order: somebody who already has an account may always sign in; if the
    install has no users at all, the first sign-in claims it; otherwise the address must match
    `HEARTH_ALLOWED_EMAILS`. Leaving the variable unset is therefore safe for an install that
    already has a user — but it should be set before first boot on anything internet-reachable,
    or the first stranger to find the URL claims the install.
  - Rule one is deliberate: a typo in the variable must not lock the operator out of their own
    Hearth, which is likelier than admitting somebody who already has an account. Removing
    access means removing the user.
  - The refusal happens in Auth.js's `signIn` **callback**, which `@auth/core` runs before the
    adapter creates anything — so a refused stranger leaves no user row, no contact card and no
    card shares behind. Verified by reading the callback flow, and recorded in the code, because
    the harness seeds sessions directly and cannot drive it.
  - The refusal names the variable on the sign-in page, since whoever reads that message is
    usually the person who can edit it, and is distinguishable from Google itself denying
    consent.

### Added

- **Shared labels.** A label can carry standing sharing intentions: mark one as shared with
  Karen, and every contact you file under it is shared with her automatically. Take the contact
  out and the share goes — unless another label still implies it. Filing a contact is the thing
  people actually do; sharing is the thing they forget.
  - **It works both ways.** The participant set is symmetric: Karen sees the label too, can
    file her own contacts under it, and those are shared back with you and with everyone else in
    it. A shared label is a shared filing cabinet, not a distribution list. One rule covers both
    directions — *share from the contact's owner to every other participant* — where two rules
    would have needed a decision at every call site about which applied.
  - **Reconcile, not react.** One function recomputes the shares a contact's labels imply, and
    it is called from all six paths that put a label on a contact: the picker, bulk labelling,
    CSV import, the Google in-place import, ownership transfer, and restoring from the trash.
    The obvious alternative — delete the shares a removed label implied — revokes access that a
    *second* label still implies. Recomputation gets that right without knowing it was a hazard,
    and §33.12 runs four separate label-arrival paths to the same shares.
  - **A hand-made share and a rule-made one coexist**, as two rows. Every access clause tests
    shares with `some`, so a manual VIEW beside a rule-made EDIT is simply EDIT: permissions are
    additive with no merge logic anywhere. Reconciliation never raises, lowers or removes what a
    person granted — proved by removing the provenance filter and watching §33.6 swallow the
    hand-made share and §33.6c destroy it.
  - **A share from a label says so** on the contact's sharing card — *"via Shared-Contacts"* —
    and has no × of its own, because withdrawing it means taking the contact out of the label.
    Otherwise the first thing anyone does is revoke it and watch it come back. The card groups by
    recipient now rather than listing rows.
  - **Only the owner edits the set**; participants see it. A participant who could edit it could
    add somebody and expose the owner's contacts to them.
  - The editor states the consequences before you save: how many contacts it will share, that it
    works in both directions, and that shared contacts appear in the other person's Google
    Contacts and disappear again when withdrawn.
  - **Ownership transfer converts sticky shares to hand-made ones** rather than revoking them.
    Transfer already deletes a contact's labels and deliberately keeps its shares so nobody
    silently loses access; a strict reconcile would have revoked exactly the access that promise
    protects.
  - A trashed contact is skipped rather than stripped — its shares are dormant anyway, since
    every access clause filters `deletedAt` — so restoring it has something to restore, and the
    restore is where reconciliation runs again.
  - Stickiness is **derived from the participant rows**, not a flag. A boolean saying "sticky"
    with nobody in the set would be a state that does nothing, and one saying "not sticky" with
    people in it would be a trap.

### Added

- **`attended:`, `related:` and `gift:` — asking about a contact through another record.**
  - `attended:Picnic` by event name, `attended:>1y` by when, and therefore `-attended:>1y` for
    *who have I not seen in a year* — the single most valuable query in the language and the
    reason event dates were worth the ambiguity. A comparison always means the date; a plain
    value means the date only if it looks like one, and otherwise the title. A second field name
    for the same idea would have been a thing to remember rather than a thing to guess.
  - `related:Mary` or `related:Parent` — the other person's name, or the kind of relationship.
    Both readings are useful and neither is what you would call the other. The box offers your
    relationship kinds after `related:`.
  - `gift:kite` matches a gift's description or its notes, in either direction.
  - **Each is scoped to what the viewer can already open**, which is the part that matters: a
    predicate revealing that an event, a relationship or a gift exists is a leak even when it
    never shows what it was. `related:Parent` will not report a parent in a household you cannot
    see — asserted by kind as well as by name, since that is the leak that is easy to miss — and
    a gift is visible only through a recipient you can see. §32 checks all four from both sides,
    and removing the scoping fails exactly those four.
  - They compose with everything: `label:Family (attended:Reunion or gift:kite)` works, and they
    chip like any other term.

### Fixed

- A check of my own that could pass or fail on the clock. `updated:>30d` resolves against
  `new Date()` at compile time, so comparing two compiles of the same query with
  `JSON.stringify` failed at random — §31.10 had been passing because the two calls landed in
  the same millisecond. It now compares structurally with a two-second tolerance on dates, plus
  a guard (§31.10c) that two genuinely different dates still compare as different, so the
  tolerance cannot be hiding a real difference. Found while deliberately breaking the §32
  access scoping to check it bites: the run reported a fifth failure that had nothing to do with
  the change.

### Added

- **Brackets group, and a group is a chip.** `(-has:email or -has:phone) semantic:cars` is two
  chips — the group and the ranking — so order of operations is visible and removable rather
  than being a query the row refused to take apart. Brackets appear in a chip only when they are
  load-bearing: `(a b) or c` means the same without them and normalises to three ordinary chips.
  A group's × removes everything inside it, and the tooltip says so, because what is inside is
  not editable from the row.

### Fixed

- **Typing `or -has:email` with a chip already in place** searched for the phrase instead of
  adding an OR chip and a term. The whole phrase was handed to the parser, `or` has nothing
  before it, and the fallback for unparseable text turned it into one `like:"or -has:email"`
  chip. A leading `or` or `and` is now read as the connector. A connector on its own is a no-op
  when there is a row to join to and an ordinary word search when there is not — asymmetric on
  purpose: with no row there is nothing for it to connect.
- **Adding a term to a row containing an OR now brackets the OR** instead of quietly binding to
  the term before it. `a OR b` plus `has:email` meant `a OR (b AND has:email)` — the precedence
  is correct and was documented as such, but it is not what adding a chip to a row of two means.
  Now that a group can be a chip, the intended grouping is both produced and shown.
- **`-has:email or -has:phone semantic:cars` was refused with no way forward.** It is still
  refused — the ranking sits inside the `or`, where a cosine distance means nothing — but the
  message now names the fix rather than only the problem: bracket the `or`.

### Added

- **The search box is a row of chips.** Enter turns what you typed into one chip per term and
  empties the box, so `-has:email -has:phone` becomes two chips rather than one opaque phrase —
  and the next thing you type is added to the right instead of replacing what is there.
  - Between chips sits an **AND** you can change to **OR** from a small dropdown.
  - A bare word commits as `like:bob`, and `like:` is now a real predicate rather than a
    display convention. A chip whose label differs from the query it stands for is exactly the
    bug this row is built to avoid, so the round trip has to be exact.
  - Each × removes just that term. The chips *are* the query string — every edit re-prints the
    whole row into `q` — which is what keeps a filtered list a bookmarkable URL. A chip row held
    in component state would look identical and be none of those things.
  - **AND binds tighter than OR**, as in SQL, so a row reading `a OR b AND c` means
    `a OR (b AND c)` and a chip added after an OR joins the term before it. That was found by a
    test asserting the opposite: the honest fix was to state the rule in the help panel and
    assert the compiled clause, rather than silently inserting brackets somebody did not ask
    for. A genuinely bracketed query is kept whole as one chip rather than taken apart wrongly.
- **Saved filters.** Name the filter you are looking at and it is one click away afterwards, with
  the filter itself as the hover text so a name you no longer remember is not a mystery.
  Selecting one replaces the current chips.
  - What is stored is the **URL search string**, not a parsed copy: a filter is "the list I was
    looking at", so whatever the language grows next is already covered without a migration and
    without a second parser to keep in step with the first. A column per filter dimension would
    have needed altering for each of the last four phases.
  - Saving twice under one name replaces rather than accumulating — the menu is a list of names,
    and two rows called "Christmas cards" would be indistinguishable. Private per user, since a
    filter can name a label id that means nothing in anybody else's account.

### Changed

- **The Filter menu is now the saved-filter menu.** Everything it used to offer — Who, Google,
  Details, Labels — is a predicate in the query language and belongs in the chips. The URL
  parameters those controls set still work, so an old bookmark or a saved filter carrying them
  still opens and their chips are still removable; nothing new produces them.
- The chip row and the Filter menu's Details section already shared one definition; the query
  `q` was the last thing rendered as a single pill and is now the row itself.

### Fixed

- Removing a label chip would have cleared the search along with it. `activePills` builds each
  pill's remove-link from the filter it is handed, and suppressing the old query pill by passing
  a blanked `q` meant every other pill's link dropped the query too. Caught before it shipped,
  and the fix was to delete the pill rather than blank the filter.

- **`semantic:` — searching by meaning.** `semantic:healthcare` finds the contact whose job says
  *Registered Nurse at UW Health*, which nothing else in the box can do. Each contact's
  descriptive text becomes a vector through a local embedding model, the query becomes one too,
  and the answer is the nearest — closest first.
  - It **ranks rather than filters**, and is one predicate inside the language rather than the
    whole search. `-semantic:x` and `label:A or semantic:x` are refused with a reason, because
    a cosine distance has no mechanism for "not similar": every contact is some distance from
    every query, so a negated ranking is everybody or nobody depending on an arbitrary cut.
  - A **count, not a threshold** — top 25, `semantic:"keen gardener"~50` to change it. That was
    a measurement rather than a preference: `scripts/probe-semantic.mts` ranks four invented
    contacts against the real model, and "who works with children" separates the teacher from
    the Java developer by 0.008 while "healthcare" separates the nurse from him by 0.066. No
    single threshold does both. A count needs no tuning and means the same thing whatever the
    model.
  - The ranking happens **inside** what the rest of the query and the access clauses allowed,
    not before them. §30.17 proves a contact somebody cannot see is never ranked for them,
    however good the match, while the viewer who can see her gets her first — so the check
    cannot pass on an empty ranking.
  - Indexed text is chosen for access rather than for richness: organisation, job, department,
    role, labels, occupations, skills, interests, keywords, **gifts received** and notes. Not
    the gifts a contact **gave** and not the events they attended — a vector is built once and
    scored for everybody who can read the contact, so anything in it must be readable by all of
    them, and those two are not. Not names, emails, phones or addresses either: those are
    searched exactly, and embedding them makes an exact answer fuzzy.
  - Staleness is decided by **hashing the text**, not by a timestamp. Adding a label or
    recording a gift changes what a contact means without touching `Person.updatedAt`, so a
    timestamp queue would go stale in exactly the cases this feature exists for. The model name
    is part of the hash, so changing `OLLAMA_EMBED_MODEL` re-embeds instead of silently mixing
    two vector spaces.
  - **Settings reports the index** — how many are indexed, how many waiting, and an *Index now*
    button — because a stale index is the one failure here with no error message: a contact
    whose vector is out of date does not look wrong, it just stops turning up. A search running
    against contacts not yet indexed says so under the box.
  - If the model is unreachable the search **narrows to nothing and says why**. Ignoring the
    ranking would widen the selection to everything matching the rest of the query, and "select
    all matching" would then mean something other than what the page showed.
  - `Float[]` and brute-force cosine in Node, not pgvector: `postgres:16-alpine` has no vector
    extension, and a few hundred dot products over 768 floats is under a millisecond. Its own
    background loop, not a pass inside the sync tick, so `SYNC_ENABLED=false` does not turn the
    search index off.
  - New: `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`) and
    `SEARCH_INDEX_INTERVAL_SECONDS`. With `OLLAMA_URL` unset there is no index and no
    predicate, exactly as before.

- **`has:` covers everything Hearth stores**, not eleven hand-picked things. Forty-odd
  options — `has:middle`, `has:phonetic`, `has:city`, `has:skill`, `has:custom`,
  `has:relationship`, `has:event`, `has:gift` — derived from the same tables the field names
  come from, so a field you can search for is always a field you can ask about. That is the
  mirror of the bug where `gender` and `birthdayText` were stored and synced while being
  invisible everywhere else.
  - `has:address -has:postcode` is the hygiene question before a Google push, in one query.
  - Empty string counts as absent, not present. The form normalises a cleared field to null
    but an import writes whatever the other system sent, and `{ not: null }` alone would call
    an empty organisation an organisation.
  - The options are ordered most-asked first, because the box shows eight at a time. Left in
    table order, typing `has:` offered eight kinds of phonetic name and never `email` — which
    §27.4 caught, having been rewritten to assert the head of the list rather than mere
    membership.
  - Each option now says what it means in the suggestion list. Forty bare names would not be
    navigable.
- **`has:unthanked` — the people you owe a thank-you.** They gave a present and nobody who can
  speak for the recipient has written yet.
  - Scoped to the cards you may WRITE FOR, not the ones you may read, and that is the whole
    difference between a to-do list and a list of things nobody can ever do: a contact who is
    not a user of the install has nobody to write for them, so a gift to them is not a note
    waiting to happen.
  - `thankableCardsWhere` is now the single definition of that rule, used both by the id list
    the actions check against and by this clause. It is also slightly narrower than before: a
    card in the trash is not thankable, since a trashed contact is invisible everywhere else.
  - **Needs a thank-you** is in the Filter menu too, along with No phone, Has an address, Has
    a picture and Has a birthday. The chips and the query language now share one definition,
    where they used to be two implementations of the same idea.
- **A gift is only visible through a recipient you can see**, asked from the giver's side as
  well. §29.12 proves it in both directions — the viewer who cannot see the recipient is not
  told the gift exists, and the viewer who can is, so the check cannot pass on an empty clause.
- §29, thirty-two checks, and §27.9 upgraded to walk **every** value the box offers through
  the compiler rather than the first of each — with forty `has:` options, "the first one
  compiles" is not evidence about the other thirty-nine.

### Changed

- The query language is handed a **viewer** rather than a user id: who is asking, whether they
  are head of the household, and the three access clauses that decide what they may see. A
  predicate can no longer build its own idea of what is readable, and `peopleWhere`'s callers
  are forced by the compiler to supply the same one the page used — which matters most for
  "select all matching", where a disagreement would select a different set than was shown.
- `people-filter.ts` no longer imports the access module at all. A client component imports it
  for its links and labels, and that import put `auth.ts` — and through it googleapis — one
  tree-shake away from the browser bundle.

### Fixed

- **`-has:name` found nobody, while the contacts it should have found sat in the list reading
  "Unnamed contact".** `displayName` is denormalised: it falls back through nickname, then
  organisation, then the literal `"Unnamed contact"`, so the column is *never* empty and "is it
  filled in" always answered yes. `has:name` now asks the four columns `computeDisplayName`
  consults, which makes it true exactly when the list does not read "Unnamed contact" —
  asserted over every contact in §29.21 rather than over a fixture, so a new rung in the
  fallback chain fails the suite without anybody having to think of it.
  - The general lesson, recorded in CLAUDE.md: for a column the *application* computes, "is it
    set" is not a question about that column. Deriving presence from a column list is right for
    every field a person types into and wrong for every one the app fills in.
  - The parts are listed as a `Record<keyof PersonNameParts, true>`, so adding a name part
    breaks the presence definition rather than quietly leaving it behind — `satisfies keyof`
    checks only the direction that does not matter.
  - An organisation still counts: it is something to go by and it is what the list shows. A
    middle name alone does not, because it is not in the fallback chain either.
- `has:name` failed with a Prisma error inside the search box. `displayName` is the one
  contact column the schema declares NOT NULL, and asking whether it is null is not a
  comparison Postgres will make. It compiled perfectly: the column name is a computed key, so
  TypeScript checks nothing about it. Found by §29.2, which runs all hundred and one options —
  aliases included — against the database rather than inspecting them.

- **Ask for what you want in words.** With `OLLAMA_URL` pointing at a model on your own
  network, the search box grows an **ask** button: *family in sun prairie with no email*
  becomes `label:Family city:"Sun Prairie" -has:email`.
  - It writes the query **into the box** rather than searching. That is the whole design: a
    misunderstanding produces a visibly wrong query you can edit, not a quietly wrong list you
    then bulk-delete from. The box also says which sentence it read.
  - Every answer goes back through the same parser as anything typed by hand, so prose, a
    fenced code block or an invented field is refused — with the parser's own reason — and the
    box is left alone. A model is not trusted to have produced a query just because it was
    asked for one.
  - The prompt carries the field list and your label names from the same vocabulary the
    autocomplete uses, so the three cannot drift apart. Only the sentence, the field names and
    the label names are sent, and only to the host you named.
  - `type="button"` with a manual dispatch, not `formAction`: the button sits inside the
    page's GET search form, and a submit button would navigate instead of calling the action.
    Enter therefore still means *search*.
  - Unset `OLLAMA_URL` and there is no button at all — a control that can never work is worse
    than none. Set but unreachable, the ordinary search carries on and the box says so.
  - Ollama stays its own container by design: the weights are gigabytes, on Unraid they would
    land inside `docker.img`, and updating Hearth would re-download a model that has not
    changed. §28 drives all of this against a fake Ollama on a loopback port, so the checks
    need no model and no network.

## [1.1.0] — 2026-08-27

### Added

- **The search box completes what you are typing.** `ci` offers `city:` and `created:`;
  `label:` offers your actual label names; `has:` and `google:` offer exactly the values the
  compiler accepts. Arrow keys to move, Enter or Tab to accept, Escape to dismiss — and
  Escape then Enter always searches for precisely what you typed.
  - A **"What can I search for?"** panel under the box lists the keys with an example each,
    because autocomplete only helps somebody who already suspects there is something to
    complete. It is a native `<details>`, so it needs no JavaScript and costs nothing closed.
  - The suggestions come from the same tables the compiler reads, and §27.9 walks every field
    the box offers through the compiler to prove it accepts them. A box that teaches a
    language the compiler refuses would be worse than no box.
  - Quoted values are one token, so `label:"Bills Bas` completes to
    `label:"Bills Basement"` — and a value with a space comes back quoted, or it would parse
    as two terms.

- **The search box is a query language.** Everything that had no filter now has one:

  ```
  label:Family city:"Sun Prairie" -has:email
  org:TheStreet or dept:Technology
  howWeMet:"at work"            your own custom fields, by their own key
  updated:>30d  created:2026-08  is:private  google:error
  ```

  Bare words still mean what they meant, so every bookmarked search keeps working — and the
  filter chips are unchanged and still narrow alongside it.
  - Fields come from the registry, so a custom field is queryable the moment you create it,
    with no second place to edit.
  - Parentheses, `or`, `and`, and a leading `-` to negate. `label:Work-Friends` is not a
    negation and `well-known` is one word.
  - An **unknown** field name is searched for as text, because `10:30` and `re:union` predate
    this language — with a warning, since a mistyped `labl:Family` would otherwise silently
    match nobody. A **known** field with an impossible value is refused: `google:banana` is a
    mistake worth stopping for.
  - A query that cannot be read narrows to nothing and says why, rather than widening to
    everything and looking like a filter that matched no one.
  - **Values match anywhere in a field**, so `city:Sun` finds Sun Prairie *and* Sun Gorge.
    There is no wildcard syntax because there is nothing for it to enable — and
    `city:="Sun Prairie"` asks for the whole value when that is what you meant.
  - `>` and `<` only work on a date. On a text field they are refused rather than quietly
    ignored, which is what they were before.
  - The export and "select all matching this filter" resolve the same query the page did,
    using the same registry — a disagreement there would be worst in front of a bulk delete.

### Added

- **Bulk sharing from the people list.** Tick a selection, open **Sharing**, choose who and
  whether they can edit, and press Share — or **Stop sharing** to withdraw the lot.
  - **Owner-only, per contact.** An edit grant is permission to help maintain a record, not
    to pass it on, so anything in the selection that somebody shared with *you* is left alone
    and the message says how many. Sharing your whole address book is a different thing and
    still lives in Settings, because it covers records added later.
  - Sharing the same contacts again **changes the permission** rather than duplicating the
    grant, exactly as the per-contact control does.
  - Withdrawing removes the contacts from that person's Google, since Hearth has stopped
    managing their copy and a copy nothing will ever update again is worse than none.
  - **If a blanket "share everything" grant still gives them access, the message says so.**
    Per-contact withdrawal cannot undo a standing grant, and reporting "stopped sharing"
    without that caveat would be untrue in the one case where it matters.

### Fixed

- **Editing a contact flattened its address, even when you never touched the address.** A
  three-line address came back as `784 Broadway DrSun Prairie, WI 53590USA` after a rename.
  An address value is the formatted block Google returns, newlines and all, and it was being
  edited in a single-line `<input>` — which strips CR and LF from its value. So every save of
  anything on a contact rewrote its address a little flatter. Addresses are edited in a
  textarea now.
  - And then they gained **carriage returns** instead: the HTML form spec normalises a
    textarea's value to CRLF on submission, so the newlines came back as `\r\n` — still a
    change nobody asked for, and one that would report the whole field as modified on the
    next push to Google. Contact point values are normalised to `\n` on the way in.
  - Notes had the same problem for the same reason, so `LONGTEXT` fields are normalised too.
  - §24 drives all of this through the browser rather than the action, because the bug was in
    the form: calling `updatePerson` directly would have passed while the page kept mangling
    addresses.

- **Saving a field mapping showed "Not synced" while storing the value you chose.** Pick a
  Google destination for a custom field, press Save mappings, and the dropdown snapped back —
  yet the database held the choice and a refresh displayed it, which is what made it confusing
  rather than obviously broken. React resets a form once its action settles, and that reset
  lands *after* the re-render the revalidation causes, so a controlled select was left showing
  the reset value with no further render to correct it. The select is uncontrolled now and the
  row is remounted per submission, so whichever order those happen in they land on the same
  value: the one the server just stored.
  - The select carries a `data-saved` attribute with the stored value, so a stale DOM and a
    stale prop can be told apart. They look identical from outside and need opposite fixes;
    measuring showed `data-saved="userDefined"` on a select whose own value was `none`.
  - §23 checks it without reloading, including saving twice with nothing changed — keying the
    remount only on a *changed* value would have missed that case.

- **Every page scrolled sideways on a phone.** At a 390px viewport the app measured 529px
  wide, which is the most visible way to look unfinished. The cause was one flex row: the
  header's theme toggle, avatar, name and Sign out could always be squeezed a little
  narrower, so they never wrapped and instead pushed the page out. Below `sm` that cluster
  now takes a row of its own. The pages themselves were already fine — their columns
  collapse — which is why nothing on them had to change.
- **A hover tooltip was the second cause.** The `?` hint is a 16rem box centred on its
  button, so any hint near the right edge hung 14px past the screen and made the page
  scrollable again. On a phone it is no longer anchored to its button at all, which cannot
  overflow by construction; on a real screen it is unchanged.
- **§22 measures this rather than trusting a screenshot**, because a page that scrolls
  sideways still screenshots perfectly. Four pages, the bulk bar open, a contact page and
  every control in the header are checked against the viewport width, and a failure names
  the narrowest element responsible rather than reporting a number nobody can act on.

## [1.0.0] — 2026-08-22

### Changed

- **Hearth has a mark of its own instead of a house emoji, and the browser tab finally has an
  icon at all.** A drawn fireplace with a fire in it, in the nav and on the sign-in page,
  taking whatever accent colour you chose — which an emoji cannot do. The tab icon is the same
  drawing as a file, so it stays sharp at any size, and it carries its own light/dark switch
  so it reads against both a white and a near-black tab strip.
  - Squarer opening rather than a semicircular arch: an arch reads as a headstone at 16px.
  - The flame's curl is on one side only. A symmetrical teardrop reads as water; the asymmetry
    is what makes it fire, and the silhouette carries it once the inner lobe closes up.

### Fixed

- **`update-hearth.sh` now says it is out of disk before spending three minutes proving
  it.** Docker on Unraid lives in a fixed-size `docker.img`, and building a Node app fills
  it with BuildKit cache — every `npm ci` layer from every build ever run. Running out
  surfaced as an `ENOSPC` buried in a page of BuildKit output, on a server with a hundred
  spare gigabytes on the array. The script checks free space first and stops with the
  commands that reclaim it, having changed nothing.
- **`--prune` was only clearing half of what fills up.** It pruned dangling images and left
  the BuildKit cache, which is the larger of the two after a few rebuilds. It now clears
  both and reports what is free afterwards.

## [0.6.0] — 2026-08-21

### Fixed

- **Re-importing a contact you had deleted left it stranded: "Not in Google", and the sync
  reporting nothing to do.** Reported from a real install after importing three contacts,
  deleting them, and importing the same three again. Two faults, one symptom.
  - A queued deletion was matched by Google resource id alone, so it settled onto whatever
    contact held that id when it finally ran — which after a re-import is the *new* contact.
    It was disabled (which renders as "Not in Google" and is excluded from the push queue)
    and its Google copy deleted. A deletion now records which contact it was queued for and
    can only ever settle that one.
  - And the deleted original still claimed the resource name, which only one contact per
    account may hold, so re-importing before a sync had run failed on a database constraint
    with no explanation. Re-importing a contact now takes it back: any deletion still waiting
    is dropped, and the old link released. Re-importing something is not an ambiguous
    statement about whether you want it.

  If you hit this, the imported contacts are fine to delete and import once more. Check
  Google for the three contacts themselves — the stray deletion may have removed them, and
  the trash keeps whatever Hearth had.

- **A contact linked to a Google profile gained a duplicate on every sync.** Google returns a
  linked person's own account data alongside the contact's — the same email once as `CONTACT`
  and once as `ACCOUNT`. That second copy is read-only: Hearth imported it, pushed it back as
  the contact's own, and Google added it beside the copy it had kept. Two became three, and
  would have become four on the next sync, and so on. Only values Google marks as the
  contact's own are imported now; a contact whose *only* name comes from its profile still
  keeps that name, since the alternative is a blank row. Found by pushing all 330 contacts of
  a real address book and counting — no fixture could have shown it, because a hand-written
  payload carries no source metadata at all.

- **A birthday with no year lost its shape on the way back to Google.** Google returns a
  `text` beside every structured birthday, and on a real 327-contact account every one was a
  machine echo of the date — `1977-06-13` beside `{1977,6,13}`, `--08-08` beside `{8,8}`.
  Hearth stored those echoes, which gave a contact a birthday *and* a redundant
  "birthday, no year" line saying the same thing; worse, an echo like `--08-08` could not be
  parsed on the way out, so the push replaced Google's structured date with that string and
  the birthday stopped being a date at all. Echoes are now discarded, a yearless date is kept
  in Google's own `--MM-DD` notation and read back as a date, and a text that says something
  a date cannot — "the day Elvis died" — is still kept.

- **A huge address book was truncated in silence.** Reading contacts stops after 20 pages of
  200. Beyond 4,000 contacts the rest were simply absent, which reads as "that is all of
  them" — and this list is both what the import offers and what sync reconciles against, so
  the missing ones would have been quietly unfindable. It now says so in the log.

- **A contact with no name would have been christened with its own email address.** Hearth
  shows the address as the name of a contact that has none, which a list has to do — and the
  push wrote that straight into Google's given-name field, so importing a bare
  `numbersix@six.com` would have given the contact a *name* reading numbersix@six.com. It
  now sends no name at all in that case. An "Unnamed contact" literal that could have been
  written into somebody's address book went with it.

- **An import no longer says nothing about overwriting another install's Hearth id.** A
  contact already carrying a `hearth_id` this install has no row for — another install, or a
  restore that lost the link — is still imported, because a contact nothing here points at
  is a contact nothing here can update. But the plan now says the id will be replaced
  instead of letting that be discovered afterwards.

- **A birthday with no year came back from Google as a date and went back as prose.** Google
  holds "12 October, year unknown" as a structured date without a year; a `@db.Date` column
  cannot express that, so the import keeps it as text — and the push then wrote it into
  Google's free-text birthday field, where it stops being a birthday: no reminder, no
  sorting, just a note. The exact shape the import writes is now read back into a dateless
  date, so the round trip is lossless, while a birthday nobody could parse ("the week after
  Easter") is still kept as written. Found by running a real Google contact through the new
  import probe — the automated fixtures had only ever carried birthdays with years.

- **The setup instructions were wrong about how long a Google grant lasts.** They said an
  app in "Testing" keeps its refresh tokens indefinitely for test users. Google expires
  them after **seven days**, which means a self-hosted install stops syncing about weekly
  and asks to reconnect however many times you oblige. The README now says to move the
  OAuth app to "In production" before relying on it, and explains that verification is a
  separate concern. Found by two throwaway test tokens dying exactly eight days after they
  were minted.

- **"Reconnect Google" did nothing at all.** Auth.js's Prisma adapter writes an `Account`
  row when an account is first linked and has no way to update it afterwards, so
  re-consenting changed what Google would allow while Hearth went on reading the scope
  list it had stored at sign-up. Every permission check reads that column, so the banner
  could never clear however many times it was pressed — and the thank-you button stayed
  blocked with an explanation that was true but unactionable. The stored grant is now
  refreshed on every sign-in.
  - A response with no `refresh_token` leaves the stored one alone. Google returns one
    only when consent is genuinely re-prompted, and writing the absence through would
    trade a stale scope for a broken background sync.

- **Hearth was deleting parts of every contact it synced.** `names` and `organizations`
  are both groups Hearth manages, and Google replaces a managed group wholesale on each
  push — but the serialiser only ever sent a first name, a last name, and
  `{name, title}`. So a middle name, a title like Dr or Ms, a phonetic reading, a
  department: present in Google, unknown to Hearth, and gone on the next sync.
  - There are real columns for all of them now — six for the rest of a Google name,
    seven for the rest of the organisation — and the serialiser sends them, which is the
    half that actually stops the loss. They appear in the contact form, the list-view
    columns and the Google field-mapping table automatically, because core fields and
    user-defined ones are merged into one registry.
  - The Google import stores them as themselves rather than rescuing them into custom
    fields, so a middle name returns to Google as a middle name instead of reappearing as
    `Middle name: Augusta` among the custom fields.
  - **Addresses keep their parts too.** Street, extra line, city, region, postcode,
    country, country code and PO box are stored and sent, alongside the one line Hearth
    shows and searches — Google keeps both, and building formattedValue from the parts is
    what it does when the line is absent. An email keeps Google's display name for the
    same reason.
  - The address parts are editable on the contact form, behind a disclosure on the address
    row. They had to be: a save rewrites every contact point from the form, so parts the
    form did not carry would have been erased by an edit to something else entirely — and
    then flattened in Google on the next sync.
  - **And everything else Google keeps**: gender, chat handles with their network, SIP
    addresses, calendar URLs, external ids, keywords, interests, skills, occupations,
    locations with their floor and desk, second and third nicknames, anniversaries, and
    Google's own free-text relations. A birthday Google holds without a year — which a
    date column cannot express — is kept as written instead of being reported unstorable
    and dropped.
  - Google's relations are **not** Hearth's relationships. Hearth's link two contacts
    that both exist and read correctly from either end; Google's are a name typed as
    text, whether or not that person is in the address book. They are stored separately
    so neither has to pretend to be the other.
  - CSV export and import carry all the new columns, **including a column per address
    part**: `Address 1 street`, `Address 2 postcode` and so on, in numbered blocks. Plain
    columns a spreadsheet can edit, rather than a format nested inside one cell — and an
    export is as wide as its widest contact needs, so a file for people with no addresses
    carries no address columns at all. The readable `Addresses` column stays, and is still
    read, for older files and hand-written ones.
  - Everything new shows on the contact page: the name and organisation detail, gender,
    the parts of an address beneath the address, which network a chat handle is on, and
    where a location is. Anniversaries get a **Dates** card — a missing year is shown as
    missing rather than filled in with this one — and Google's relations get their own,
    captioned to say they are names rather than links to contacts.
  - One contact still keeps one organisation. Hearth has only ever sent one, so nothing
    regresses, and the import now says so per contact when Google holds more.

### Changed

- **Write the thank-you in Hearth and send it to whoever gave the gift.** Each gift a
  person received carries a **write thank you** link; it opens a box, and the note goes
  from your own address to the giver's. Once it has gone the link becomes a **thanked**
  mark, and hovering it shows what you said.
  - This replaces reminder emails and the tick that went with them. Hearth used to mail
    the *recipient* a list of gifts and giver addresses so they could go and write notes
    somewhere else — a reminder, not a thank-you — and then relied on somebody
    remembering to tick a box afterwards.
  - There is no checkbox now because there is nothing left to guess: Hearth did the
    sending, so it knows. A mark you have to remember to set is a mark that goes stale.
  - **The note is sent exactly as written** — no template, no signature, no footer. A
    thank-you that visibly came out of a contact manager is a worse thank-you. The box
    shows a suggested opening as a *placeholder* rather than prefilled text, since
    anything actually in it can be sent unread.
  - **A gift can be for several people**, because a big present often is — a holiday for
    the children is one gift, not one each. Each recipient owes their own note, though:
    one child thanking does not discharge the other's, which is why the thanks are
    recorded against the recipient rather than the gift.
  - **A user can let the head of the household write their thank-yous** (Settings →
    Preferences). Off by default, and given by that user rather than taken by the head —
    a note is signed by whoever sends it, so this is permission to speak for somebody and
    only they can grant it. It exists so a parent can write a small child's notes.
  - Thank-yous are sent by the people using Hearth, for themselves or for a user who has
    asked them to. A recipient who is not a user of the install has nobody to write for
    them, by design.
  - **Only for gifts you received.** The note goes from your address and is signed by
    nobody else, so writing one for a gift somebody else was given would send a stranger
    a thank-you from the wrong person. Being able to edit a contact is not licence to
    speak as them — and since ownership is exactly what does *not* distinguish the two
    (you own the contacts of everyone you have recorded), the test is the household
    contact card. Enforced in the action, not only by hiding the link.
  - A send that fails keeps the note and the box open. React resets an uncontrolled form
    once its action settles — failure included — so this needed doing deliberately;
    otherwise a refusal from Google would have thrown away what you had written.

- **The guest list has no rules between rows while reading.** A line per person on a list
  of one-line rows is more ink than the rows. They return while editing, where each row
  grows a form and needs the separation.

### Added

- **Bulk actions on the people list.** A checkbox on every row, one in the header that ticks
  every row listed, and a bar that appears with what you can do to the selection:
  - **Labels** — add or remove several at once, or type a new one. Labels are matched by
    *name*, which is what makes a mixed selection work: a label belongs to a contact's owner,
    so applying *Family* to a contact your partner shared with you means theirs, not yours.
    They reach Google Contacts as groups, and the bar says so.
  - **Add to Google / Remove from Google** across the selection. Unticking queues the Google
    copies for removal exactly as unticking one does.
  - **Move to trash**, which is owner-only per record — an edit share is permission to help
    maintain a contact, not to destroy it — and reports what it left alone rather than
    silently doing three of four.
  - When the list is truncated, the bar offers **all N matching this filter** rather than only
    the rows on screen. The filter is re-read on the server rather than trusted as a list of
    ids from the browser.
  - **Fields** — set or clear **any** field across the selection, core columns and your own
    custom fields alike. Only a ticked field is written, so an untouched one is never
    blanked; clearing is a separate tick, because an empty box on a ticked field is
    indistinguishable from leaving it be. Values go through the same schemas the
    single-contact form and the CSV import use, and every contact keeps a history entry.
  - Contact points are deliberately absent: an email or an address is a repeatable row
    belonging to one person, and there is no sense in which two hundred contacts share one.
    The parts of a name are offered but labelled as such, since setting a first name across a
    selection is almost never what somebody means.

- **Importing from Google brings the picture, not a link to it.** A contact's photo is
  downloaded and becomes its picture in Hearth. Both places Google keeps one are read: the
  contact's own photo, and — for contacts that arrived through Google's CSV importer — a
  custom field called *Photo* holding a URL. On the address book this was built against, 28
  contacts had the first, 63 had the second, and 41 had **only** the second, so reading
  either alone would have lost pictures.
  - Google's generated grey silhouette is skipped. Importing it would give hundreds of
    contacts the same meaningless avatar in place of the initials Hearth draws.
  - A *Photo* custom field holding a URL is never kept as a text field, whether or not it is
    the picture that wins — a URL sitting in a custom field is the thing being fixed, not the
    goal. The preview says that the URL will leave Google on the next sync, because that is a
    deletion. On the address book this was built against that took the number of values
    rescued as custom fields from 63 to nought.
  - Downloaded at 512px by asking Google to resize, which is what makes this possible with
    no image decoder on the server, and validated exactly like an upload from the form: a
    content type that lies about being an image is refused on the bytes.
  - A picture that will not download is not a reason to lose a contact. The import carries
    on and that contact keeps its initials.
  - Worth knowing: the next sync pushes that picture back, at 512px. For a contact whose
    photo came from Google that replaces the original with a copy no larger than itself, and
    for one that only had a URL in a custom field it gives the contact a real photo for the
    first time. Neither loses the picture, but the first is a re-encode rather than a no-op.

- **A trash can. Deleting a contact or an event now moves it there, and nothing empties it
  by itself.** No retention window, no nightly prune, no thirty days — a record leaves the
  trash only because somebody chose *Delete permanently* on the **Trash** page. The cost of
  keeping a deleted contact is one row; the cost of losing one is a row you cannot get back.
  - **Delete** is now **Move to trash**, and says so on both the contact and event pages.
  - Restoring brings the record back with everything that hung off it — its gifts, its
    guest list, its shares and its history, none of which were ever removed.
  - **A trashed contact still leaves Google Contacts, and a trashed event still leaves
    Google Calendar.** Deleted has to mean deleted on your phone; a contact that vanished
    from Hearth and stayed on a handset would be the worst of both. Restoring cancels the
    removal if it has not gone out yet, and pushes the record back if it has.
  - Invisible everywhere while it is in the trash: the people and events lists, search, the
    CSV export, the attendee picker, gift rows, the sharing page and the sync queue. That is
    one line in each of the clauses in `src/lib/access.ts`, and it is only that cheap because
    every query in Hearth already goes through them — the one query that did not, the event
    push queue, would otherwise have sent a trashed event straight back to your calendar.
  - **Somebody else's trash is not a place you can look**, even for a record they had
    shared with you. Whether it comes back is theirs to decide.
  - Trashing and restoring are recorded in a contact's history, so a deletion is not a gap.
  - A gift outlives the trashing of whoever gave it — trashing somebody does not un-give
    what they gave. The name stays on the gift; only the link to their page goes.
  - The contact card of a Hearth user can be trashed and restored, but not destroyed while
    they are attached to it: their thank-yous and their place in the household hang off that
    row, and none of it comes back. Unlink it in Settings → Household first.
  - **Emptying the trash is one button and one confirmation**, naming what it will destroy —
    thirty deleted contacts should not be thirty decisions. What keeps the page safe is that
    the decision is never made *for* you, not that it is made slowly. Hearth users' own
    cards are left behind, for the same reason they cannot be deleted individually.
  - Events keep no history, by design: an event is a thing that happened on a date and is
    then over, where a contact is meant to persist and to change for years. So a trashed
    event has the trash itself as its record.

- **Contact history.** Every change to a contact is remembered, with who made it and what
  it was: a **History** card on the contact page lists each version newest first, with the
  fields that changed and their old and new values side by side.
  - **Snapshots are stored; the differences are worked out on reading.** A contact spans
    five tables and a JSON bag, so diffing all of it on every write would be fragile
    machinery — and two snapshots are enough to say what changed. That also means
    improving how a change is described improves every entry already recorded, not just
    new ones.
  - **A version is recorded only when something actually changed.** Sync touches a
    contact's timestamp on every push; without that check, a contact synced nightly would
    accumulate hundreds of entries saying nothing happened and bury the few that matter.
  - Recorded after the write rather than from what the caller intended, and outside its
    transaction — a history entry that fails must not undo the edit it was describing.
  - Deleting a contact deletes its history, which is the honest reading of delete for
    personal data. Removing a *user*, though, only removes the attribution: the changes
    they made to other people's contacts stay.
  - Read-only for now. Reverting to an earlier version would have to write back through
    the same validation and sync path as an edit, which is more than a button.

- **Import contacts straight from Google, in place.** Pick a Google label or individual
  contacts and Hearth adopts them: the Google contact is not moved, copied or re-created,
  and everything already on it stays on it. A contact does **not** have to have been made
  by Hearth to be linked to it — which is what removes the export-to-CSV, edit, re-import
  dance.
  - The import writes nothing to Google at all. Recording the existing `resourceName`
    against the new Hearth contact is enough: the ordinary sync sees a link and calls
    `updateContact` rather than `createContact`, so `hearth_id` arrives on the next sync
    through the serialiser that already has tests, rather than through a second path.
  - Google labels become Hearth labels, matched by name, so importing the same label
    twice reuses it instead of making a second one.
  - **The preview is the feature, not a courtesy.** Importing makes Hearth authoritative
    for the field groups it manages, so the first sync afterwards would erase anything
    the import failed to copy. The preview names, per contact, every value it will keep
    as a custom field and every shape that will change — before you commit.
  - Field groups Hearth does *not* manage — relations, custom dates, chat handles,
    external ids, interests, skills — are never written by it and are unaffected.

- **Gift tracking, and a thank-you list you can email.** Mark an event as one where
  presents change hands, say who they are for — more than one, since Christmas is not a
  birthday — and record what each person was given, by whom, with a note. A button then
  emails a recipient the whole list *with each giver's contact details beside their
  gift*, so thank-yous can be written away from Hearth without cross-referencing two
  lists on a phone.
  - **One table, both directions.** `giverId` and `recipientId` both point at a contact,
    so "what did Mary give us?" and "what have we given Mary?" are the same rows read
    from different ends — no direction column, and a contact page needs one query rather
    than two. It is the same trick the relationship table uses.
  - Gifts need no event: a one-off recorded on a contact page is the identical row
    without one, and carries a date of its own instead of borrowing the event's.
  - **Who may see a gift is decided by its recipient**, not by whoever recorded it and
    not by the giver. That reuses the existing access boundary rather than giving gifts
    a sharing dimension of their own, so a gift for a contact your partner shared with
    you simply appears — and being able to see Mary does not entitle you to the list of
    what she gave a household you have no access to.
  - Recipients are **not** the guest list. A toddler receiving half the presents need
    not be on the invitation, and most attendees receive nothing.
  - Gifts are Hearth records and are never sent to Google, which keeps them clear of the
    sync machinery entirely.
  - Hearth had never sent an email before this — calendar invitations are sent by
    *Google*, not by us — so this adds a small mail path using the `gmail.send` scope,
    which can send and cannot read a mailbox. Existing installs will show "Reconnect
    needed" until the new permission is granted.

- **Light, dark, or follow the device — and an accent colour of your choosing.** In the
  header there is a toggle that cycles the three; Settings → Appearance spells them out
  and offers seven accent schemes plus one you mix yourself. Every choice is per user, so
  a household sharing an install does not share a colour scheme.
  - Light/dark is three-valued rather than a boolean, because "follow my machine" is a
    real preference that has to be distinguishable from "I chose light" — otherwise
    someone who picks light on a dark-set laptop is overridden by their OS every
    morning. Tailwind's stock `dark:` variant cannot express that, so Hearth defines its
    own: it fires on an explicit `data-theme="dark"`, *or* on the system preference when
    the user has not explicitly chosen light.
  - **A colour scheme is one number.** All eleven accent shades are derived from a single
    hue in oklch, which keeps them looking evenly spaced at any hue — something a
    hand-picked ramp per scheme would not. That is what makes "invent your own" cost an
    integer rather than a palette table, and it is why the named schemes live in
    `src/lib/theme.ts` and not in the stylesheet: the CSS only knows how to build a ramp
    from whatever hue it is handed.
  - **A separate accent for light and for dark**, because a hue that carries on a white
    page is often muddy on a near-black one. The control starts as a single picker —
    most people want one colour — and a *Same in light and dark* tick splits it in two.
    Whether they are linked is inferred from the two values rather than stored, since a
    column recording "these should match" is a column that can disagree with them.
  - Which of the two applies is decided **in CSS, not on the server**: under "System" the
    mode belongs to the browser, so `<html>` carries both hues and a rule assigns
    `--accent-hue` from one of them. When the accents are unlinked, Settings marks which
    one you are currently reading, and follows a machine that flips at sunset.
  - The choice is applied server-side on `<html>`, so the first paint is already correct.
    There is no flash of the wrong theme and no blocking script to cause one.
  - Appearance has no Save button. The page you are looking at *is* the preview, so the
    control writes in the background and says so only if the write fails.

- **Contact photos.** A picture per contact, shown on the contact page and beside every
  row in the list, with initials as the fallback — in a list of two hundred, a repeated
  silhouette is noise, while initials still tell rows apart.
  - **The owner's photo is the default and reaches everyone the contact is shared with,
    but a recipient may set their own instead.** This is the one deliberate exception to
    "one record reads the same to everyone": a photo answers *is this the person I
    mean?*, and the picture that does that job is legitimately personal, where a job
    title is not. Labels and custom fields still follow the owner precisely because
    they describe the record rather than serve the viewer.
  - Hence `PersonPhoto` keyed on (contact, user) rather than a column on `Person`. Each
    Google account receives *its* effective photo, so one Hearth contact can wear a
    different face in two address books on purpose.
  - Anyone who can **read** a contact may set their own photo, not only someone who can
    edit it. Their upload is their own row and changes nothing for anybody else.
  - Bytes live in Postgres, so the verified `pg_dump` that `update-hearth.sh` already
    takes before every update carries them. A separate upload directory would need its
    own backup story, and the forgotten backup is the one that matters.
  - Resizing happens in the **browser**, which keeps a native image library out of the
    Docker image, bounds the upload on a slow connection, and strips EXIF — including
    where the photo was taken — as a side effect of re-encoding. The server still
    validates independently: it sniffs the magic bytes and reads the dimensions out of
    the JPEG or PNG header rather than trusting anything the client declared.
  - Photos push to Google through `people.updateContactPhoto`, a separate endpoint from
    the field write because `photos` is read-only on a person. Compared against a
    per-account record of what was last sent, so an unchanged photo costs nothing.
  - Verified against two real Google accounts: the owner's photo reaches a recipient's
    address book, a recipient's own picture replaces it in theirs alone while the
    owner's stays put, an unchanged photo is not re-uploaded, clearing an override falls
    back to the owner's, and removing the last photo removes it from Google while
    keeping the contact.

- **A contact card for every Hearth user, owned by the head of household.** Signing in
  now creates a contact for you, so the people using Hearth appear in it on the same
  footing as everyone else — they can be given relationships, put on events, and
  labelled.
  - One user is the **head of household** and owns those cards; Settings names them and
    can hand the role over, which moves every card with it. Ownership had to sit
    *somewhere* real: a record owned by nobody would need rules of its own in the single
    file that decides who may read, write and share anything, and a second set of rules
    there is the last thing that file should grow.
  - Each card is shared with every other user **and with the person it describes**, which
    is the point rather than a curiosity: your own card is a contact your phone can pass
    on through its ordinary "share contact" function.
  - Existing installs get cards for their existing users, with the earliest-created
    elected head, and the email each signed in with seeded on their card.

- **Relationships can be edited after they are created**, not only added and deleted.
  Type, direction, dates and notes are all changeable; the other person is not, because
  that is a different relationship rather than an edit to this one.
  - Type and direction submit as a single field, so the two cannot arrive contradicting
    each other. For an asymmetric type the form offers both readings — "parent of" and
    "child of" — and you pick the sentence that is true.

- **Relationship end dates are now shown.** With both dates a relationship reads
  "2019 to 2024", with only a start "since 2019", and with only an end "until 2024". The
  end date has been storable for some time and was invisible everywhere.

- **Relationship types for households that are not a couple with children.** The seed
  adds metamour, co-parent, nesting partner and comparable shapes alongside the
  traditional set, and no type is implicitly one-of-two. A relationship manager that
  cannot describe its user's actual household is not managing their relationships.

- **Labels can be created from a contact page.** Settings remains where they are renamed,
  recoloured and deleted, which is management; having to leave the contact you were
  looking at in order to invent the label you wanted on it was not.

- **The signed-in user's own picture in the header.** Google has supplied it since the
  first sign-in; it was simply never displayed.

- **Transferring a contact to another user.** Ownership decides which field definitions
  read a record, whose labels may be applied, and who can delete or share it — so the
  transfer moves or drops each of those, and the confirmation names what it will drop
  before you commit.
  - You choose what you keep: nothing, view, or view and edit. Choosing nothing is what
    takes the contact out of your Google Contacts; keeping access necessarily keeps it
    there, since you can still read it.
  - Shares the previous owner granted **move with the record**, so nobody it was already
    shared with silently loses access.
  - Labels are dropped, because a label is the previous owner's own filing system and
    inventing entries in someone else's is not Hearth's to do. Custom values are kept in
    place but stop showing unless the new owner has a field of the same name — so
    transferring back restores them.
  - Only an owner may transfer. An edit share is permission to help maintain a contact,
    not to decide who it belongs to.

- **A share can be taken back.** Each person a contact or event is shared with now has a
  **Remove** beside them. Granting access was always reversible in principle — there was
  simply no control for it — and a sharing feature you cannot undo is one people are
  right to be wary of using.

### Changed

- **Setting an event's start now carries the end along with it**, the way Google Calendar
  does. A new event gets an hour; an event somebody has already made three hours long
  stays three hours long when its day moves, rather than having a deliberate choice
  silently reset.

- **The guest list hides its per-person controls behind a toggle too.** Every row carried
  a role dropdown, an RSVP dropdown, an invite checkbox and an Update button,
  permanently — four controls per person on a list whose usual job is to be read.

- **Any event can hold gifts**, with nothing to switch on first. The flag that decided
  whether the gift controls appeared only ever recorded a preference about the page, not
  a fact about the occasion, so it is gone and the column with it. Gifts themselves
  reference their event directly and are unaffected.

- **Gifts and Sharing are collapsible on the event page**, and Sharing moved above
  Google — "who else can see this" is asked more often than "how is this syncing", and
  it is the one of the two with a control in it rather than status. The gift section
  opens by itself once something is recorded.

- **The contact page's gift list is collapsible too**, and its rows line up under their
  heading whether or not they belong to an event. An event's date now follows its name on
  one line in the Events card, and the Google contact row in Record starts at the left
  edge like every other row on that card — it was the only one rendered by a component
  rather than inline, and the only one that had not been told to use the compact layout.

- **A guest's email sits on the same line as their name.** Two lines per person was half
  the height of the list, for a value most rows repeat the shape of.

- **The gift list on a contact page hides its editing controls behind a toggle.** Per-row
  Edit and Remove on every line is clutter you learn to look past rather than use, so the
  card reads as a list until you ask to change it. Received and given are separated, and
  each event's presents collapse under the occasion — named, dated, and linked — so
  fifteen things from one Christmas cannot bury everything else.

- **Adding a relationship is behind a disclosure**, for the same reason: the form is
  occasional and the list is what you came to read.

- **A lone gift recipient is preselected.** At an event with one person receiving, being
  asked to choose them for every present is a click whose answer never varies.

- **The share picker no longer offers people who already have access.** Their name
  appearing in the list of candidates implied there was something left to grant, and
  re-granting was a no-op that looked like a change.

- **Pages use the width they are given.** The content column went from `max-w-5xl` to
  `max-w-7xl` — on a wide screen the old bound left roughly half the display as margin,
  and these pages are two columns of cards whose reading width is set by the grid rather
  than by the page. The air between the nav and the first row came down with it, so the
  first card reads as attached to the page instead of floating below it.

- **Explanations moved to hover, rather than standing permanently on screen.** A
  paragraph that tells you how a control works is read once and then occupies space
  forever. The ones that were pure instruction — the photo uploader's, chiefly — are now
  a `?` marker that opens on hover *and* on keyboard focus, and is exposed to assistive
  technology. Text that states a *consequence* rather than an instruction stayed put.

- **The Record card no longer overflows its border.** Its label column was the 11rem one
  meant for a full-width card; in a 22rem sidebar that left so little room for a value
  that timestamps wrapped onto three lines and pushed past the edge. Detail rows now have
  a compact mode, and long unbroken values (a Google resource id, say) wrap instead of
  widening the grid.

- **The relationship section is no longer mostly padding.** Each row was carrying more
  vertical space than the single line of text inside it, so a household of six read as a
  scroll. Rows are now `py-1.5` and each relationship — type, person, dates and note —
  fits on one line.

- **The contact filters are now a menu and a row of chips**, rather than three rows of
  pills above the list. Selected filters appear inside the search box and each carries
  an × that removes just itself; the **Filter** button shows how many are active.
  - Still links carrying the whole filter state, so filters compose, a filtered list is
    a URL worth keeping, and Back undoes one at a time.
  - The menu is a native `<details>` rather than React state, so it opens on the first
    click instead of only after hydration. Every filter click is a navigation, so a
    menu needing hydration would ignore exactly the clicks people make most.

## [0.5.0] — 2026-08-12

### Added

- **Labels for contacts (milestone 5).** Group contacts however you like, then
  filter by them.
  - Labels belong to a user rather than the install, because two people's "Family"
    mean different things. A shared contact carries its **owner's** labels, matching
    how the owner's field definitions and Google mappings already render it — one
    record reads the same for everyone who can see it, and an EDIT recipient picks
    from the owner's list.
  - Names are unique per owner, case-insensitively: "family" typed after "Family"
    means the one you already have, and a second Google group of the same name would
    look like a duplicate on your phone.
  - Deleting a label in use is allowed. Refusing until it is cleared off every
    contact would make a 200-contact label undeletable in practice; the contacts
    themselves are untouched.

- **Labels become labels in Google Contacts.** Google contact groups are
  per-account resources, so one Hearth label becomes one group in *each* Google
  account the contact reaches — the same fan-out `PersonSync` does for the contacts
  themselves, which is why `LabelGroup` is keyed on (label, account).
  - Membership is changed through `contactGroups.members.modify`, not by writing
    `memberships` on the contact. A person update replaces the membership list
    wholesale, which would drop the contact out of My Contacts and out of any group
    made by hand in Google. Hearth only ever touches groups it created.
  - Reconciled once per sync run, batched to one call per group rather than per
    contact, and after the contacts — a contact has to exist before it can join a
    group. A group failure is reported but never fails the contact push that already
    succeeded.
  - An existing Google label of the same name is **adopted** rather than duplicated,
    which is also what makes this safe to re-run after a database restore.
  - Deleting a Hearth label deletes its Google groups, through a tombstone recorded
    before the rows cascade away. Without it the label survived on every phone it
    had reached, with no handle left to remove it by.

- **Contact filtering.** Beyond search: by label (any or all), by who can see it
  (mine, private, shared by me, shared with me), by Google state, and by whether
  there is an email or phone.
  - Every control is a link carrying the whole filter state, so filters compose
    without client-side coordination, Back undoes one at a time, and a filtered list
    is a URL worth keeping. A label chip anywhere in the app links straight to its
    members.
  - "Shared by me" has to consider blanket grants as well as per-record shares,
    since a blanket grant is deliberately not recorded per record.
  - Every clause is ANDed with the access filter: filters narrow, access decides.

- **CSV export of contacts**, including labels, per-record shares, blanket-share
  recipients, contact details and your own custom fields. Follows the current
  filters, so exporting one label needs no separate selection UI — filter the list,
  then export what you are looking at.

- **CSV import of contacts**, with a preview before anything is written.
  - Preview and apply call the **same planner**; the apply step only executes what
    it produced. A separate "what would happen" implementation drifts from the real
    one, and the screen that says "3 updates" is exactly where that must not happen.
    Applying re-plans rather than trusting the browser's copy, which also re-checks
    access — the gap between preview and confirmation is long enough for a share to
    be revoked.
  - Rows match on `Hearth ID` first, then on the first email **among your own
    contacts only**. An id is an explicit instruction; an email is a guess, and a
    guess should not reach into someone else's record even where sharing would
    permit the write.
  - **Sharing grants only.** A recipient the file omits never loses access, matching
    the user picker — a spreadsheet round-trip that silently revoked your wife's
    access is exactly the destructive slip that decision guarded against.
  - A column the file omits is left alone, so a narrow CSV cannot blank out fields
    it never mentions. Two rows pointing at one contact: the second is skipped rather
    than silently overwriting the first.
  - Labels and custom fields are refused on a contact shared with you, since both
    are keyed by the owner's definitions.
  - Values validate through the **same schemas as the edit form**, so a file cannot
    store what the UI would reject. Ambiguous dates like `03/04/1990` are reported
    rather than guessed at — a wrong guess silently misdates a birthday.
  - Rows apply one at a time rather than in one transaction: a failure on row 2,999
    must not discard 2,998 good ones, and the report says what landed.

- **An end-to-end test suite** (`npm run e2e`): 140 checks against a real Postgres 16
  matching production, the real built app, and a real browser driving it. Sign-in is bypassed
  by inserting a session row and its cookie, which is what a real Google sign-in
  would have produced — everything the suite tests sits downstream of authentication,
  and driving Google's consent screen would mean holding someone's password. Covers
  §1, §2, §4–§8 and the non-Google half of §9 of `docs/verify-0.5.0.md`, leaving 28
  rows that genuinely need a live install or a Google account.

- **A second suite for the Google half** (`npm run e2e:google`): 43 checks against two
  throwaway Google accounts, driving the real sync engine and then asking Google what
  happened. Covers §3 in full plus 6.5, 7.20, 9.3, 9.4 and 9.7, leaving 8 rows that
  need the user's own install, a mailbox, a container or an hour.
  - Destructive by design — it empties both accounts so each run starts from a known
    state — so it refuses outright against an account holding enough contacts or labels
    to look like a real address book. The cost of getting that wrong is somebody's
    contacts.
  - It also refuses if both tokens resolve to the same account. Every §3 assertion is
    of the form "A has X and B separately has its own X", so one account twice would
    pass while proving nothing.
  - Confirms the contact-group design against the real API: a labelled contact stays in
    My Contacts, a group created by hand in Google survives a sync, and deleting a
    Hearth label removes the group while keeping its contacts. Those three were the
    stop conditions, and they were assumptions until now.

  The suites have their own `tsconfig.json` rather than joining the app's: pulling
  playwright-core and the Postgres driver into the Next build's TS program exhausted
  the build worker's heap. `npm run typecheck` runs both.

### Fixed

- **Re-importing an export duplicated every contact shared with you.** A row carrying
  a `Hearth ID` is a request to update *that* record, but when the record existed and
  the importer had no write access the planner fell through to creating a new
  contact — so exporting everything and importing it back produced a second copy of
  each shared contact. Such rows are now **skipped** with a plain reason. An id
  Hearth has never seen still creates, which keeps a stale-id restore working; the
  two cases are told apart by asking whether the record exists at all, selecting
  nothing but its id.

- **A multi-line note gained carriage returns on every import.** Browsers rewrite bare
  LFs to CRLF when uploading a file as multipart form data, so a notes field exported
  by Hearth came back with line endings it never had, and re-importing an untouched
  export was a change rather than a no-op. Cells are now normalised to LF on read,
  which is also what the textarea that edits them produces — one representation
  rather than three. Hearth's own CSV parser was never at fault, which is why only a
  test driving a real browser could find this.


## [0.4.0] — 2026-08-12

### Added

- **Sharing contacts and events between users (completes milestone 4).** Grant
  another user of the same install access to one record, or to everything of a kind,
  as view-only or editable.
  - Blanket grants cover records added later, which is why they exist rather than
    being expanded into one share per record.
  - **Deleting always stays with the owner**, whatever is granted: an edit share is
    permission to help maintain a record, not to destroy someone else's.
  - Either side can withdraw a share, so a recipient is never stuck with someone
    else's records cluttering their lists.
  - A shared **contact** reaches every recipient's Google Contacts, so one Hearth
    record means one entry in each address book — see the sync fix above. A shared
    **event** does not go on their calendar; it reaches them only if they are invited
    as a guest and accept, which is Google's own model for who owns an event.
  - A shared record is read through its **owner's** field definitions — custom values
    are keyed by the owner's field keys, so using the viewer's registry would render
    nothing, or worse, whatever happened to share a key name.
  - The whole change is confined to `src/lib/access.ts` plus the new model, which is
    what routing every query through `readable*Where` / `writable*Where` in M1 was
    for.

- **A *Push contacts shared with me* setting**, so a recipient can keep shared
  contacts in Hearth without having them copied into their Google Contacts. On by
  default, because landing in everyone's address book is the point of sharing a
  contact. Turning it off **removes the copies already there** rather than only
  halting future pushes: a copy nothing will ever update again is worse than no copy,
  since it still looks current. Re-enabling pushes fresh copies.

- **Field → Google mapping pages (part of milestone 4).** Each user-defined field
  now chooses its own destination in Google, replacing the all-or-nothing
  `syncCustomFields` switch. Contacts can send a field to a Google custom field, the
  notes, a nickname, an occupation, a link, an email, a phone or an address; events
  to the description or to private metadata invisible to guests.
  - Every destination is **append-only**. Google's `organizations` and `birthdays`
    are single-valued, so offering them would raise a precedence question against
    the core columns that own them — and every answer surprises someone. Excluding
    them means the page needs no rules: a mapped field adds, never replaces.
  - Core fields cannot be re-pointed, only switched off. `givenName →
    names.givenName` is structural, but being able to keep private notes out of
    Google matters.
  - Saving queues every record for a fresh push, since changing a destination
    changes what the Google copy should look like without touching any record.
  - Upgrading carries the old switch forward: anyone who had it on gets a
    `userDefined` mapping per custom contact field.

### Changed

- Sharing now picks recipients from a **multi-select list of the install's users**
  rather than asking for a typed email address. Sharing can only ever target someone
  who has already signed in, so asking for an address invited typos and
  non-existent recipients to describe a set that was always enumerable — and
  granting the same thing to two people is one intention, not two visits to the form.
  Ticking grants or updates access; unticking does not revoke, so an accidental
  untick cannot silently withdraw it. Ids are still re-checked server-side, since a
  form submission is not a trustworthy source of "this user exists and is not me".

### Fixed

- **A view-only recipient was shown controls they could not use.** Both detail pages
  gated on ownership alone, so someone with a VIEW share saw Edit, the relationship
  add and remove controls, the label editor, and on an event the add-attendee, RSVP
  and remove-attendee controls. The server actions always refused — nothing was ever
  writable and no data was exposed — but the UI led people into an error page.
  - The pages now ask `canWritePerson` / `canWriteEvent`, which are thin boolean
    wrappers over the same `writable*Where` predicate the action guards use. A page
    cannot offer a control the action behind it will reject, because both read the
    rule from one place.
  - Found by the new end-to-end suite on its first full run.

- **A shared contact never reached the other person's Google Contacts.** Sync
  scoped to records you own, on the reasoning that someone else's contact was not
  yours to publish — which is the opposite of what sharing a contact is for. One
  Hearth record should mean a copy in every shared address book, with an edit by any
  of them updating all of them.
  - Per-account sync state moved off the `Person` row into a new `PersonSync` table,
    one row per (contact, Google account). The old shape permitted exactly one
    resource id — the owner's — so sharing was structurally invisible to Google.
    Existing links are migrated, so nothing re-adopts or duplicates.
  - Copies succeed and fail independently, each with its own etag, error and backoff.
  - Custom fields render through the **owner's** registry and mappings, so one Hearth
    record looks the same in every account rather than being reinterpreted per viewer.
  - Withdrawing a share removes the contact from that account's Google and no other;
    deleting it removes every copy. Recipients can decline the whole behaviour with
    *Push contacts shared with me*.

- **An edit to a shared record was parsed with the editor's field registry.** Custom
  values are keyed by the owner's field definitions, so a shared editor's save wrote
  foreign keys into the owner's record. Both edit actions now load the owner's
  registry, matching what the detail pages already did.

## [0.3.0] — 2026-08-10

Marks milestone 3 confirmed working against a real Google account: an event ticked
"Send to Google Calendar" appears on the calendar, its guests are invited by email,
and their replies come back into Hearth as RSVPs.

No code changes. Under Hearth's versioning a minor release asserts that a milestone
has been verified in production rather than that code was written — the code itself
shipped in `0.2.0` and was fixed in `0.2.1`. The bump exists so a running install
reports which build is the verified one.

## [0.2.1] — 2026-08-10

### Fixed

- **Guests were added to events but never emailed, so they could never RSVP.**
  `sendInvites` shipped defaulting to false and the default was later changed to
  true, but `ALTER COLUMN SET DEFAULT` governs only rows inserted afterwards — so
  every existing install still had it off. The same gap as `Event.addToGoogle` one
  migration earlier, missed for this column. Now backfilled.
- **"Open in Google Calendar" returned a 500.** The link was built by base64-encoding
  `"<eventId> <calendarId>"`, but Google's shareable id expects the calendar's *email
  address*, which for the primary calendar is the account's own — not the literal
  string `primary`. Hearth now stores the `htmlLink` Google returns on write and uses
  that. Events synced before this fall back to a link to the right day.
- **Location appeared twice on the event page.** It had a row of its own and was also
  picked up by the loop over registry fields, whose exclusion list had missed it.

### Added

- **Place search on the event location field**, behind a provider interface.
  OpenStreetMap is the default and needs no key or billing; setting
  `GOOGLE_PLACES_API_KEY` switches to Google Places, which is better for small
  venues. Selectable in Settings, with `auto` preferring Google when a key exists.
  The key stays server-side, lookups are cached and rate-limited per install rather
  than per browser tab, and the field remains a plain text box so an unreachable
  provider cannot stop you entering an address.

### Changed

- Adding a guest to an event is now a type-to-search field rather than a dropdown of
  everyone. Matching is wildcarded at both ends and spans name, nickname,
  organisation and email, so "ell" finds both Ellery and Campbell. People already on
  the event are excluded, and no longer is the whole contact list shipped to the
  browser to populate a select.

## [0.2.0] — 2026-08-09

Marks milestone 2 confirmed working against a real Google account — contacts both
create and update in Google Contacts. Milestone 3 (calendar) ships here too but has
only been tested against a fake Calendar API; the minor version marking it verified
comes once it has run against a real calendar.

### Added

- **Calendar sync with attendee invites and RSVP writeback (milestone 3).** Events
  with "Add to Google" ticked are created on the chosen calendar and kept current;
  unticking or deleting one removes the Google copy. Changing the target calendar
  moves existing events rather than orphaning them.
  - Attendees with a primary email become Google guests, optional when their Hearth
    role is. Anyone without an email is reported on the event page rather than
    silently dropped, since Google identifies guests only by address.
  - **Events are Hearth-only unless you tick "Send to Google Calendar".** Unlike
    contacts, which default to syncing, an event reaches Google only by explicit
    per-event choice — most of what a PRM records is history, and history does not
    belong on a calendar. Existing events are switched off by the migration, since
    they predate calendar sync and carried the old default.
  - Because nothing reaches Google unasked, guest notifications default **on**: a
    guest who is never emailed can never RSVP, which would make the writeback
    pointless. Notifications remain suppressed for events that have already
    finished, and can be turned off entirely.
  - RSVPs flow back from Google — the one direction where Google is authoritative —
    matched on the address the guest was invited under rather than the person's
    current email, because those diverge.
  - A push reads the event before patching, so carrying each guest's existing
    responseStatus across stops the write from resetting every reply.
  - Target calendar is picked from a list of calendars you can write to, falling
    back to a text field if Google cannot be reached.
  - Per-event error state and exponential backoff, matching contact sync.
- The migration guard now also catches `DROP COLUMN` and column type changes, which
  lose data just as surely as `DROP TABLE`. Deliberate cases are marked with
  `-- hearth:allow-destructive` and a reason, as the M3 migration does for removing
  the unused `Event.googleSyncToken`.

### Added

- A link to the synced Google contact on each person's page. The SYNCED badge only
  means Google accepted the write, and changes take a while to surface in the
  Contacts UI, so being able to open the record settles "did that actually go
  through?" without guesswork.

## [0.1.1] — 2026-08-09

### Added

- **One-way contact sync to Google (milestone 2).** Contacts with "Add to Google"
  ticked are created and kept up to date in Google Contacts; unticking one, or
  deleting the person, removes the Google copy. Hearth is authoritative for the
  fields it manages, so Google-side edits to those are overwritten.
  - Runs on a timer inside the app process — no extra container — guarded by a
    per-user database lease so the scheduled loop and the manual "Sync now" cannot
    double-process records. `SYNC_ENABLED` and `SYNC_INTERVAL_SECONDS` configure it.
  - Failures are classified rather than uniformly retried: a revoked grant stops
    sync and prompts a reconnect, a rate limit pauses the run and leaves records
    pending, a stale etag is re-read and overwritten, and a contact deleted in
    Google is re-created. Per-record exponential backoff from 1 minute to a
    6-hour ceiling.
  - Each contact carries a `hearth_id` custom field, so a create that reached
    Google but was never recorded locally is adopted rather than duplicated.
  - Optional push of user-defined fields as Google custom fields, off by default.
  - Settings shows the last run, its result, the queue depth and the number of
    failing records, with "Sync now" and "Re-queue every contact".
- `scripts/check-migrations.sh`, which fails on a migration containing
  `DROP TABLE`/`DROP SCHEMA`/`TRUNCATE`. Added after `prisma migrate diff
  --from-migrations` with a shadow in a non-default *schema* generated a migration
  that dropped every table — the shadow must be a separate database.

- `deploy-hearth.sh`, a one-command first-time install. Checks prerequisites,
  clones through a container (no `git` on the host required), generates `.env`
  with real random secrets, auto-detects and wires up SWAG, builds, starts and
  waits for the health endpoint. Idempotent: it never overwrites an existing
  `.env`, since the database password in it is baked into the Postgres data
  directory.
- `update-hearth.sh`, which takes a verified `pg_dump` before pulling and
  rebuilding, aborts without rebuilding if that backup fails or looks truncated,
  applies backup retention, and reports the running version before and after.
- Storage-pool safety check in the installer. `mkdir -p /mnt/typo/...` succeeds
  on Unraid's RAM-backed root filesystem, producing an install that works until
  the next reboot and then loses the database, so the pool must be a real mount
  point (override with `--force-path`).

- `PGDATA_PATH` setting to bind-mount the Postgres data directory instead of
  using a Docker named volume. Needed on appliance hosts such as Unraid, where
  the volume store sits on a fixed-size `docker.img` that routine
  troubleshooting erases. Unset or empty keeps the previous named-volume
  behaviour, so existing installs are unaffected.
- Deployment guide for Unraid, covering the Google redirect-URI restriction on
  LAN addresses, pool paths versus `/mnt/user`, and getting the source onto a
  host with no `git`.
- `docker-compose.proxy.yml` overlay for running behind a reverse proxy. Joins
  the proxy's existing Docker network and fixes the container name, so the proxy
  can address Hearth as `hearth-app:3000` — Docker's embedded DNS only resolves
  container names on user-defined networks, so a shared network is the only way
  name-based upstreams work.
- `APP_BIND` setting to choose which interface the port publishes on. Set to
  `127.0.0.1` behind a proxy so the only route in is through TLS.
- `deploy/swag/hearth.subdomain.conf`, a ready-to-use SWAG proxy config with the
  Docker resolver (so the upstream survives container recreation) and response
  buffering disabled (so streamed renders are not held back).
- `deploy/swag/hearth-hostip.subdomain.conf`, the host-IP variant: an http-to-https
  redirect, SWAG's own `proxy.conf` include (which maps `Connection` through
  `$connection_upgrade` rather than hardcoding `upgrade` on every request), and no
  resolver, the upstream being a literal address.

- `--proxy-conf-dir` and `--proxy-conf-name` to control exactly where the nginx
  config is written and what it is called, for people who keep their reverse-proxy
  configs in `site-confs/` or under their own naming scheme. Warns when the chosen
  filename would not match nginx's include glob for that directory — a mistake that
  writes the file successfully, never loads it, and logs nothing.
- `--host-ip` to override the detected upstream address on a multi-homed server.
- The generated nginx config is now validated with `nginx -t` inside the proxy
  container before it is restarted. On rejection the file is removed and the proxy
  is left running untouched, so a bad config cannot take down the other sites it
  serves.

- The installer refuses to generate a new `.env` when the Postgres data directory
  already holds a database. Postgres only runs `initdb` on an empty directory, so
  an existing cluster keeps its original credentials while a regenerated `.env`
  carries new ones — an install that looks fine and cannot authenticate.

- The installer redacts embedded credentials when echoing the repository URL, so
  cloning a private repo with a token in the URL does not leave that token in
  terminal scrollback or logs.

### Changed

- The installer discovers and names the actual storage pools on the server when the
  database would land on `/mnt/user`, rather than suggesting `/mnt/cache` — pools
  are user-named, and plenty of servers have no pool called `cache` at all. Array
  disks, the FUSE union shares and Unraid's auxiliary mounts are filtered out.
- `--pgdata-path` to put the database somewhere other than under the install root,
  so the app files and backups can stay on `/mnt/user` — visible to SMB and the
  Appdata Backup plugin — while the fsync-heavy database sits on a pool. The
  installer warns when the database would land on `/mnt/user` and names the flag.
- `--proxy-conf-dir` now accepts a path relative to the reverse proxy's `/config`
  mount, so `nginx/site-confs` is correct regardless of whether the host side of
  that mount is `.../appdata/swag` or `.../appdata/swag/config`. An absolute path
  that does not exist reports the real mount point and lists the directories that
  are actually there, rather than just failing. Documentation no longer hardcodes a
  SWAG appdata path anywhere, since that path is not portable between setups.

- Both scripts now use the host's `git` directly instead of borrowing it from an
  `alpine/git` container. The container detour was based on a wrong assumption that
  Unraid ships without git; it made the commands harder to read, and forced
  `update-hearth.sh` to parse `.git/HEAD` and `packed-refs` by hand to find the
  commit. `git` joins `openssl` and `curl` as a checked prerequisite. Net 28 lines
  removed.

- Pinned the Compose project name to `hearth`. It was previously derived from the
  directory the compose file sits in, so a checkout at `.../hearth/app` produced a
  project named `app` with containers called `app-1`, liable to collide with any
  other stack living in a directory named `app`. Existing installs will see their
  containers recreated under the new names; bind-mounted data (`PGDATA_PATH`) is
  unaffected, but anyone who used the default named volume will find it orphaned as
  `app_pgdata`.

- The default install root is now `/mnt/user/appdata/hearth`, the standard Unraid
  appdata location — what official templates use, what the Appdata Backup plugin
  covers, and what is reachable over SMB. Pointing `--install-root` at a pool
  directly (`/mnt/<pool>/appdata/hearth`) still works and bypasses the FUSE layer
  for database writes. The mount-point safety check is unaffected: Unraid mounts
  shfs at `/mnt/user`, so a real share and a real pool both pass, while a typo
  still fails.
- The installer now defaults to proxying via the **host IP** rather than creating
  a shared Docker network. Proxying to the published port works regardless of
  what networks exist and, unlike the shared-network mode, does not modify the
  reverse-proxy container at all — the least surprising thing to do to
  infrastructure someone already set up. `--proxy network` opts into the old
  behaviour, `--no-proxy` skips it entirely.

- Dropped `http2 on;` from the generated config. It requires nginx 1.25+, and on
  an older proxy the directive is fatal at startup — a large blast radius for a
  marginal gain.

### Fixed

- **First start failed with `container hearth-db-1 is unhealthy`.** The database
  healthcheck tolerated only 60 seconds, but `initdb` is fsync-bound and takes 45+
  seconds on a parity-protected array or through Unraid's FUSE layer, followed by a
  slow shutdown checkpoint before the real server starts. Both healthchecks now
  allow around four minutes, which costs nothing on a healthy database because
  `pg_isready` succeeds on the first check. The scripts' own waits went from 180 to
  300 seconds and now report progress, so a slow first boot is distinguishable from
  a hang.

- **The container failed to start: `Cannot find module 'effect'`.** The runtime
  image copied hand-picked directories (`prisma`, `@prisma`, `.prisma`) out of the
  build tree, but the Prisma CLI's dependency closure is 34 packages that npm
  hoists to the top level — `@prisma/config` requires `effect` from
  `node_modules/effect`, which was never copied. The CLI now gets a clean-room
  install in its own build stage, so npm computes the closure instead of us
  guessing, and lives in a separate tree that cannot collide with the app's
  dependencies. Building that stage from the same alpine base also means the
  schema engine is the musl build the runtime needs.

- The installer no longer sets `APP_BIND=127.0.0.1` whenever it detects SWAG.
  That is only correct when SWAG reaches the app over a shared Docker network; for
  the common `proxy_pass http://<host-ip>:3000` setup it bound the port to
  loopback and the proxy got connection refused.
- `scripts/docker-up.sh` no longer requires `node` or `git` on the host. It reads
  the version from `package.json` and the commit from `.git/` (loose refs and
  `packed-refs`) using only POSIX shell, so images built on Unraid, Synology or
  TrueNAS still carry a correct build stamp instead of reporting `unknown`.

## [0.1.0] — 2026-08-07

First working release. The complete data model and CRUD application, plus the
groundwork the Google sync worker needs. **Nothing is sent to Google yet.**

### Added

- **People** with first/last name, nickname, organisation, job title, birthday
  and notes, plus unlimited repeatable contact details (emails, phones,
  addresses, links, social handles). The first email and phone of each person are
  treated as primary.
- **Relationships** between people, typed and directional. Each link is stored
  once and reads correctly from both ends — "Jack is the *parent of* Jill" renders
  on Jill's page as "*Child of* Jack". Twelve built-in types are seeded; users can
  define their own, symmetric or directional.
- **Events** with title, description, location, start/end, all-day and timezone.
  Times are entered as wall-clock times in the event's own zone and stored as
  absolute instants, so they survive daylight-saving changes.
- **Event attendance** linking people to events, each with a role
  (host / required / optional), an RSVP status, and a per-person "invite in
  Google" flag.
- **Extensible fields** on both people and events — text, long text, number,
  date, date & time, yes/no, single choice, multiple choice, email, phone and
  link. Defined in Settings and live immediately with no restart or migration.
  Fields can be required, carry help text, and appear as list-view columns.
  Archiving a field hides it while preserving stored values; deleting one erases
  its values from every record.
- **Google sign-in** via Auth.js, requesting granular
  `contacts` / `calendar.events` / `calendar.readonly` scopes rather than blanket
  calendar access, with `access_type=offline` so background sync can refresh its
  own token. Settings detects a grant missing scopes or offline access and
  prompts a reconnect.
- **"Add to Google"** on both record types, checked by default, with the default
  configurable per account.
- **Deletion bookkeeping.** Deleting a synced record, or unchecking "Add to
  Google", records the Google resource id in a tombstone queue *before* the local
  row disappears — so the remote copy can still be found and removed once the
  sync worker exists. Re-checking cancels an unprocessed tombstone.
- **Search** across people (name, organisation, job title, notes, contact
  details) and events (title, location, description, attendee names).
- **Docker packaging**: `docker compose up` runs the app plus Postgres 16. The
  entrypoint applies migrations and runs an idempotent seed on every start, so
  upgrades that add columns need no extra step.
- `GET /api/health` reporting database reachability and build identity.

### Notes

- Pinned to Next.js 15.5 rather than 16 so the toolchain also runs on Node 18.
  The container itself runs Node 22.
- Sync settings are saved and every record tracks its own sync state, but no
  requests are made to Google until `0.2.0`.

[Unreleased]: https://gitlab.com/hearth-prm/hearth/-/compare/v1.2.0...main
[1.2.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v1.2.0
[1.1.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v1.1.0
[1.0.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v1.0.0
[0.6.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.6.0
[0.5.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.5.0
[0.4.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.4.0
[0.3.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.3.0
[0.2.1]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.2.1
[0.2.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.2.0
[0.1.1]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.1.1
[0.1.0]: https://gitlab.com/hearth-prm/hearth/-/tags/v0.1.0

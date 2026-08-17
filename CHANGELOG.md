# Changelog

All notable changes to Hearth are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Hearth uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, each planned milestone lands as a **minor**
bump and may include breaking changes.

A milestone's minor version is cut once that milestone has been confirmed working
against a real Google account — not when the code is written. Patch releases carry
deployment fixes and milestone work that is complete but not yet verified in
production, so a feature can ship in a patch release ahead of the minor version
that formally marks its milestone.

| Version | Milestone |
|---|---|
| `0.1.0` | M1 — data model, extensible fields, CRUD, Google sign-in |
| `0.2.0` | M2 — one-way contacts push to Google |
| `0.3.0` | M3 — calendar push, attendee invites, RSVP writeback |
| `0.4.0` | M4 — field↔Google mapping settings, record sharing |
| `0.5.0` | M5 — labels, CSV import/export, contact filtering |
| `1.0.0` | All milestones shipped and stable |

## [Unreleased]

### Fixed

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

[Unreleased]: https://gitlab.com/hammerling/hearth/-/compare/v0.5.0...main
[0.5.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.5.0
[0.4.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.4.0
[0.3.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.3.0
[0.2.1]: https://gitlab.com/hammerling/hearth/-/tags/v0.2.1
[0.2.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.2.0
[0.1.1]: https://gitlab.com/hammerling/hearth/-/tags/v0.1.1
[0.1.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.1.0

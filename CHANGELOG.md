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
| `1.0.0` | All four milestones shipped and stable |

## [Unreleased]

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
  - Sync is deliberately unaffected: it queries by owner, so a contact shared with
    you is never pushed into your Google account.
  - A shared record is read through its **owner's** field definitions — custom values
    are keyed by the owner's field keys, so using the viewer's registry would render
    nothing, or worse, whatever happened to share a key name.
  - The whole change is confined to `src/lib/access.ts` plus the new model, which is
    what routing every query through `readable*Where` / `writable*Where` in M1 was
    for.

### Added

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

[Unreleased]: https://gitlab.com/hammerling/hearth/-/compare/v0.3.0...main
[0.3.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.3.0
[0.2.1]: https://gitlab.com/hammerling/hearth/-/tags/v0.2.1
[0.2.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.2.0
[0.1.1]: https://gitlab.com/hammerling/hearth/-/tags/v0.1.1
[0.1.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.1.0

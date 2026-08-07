# Hearth

A self-hosted personal relationship manager. Keep track of the people in your
life, how they're connected, and who was where — with fields you define
yourself, and one-way sync out to Google.

Hearth is always the source of truth. It writes to Google Contacts and Google
Calendar; it does not read your Google data back in. (The single exception, which
you opt into, is pulling event RSVPs from calendar guests.)

---

## Status

**v0.1.0 — milestone 1 of 4, complete and running.** See
[CHANGELOG.md](CHANGELOG.md) for what landed, and
[Versioning](#versioning) for the scheme.

| | Feature | State |
|---|---|---|
| ✅ | Add people, with contact details | Done |
| ✅ | Link people by typed relationship | Done |
| ✅ | Add events | Done |
| ✅ | Put people at events, with roles and RSVPs | Done |
| ✅ | Extensible fields on people **and** events | Done |
| ✅ | Google sign-in, with contacts + calendar consent | Done |
| ✅ | "Add to Google" toggle on both record types, default on | Stored; acted on in M2 |
| ✅ | Deletion/opt-out bookkeeping so Google copies can be removed | Recording now |
| ⏳ | Contacts push worker | M2 |
| ⏳ | Calendar push + attendee invites + RSVP writeback | M3 |
| ⏳ | Field ↔ Google field mapping settings page | M4 |
| ⏳ | Sharing contacts and events between users | M4 |

Nothing is sent to Google yet — the worker that talks to Google's APIs is M2.
Everything it will need is already in place: per-record sync state, and a
tombstone queue that records the Google resource id whenever a synced record is
deleted or opted out, so the remote copy can still be found and removed.

---

## Running it

You need Docker and a Google Cloud project. Two commands, once the `.env` is
filled in.

```bash
cp .env.example .env
$EDITOR .env          # see "Configuration" below
docker compose up -d --build
```

Then open <http://localhost:3000>.

The app container runs `prisma migrate deploy` and seeds the built-in
relationship types on every start, so upgrades that add columns need no extra
step, and a fresh volume comes up ready to use.

```bash
docker compose logs -f app     # follow startup and migrations
docker compose down            # stop (data survives in the pgdata volume)
docker compose down -v         # stop and destroy the database
```

### Configuration

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Change it. Also appears inside `DATABASE_URL`. |
| `DATABASE_URL` | yes | Host is `db` (the compose service name), not localhost. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_URL` | yes | Public origin, no trailing slash. Must match Google's redirect URI. |
| `AUTH_TRUST_HOST` | behind a proxy | `true` when running behind Caddy/nginx/Traefik. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | yes | From Google Cloud Console, below. |
| `APP_PORT` | no | Host port, default `3000`. |

### Google Cloud setup

1. Create (or pick) a project at <https://console.cloud.google.com>.
2. **APIs & Services → Library** — enable both:
   - **People API** (contacts)
   - **Google Calendar API**
3. **APIs & Services → OAuth consent screen**
   - User type **External** is fine for a personal install.
   - Add yourself under **Test users**. An app in "Testing" doesn't need Google
     verification, and its refresh tokens last indefinitely for test users.
   - Add these scopes:
     - `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
     - `https://www.googleapis.com/auth/contacts`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type **Web application**.
   - Authorised redirect URI: `${AUTH_URL}/api/auth/callback/google`
     — e.g. `http://localhost:3000/api/auth/callback/google`.
5. Copy the client ID and secret into `.env`.

Hearth asks for granular calendar scopes rather than the blanket
`.../auth/calendar`, so a stolen token cannot delete your calendars — only manage
events on them. Settings shows exactly which permissions were granted and offers
a reconnect when a scope or offline access is missing.

---

## Running on Unraid

Three Unraid-specific things matter, and the first one will stop you dead if you
don't deal with it up front.

### 1. Google will not accept a LAN address as a redirect URI

Google requires OAuth redirect URIs to use `https`, with `http://localhost` and
`http://127.0.0.1` as the only exceptions, and it rejects private IP addresses
outright. So `http://192.168.1.50:3000/...` cannot be registered, and sign-in
cannot work that way. Pick one:

- **A hostname with a certificate (recommended).** Put Hearth behind Nginx Proxy
  Manager or SWAG (both in Community Applications), get a Let's Encrypt cert via
  the DNS-01 challenge, and point a DNS record at your server's LAN IP. Then
  `AUTH_URL=https://hearth.example.com`. This works entirely on your LAN —
  Google never contacts your server, it only redirects your *browser* — so no
  port forwarding is required. Keep `AUTH_TRUST_HOST=true`.
- **An SSH tunnel**, if you want to try it today without a domain:
  `ssh -N -L 3000:localhost:3000 root@tower`, then use
  `AUTH_URL=http://localhost:3000`. Your browser genuinely sees localhost, so
  Google is satisfied. Only works while the tunnel is open, and only from that
  one machine.
- **A Cloudflare Tunnel**, for a public `https` hostname with no open ports.

### 2. Postgres must not live in a Docker named volume

Named volumes live on `docker.img`, which is a fixed size and is erased whenever
you rebuild the Docker image file — a routine Unraid troubleshooting step that
would take your database with it. Set `PGDATA_PATH` to a real path instead.

Point it at the **pool directly** (`/mnt/cache/appdata/...`) rather than
`/mnt/user/appdata/...`: the latter goes through Unraid's FUSE layer, which adds
overhead and has a poor track record under database write patterns. Substitute
your actual pool name if it isn't `cache`.

Set the `appdata` share to **primary storage: cache, secondary storage: none**,
so the Mover never relocates the files out from under that path. The same files
are still reachable at `/mnt/user/appdata/...` over SMB, which is the comfortable
way to edit `.env`.

### 3. Neither `git` nor `node` is installed

`docker compose` needs the **Docker Compose Manager** plugin from Community
Applications. For the source, use a throwaway container instead of installing
git. `scripts/docker-up.sh` deliberately depends on neither tool — it reads the
version out of `package.json` and the commit out of `.git/` with plain shell, so
your image still gets a correct build stamp.

```bash
# one-time layout (adjust the pool name if yours isn't "cache")
mkdir -p /mnt/cache/appdata/hearth/postgres

docker run --rm -v /mnt/cache/appdata/hearth:/work \
  alpine/git clone https://gitlab.com/hammerling/hearth.git /work/app

cd /mnt/cache/appdata/hearth/app
cp .env.example .env
openssl rand -base64 32          # paste into AUTH_SECRET
vi .env                          # or edit \\TOWER\appdata\hearth\app\.env over SMB

sh scripts/docker-up.sh
curl -s http://localhost:3000/api/health
```

`.env` needs, at minimum:

```ini
POSTGRES_PASSWORD=<something long>
DATABASE_URL=postgresql://hearth:<same password>@db:5432/hearth?schema=public
PGDATA_PATH=/mnt/cache/appdata/hearth/postgres
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://hearth.example.com
AUTH_TRUST_HOST=true
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

### Afterwards

- **Autostart** is handled by `restart: unless-stopped` once Docker is up. To get
  the stack in the Unraid UI, add it in Docker Compose Manager with the project
  directory set to `/mnt/cache/appdata/hearth/app` and enable autostart.
- **Updating**: `docker run --rm -v /mnt/cache/appdata/hearth:/work alpine/git -C /work/app pull`
  then `sh scripts/docker-up.sh` again. Migrations apply automatically on boot.
- **Backups**: the Appdata Backup plugin covers `/mnt/user/appdata`. For a
  restorable logical dump, prefer
  `docker compose exec -T db pg_dump -U hearth hearth | gzip > hearth-$(date +%F).sql.gz`.
- **Build space**: `next build` needs roughly 2 GB of RAM and a couple of GB of
  layer space on `docker.img`. If a build fails for space, `docker system prune`.
- **Port 3000** is a popular default; set `APP_PORT` in `.env` if something else
  already has it.

---

## Using it

**People** — add contacts with as many emails, phones, addresses and links as you
like. The first email and phone of each person are treated as primary; that's the
address used when inviting them to a calendar event.

**Relationships** — link two people with a type such as *Parent of*, *Spouse of*
or one you define yourself. Each link is stored once and reads correctly from
both ends: the row that says "Jack is the *parent of* Jill" renders on Jill's page
as "*Child of* Jack". Directional types have an inverse label; symmetric ones
(sibling, friend) read the same both ways.

**Events** — record a gathering and tick everyone who was there. Each attendee
carries a role (host / required / optional) and an RSVP. Times are entered as
wall-clock times in the event's own timezone and stored as absolute instants, so
they stay correct across daylight-saving changes.

**Custom fields** — Settings → *Contact fields* / *Event fields*. Pick a label
and a type (text, number, date, yes/no, single or multiple choice, email, phone,
link) and it appears on every form immediately. No restart, no migration.

- Fields can be marked **required**, given **help text**, and shown as a
  **column** in list views.
- **Archive** a field to hide it from forms while keeping its stored values — they
  come back intact if you restore it.
- **Delete** a field to also erase its value from every record.
- A field's storage key and type are fixed once created, because values already
  stored were validated against them.

---

## How it's built

Next.js 15 (App Router) · React 19 · Prisma 6 · Postgres 16 · Auth.js v5 ·
Tailwind 4 · TypeScript.

### The field registry

The extensibility requirement shapes most of the architecture. Rather than a
fixed schema plus a bolted-on "extras" blob, Hearth has one **registry** that
describes every field on a record, and the UI, validation and (from M2) the
Google mapping all read from it.

Two storage strategies sit behind one interface:

- **Core fields** (`givenName`, `startAt`, …) are real Postgres columns — fast to
  sort, filter and constrain. They're declared in
  [src/lib/fields/core.ts](src/lib/fields/core.ts), *in code*, because a user
  cannot delete a column without a migration, so they must not be modelled as
  deletable data.
- **Custom fields** live as keys inside a `custom` JSONB column, described by
  `FieldDefinition` rows. Adding one is an INSERT, not a migration. A GIN index
  makes them queryable.

[`loadRegistry()`](src/lib/fields/registry.ts) merges both into a single
`FieldDef[]`, each entry tagged with its `storage`. So a form doesn't enumerate
its inputs — it maps over the registry — and
[`partitionFieldValues()`](src/lib/fields/values.ts) is the only code that knows
which values become columns and which become JSON.

Core field keys are checked against `keyof Person` / `keyof Event` with a
`satisfies` clause, so a typo or a renamed column fails the build rather than
surfacing as a runtime Prisma error.

### Where the seams are

| Concern | File | Why it's isolated |
|---|---|---|
| Authorisation | [src/lib/access.ts](src/lib/access.ts) | Every query uses a `*Where` helper. Sharing (M4) becomes `OR: [{ownerId}, {shares:{some:…}}]` in one file. |
| Deletion bookkeeping | [src/lib/sync/tombstones.ts](src/lib/sync/tombstones.ts) | The Google resource id dies with the local row, so it's recorded *before* the delete. |
| Timezone maths | [src/lib/time.ts](src/lib/time.ts) | Wall-clock ↔ instant conversion, DST-correct, no date library. |
| Google scopes | [src/lib/google/scopes.ts](src/lib/google/scopes.ts) | One list, plus a `grantCovers()` check driving the reconnect prompt. |

Scheduling fields (`startAt`/`endAt`/`allDay`/`timeZone`) are in the registry but
flagged `generic: false`: they're validated uniformly and will be mappable to
Google, but a bespoke component renders them, because the all-day toggle changes
the input type and the timezone decides what instant a time refers to. Validation
stays uniform; rendering doesn't have to be.

### Local development

Requires Node 20+ (the Docker image uses Node 22) and a reachable Postgres.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at localhost:5432
npx prisma migrate deploy
npm run db:seed
npm run dev
```

| Script | Does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | `prisma generate` + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create a migration from schema changes |
| `npm run db:deploy` | Apply committed migrations |
| `npm run db:seed` | Seed built-in relationship types (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run docker:up` | Build and start via compose, stamping version + commit into the image |

`GET /api/health` returns `{"status":"ok"}` and is what the container healthcheck
uses.

Pinned to Next 15 rather than 16 so the toolchain runs on Node 18 as well; moving
to 16 is a version bump plus Node 20+, with no code changes expected.

---

## Versioning

Hearth follows [Semantic Versioning](https://semver.org). Below `1.0.0`, each
milestone lands as a **minor** bump and may break things; patches are fixes only.
`1.0.0` means all four milestones are shipped and stable.

`package.json` is the single source of truth. Everything else derives from it —
there is no second place to remember to edit.

### Knowing what's deployed

The version alone can't tell you whether the container on your server is the
build you think it is, so build identity is baked in at compile time and readable
three ways:

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","database":"up","version":"0.1.0",
#  "commit":"c5f4a75","builtAt":"2026-08-07T17:16:58.392Z"}

docker image inspect hearth:0.1.0 \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

…and in the footer of every page (hover it for the commit and build time).

A build made from uncommitted work is stamped `<sha>-dirty`, so an image never
claims to be a commit it isn't. Building with plain `docker compose up --build`
instead of `npm run docker:up` still works — the commit is just reported as
`unknown`, because `.dockerignore` excludes `.git` and the build has no
repository to ask.

### Cutting a release

```bash
# 1. Describe the changes under "## [Unreleased]" in CHANGELOG.md
$EDITOR CHANGELOG.md

# 2. Bump, promote the changelog, commit and tag in one step
npm version minor        # or: patch / major

# 3. Publish
git push --follow-tags
```

`npm version` runs `typecheck` first, then
[scripts/release-changelog.mjs](scripts/release-changelog.mjs), which renames
`[Unreleased]` to the new version with today's date, opens a fresh `[Unreleased]`
section, and updates the comparison links. That edit lands *inside* the release
commit, so the changelog can never drift from the tag.

It **refuses to run when `[Unreleased]` is empty.** That is deliberate: an
undocumented release fails loudly now rather than being discovered months later
when you're trying to work out what changed.

### The other version axis

`prisma migrate deploy` records applied migrations in a `_prisma_migrations`
table — your *schema* version, tracked independently of the app version and
**forward-only**. Rolling the app image back to an older tag does **not** roll the
schema back, so old code can end up talking to a newer database. If a release
includes a destructive migration, say so in the changelog; otherwise "just
redeploy the previous tag" quietly stops being a safe rollback.

## Data model

```
User ─┬─ UserSettings          sync toggles, target calendar, default timezone
      ├─ Account               Google tokens (Auth.js)
      ├─ Person ─┬─ ContactPoint      repeatable emails/phones/addresses/links
      │          ├─ custom JSONB      user-defined field values
      │          └─ google sync state addToGoogle, resourceName, etag, status
      ├─ Event ──┬─ EventAttendee     role + RSVP + per-person invite flag
      │          ├─ custom JSONB
      │          └─ google sync state
      ├─ Relationship ── RelationshipType   directional or symmetric
      ├─ FieldDefinition       describes one custom field
      └─ SyncTombstone         Google resources awaiting deletion
```

Deleting a user cascades to everything they own. The seeded relationship types
(`ownerId = null`) are shared and survive.

## Licence

Not yet chosen.

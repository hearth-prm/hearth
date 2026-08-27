# Hearth

A self-hosted personal relationship manager. Keep track of the people in your
life, how they're connected, and who was where — with fields you define
yourself, and one-way sync out to Google.

Hearth is always the source of truth. It writes to Google Contacts and Google
Calendar and does not read your Google data back in, with two exceptions you ask
for by name: event RSVPs can be pulled back from calendar guests, and contacts you
already have in Google can be imported once, in place, when you first move in.

---

## Status

**v1.0.0 — every milestone shipped, and the Google round trip verified in both
directions against a real address book.** 330 contacts read and pushed back with
nothing lost; 532 automated checks. See [CHANGELOG.md](CHANGELOG.md) for what landed.

| | Feature | State |
|---|---|---|
| ✅ | Add people, with contact details and photos | Done |
| ✅ | Link people by typed relationship | Done |
| ✅ | Add events | Done |
| ✅ | Put people at events, with roles and RSVPs | Done |
| ✅ | Extensible fields on people **and** events | Done |
| ✅ | Google sign-in, with contacts + calendar consent | Done |
| ✅ | "Add to Google" toggle on both record types, default on | Done |
| ✅ | Deletion/opt-out removes the Google copy | Done |
| ✅ | One-way contacts push to Google | Done |
| ✅ | Calendar push + attendee invites + RSVP writeback | Done |
| ✅ | Field ↔ Google field mapping settings | Done |
| ✅ | Sharing contacts and events between users | Done |
| ✅ | Labels, reaching Google Contacts as labels | Done |
| ✅ | CSV import and export, and richer filtering | Done |
| ✅ | Transferring a contact to another user | Done |

Every original requirement is built and verified. Contacts, events, labels and photos
sync to Google; each field chooses where it lands; records can be shared with, or handed
over to, other users on the same install.

### M6

| | Feature | State |
|---|---|---|
| ✅ | Light, dark or follow-the-system, with a separate accent colour for each | Done |
| ✅ | Gift tracking, and thank-you notes sent as you from your own address | Done |
| ✅ | Household cards — a contact record per user of the install | Done |
| ✅ | Importing contacts from Google in place, by label or one at a time | Done |
| ✅ | A real column for every Google contact field, preserving its shape | Done |
| ✅ | Contact history — every version, who changed it, and what changed | Done |
| ✅ | A trash can that never empties itself | Done |
| ✅ | Multi-select on the people list, with bulk edit and bulk delete | Done |
| ✅ | Pictures imported as pictures, not as URLs | Done |

Two pieces of work are designed and queued rather than built:
[search and filtering](docs/design-search.md) — a query language, then natural language into
it through a local model — and [sticky shares](docs/design-sticky-shares.md), where a label
carries standing sharing intentions.

Verification is largely automated: `npm run e2e` drives a real browser against the
built app through 532 checks, and `npm run e2e:google` runs the Google-facing half
against throwaway accounts. See [docs/](docs/) for the checklists and what is left to do
by hand.

The Google round trip has been checked against a real 327-contact address book, in both
directions: nothing a push would clear, and three contacts actually pushed back with every
field Google returned surviving field-for-field — structured addresses, a birthday with no
year, phone numbers, notes with emoji, and labels left alone.

Nine of the field groups Hearth manages have never been seen on a real contact
(`imClients`, `sipAddresses`, `calendarUrls`, `externalIds`, `miscKeywords`, `interests`,
`skills`, `locations`, `genders`). Google's own interface does not appear to create them, so
they reach an account only from another client; they are covered by fixtures rather than by
your data.

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
   - Add yourself under **Test users**. An app in "Testing" needs no Google
     verification — but see the warning below about how long its tokens last.
   - Add these scopes:
     - `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
     - `https://www.googleapis.com/auth/contacts`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type **Web application**.
   - Authorised redirect URI: `${AUTH_URL}/api/auth/callback/google`
     — e.g. `http://localhost:3000/api/auth/callback/google`.
5. Copy the client ID and secret into `.env`.

Hearth asks for granular scopes rather than blanket ones, so a stolen token can do
less: `calendar.events` cannot delete a calendar, `calendar.readonly` only lists them,
and `gmail.send` can send mail as you but cannot read a mailbox — the least a feature
that only ever sends can ask for. Settings shows exactly which permissions were granted
and offers a reconnect when a scope or offline access is missing.

> **Move the app to "In production" before you rely on it.** While the publishing status
> is **Testing**, Google expires every refresh token after **seven days** — so a
> long-running install stops syncing about once a week and asks you to reconnect, and it
> will keep doing that however many times you do. See
> [Publishing the OAuth app](#publishing-the-oauth-app).
>
> This is what a dead token looks like: sync stops, Settings shows a reconnect prompt, and
> the server log carries `invalid_grant — Token has been expired or revoked`.

`gmail.send` is what thank-you notes are sent with. Leave it out and everything else
still works: the thank-you control refuses up front, saying to reconnect Google, rather
than failing after a note has been written. If you add the scope to an install that has
already signed in, press **Reconnect Google** in Settings — Google widens a grant only
when it re-prompts for consent, and the stored grant is refreshed on every sign-in.

---

## Publishing the OAuth app

Do this once, before you rely on the install. It takes about five minutes and it is the
difference between sync that keeps working and sync that dies every seventh day.

**What publishing is not.** Publishing is not verification. Three states are worth keeping
apart:

| Status | What it means for you |
|---|---|
| **Testing** | Only listed test users can authorise, and **every refresh token expires after 7 days** |
| **In production**, unverified | Anyone you give the URL to can authorise, past a "Google hasn&rsquo;t verified this app" warning. Tokens have no 7-day cap. Fine for a personal install |
| **In production**, verified | The warning disappears. Needs a privacy policy, terms, domain ownership through Search Console, a demo video, and per-scope justification — and for *restricted* scopes an annual third-party security assessment |

For a Hearth install used by you and your household, the middle row is the destination. You
click past one warning screen at sign-in and nothing else changes.

**Before you start**, have ready: an app name, a support email address (your own), and a URL
for a privacy policy. Google may ask for the last one even to publish; any page on your own
domain saying what the app does with your data satisfies it, and it is worth writing anyway.

1. Open <https://console.cloud.google.com> and **select the project** Hearth's client ID
   belongs to. Getting this wrong is the commonest mistake — check the project picker at the
   top rather than trusting whichever project opened.
2. Go to **APIs & Services → OAuth consent screen**. Google has been reorganising this area
   into a **Google Auth Platform** section with *Overview*, *Branding*, *Audience* and *Data
   Access* pages; if that is what you see, the controls below live under **Branding** and
   **Audience**. The names move; the settings are the same.
3. Fill in the branding fields it marks required — app name, user support email, developer
   contact email. Add the privacy policy URL if there is a box for it.
4. Check **Data Access** (or *Scopes*) lists all five Hearth asks for:
   `contacts`, `calendar.events`, `calendar.readonly`, `gmail.send`, plus the
   email/profile/openid trio. A scope missing here is a permission the app can never be
   granted, whatever the code requests.
5. On **Audience** (or the consent screen summary), press **Publish app** and confirm. The
   status should read **In production**. If Google offers to start verification, you can
   decline and stay unverified — see the table above.
6. **Now re-consent, and this is the step people miss.** The seven-day expiry was stamped on
   the token when it was issued, so the token you already have does not become long-lived
   just because the app did. In Hearth: **Settings → Reconnect Google**. Sign in, approve,
   done.
7. If you run the test suite, its tokens are in the same position: `npm run token -- A` and
   `npm run token -- B` again.

**How you know it worked.** Immediately: the consent screen page reports *In production*, and
Settings stops showing a reconnect prompt. Properly: sync is still running eight days later.
That is the only real confirmation, because the failure this fixes is one that only appears on
the eighth day.

**Do not** delete the OAuth client or create a new one to "start clean" — the client id is
what every stored token is tied to, and replacing it invalidates all of them. Adding a new
scope later is fine, but it re-prompts for consent, which is the intended behaviour.

---

## Running on Unraid

### Scripted install

```bash
# On Unraid, via SSH as root
git clone https://gitlab.com/hammerling/hearth.git /mnt/user/appdata/hearth/app
cd /mnt/user/appdata/hearth/app
sh deploy-hearth.sh --domain hearth.example.com
```

Run from inside a checkout, the script uses it in place rather than cloning a
second copy. If the repository is private, put a token in the clone URL —
`https://oauth2:YOUR_TOKEN@gitlab.com/...` — which also lets `update-hearth.sh`
pull unattended later.

**It refuses to run where Hearth is already installed**, naming what it found and how
many contacts are at stake, and points you at `update-hearth.sh` instead. The two
scripts are one keystroke apart and reaching for the wrong one is easy; every
individual step in the installer is non-destructive, but the run as a whole rewrites
the reverse-proxy config from its own defaults. `--force-reinstall` overrides it when
you really do want the installer again — to redo the proxy wiring, say — and even then
your `.env` and database are left alone.

[deploy-hearth.sh](deploy-hearth.sh) does the whole first-time install: checks
prerequisites, verifies your storage root is really mounted, clones the repo if
you haven't already, generates `.env` with real random secrets, wires up SWAG if
it finds it, builds, starts, and waits for the health endpoint.

It never overwrites an existing `.env`, because the generated database password is
baked into the Postgres data directory and regenerating it would lock the app out of
its own data.

You still have to create the Google OAuth client yourself; the script writes
placeholders and prints exactly what to do, including the redirect URI to
register.

```bash
sh deploy-hearth.sh --help          # all options
sh deploy-hearth.sh --no-proxy      # skip reverse-proxy setup
sh deploy-hearth.sh --install-root /mnt/nvme/appdata/hearth
sh deploy-hearth.sh --port 3080     # if 3000 is already taken

# keep the install on /mnt/user but put the database on a pool
sh deploy-hearth.sh --pgdata-path /mnt/YOURPOOL/appdata/hearth/postgres
```

**If the first start times out, this is almost always why.** Postgres is
fsync-heavy, and `initdb` on a parity-protected array or through Unraid's FUSE
layer can take 45+ seconds where a pool does it in three. Check where your data
actually landed — `/mnt/user` is a union, so the real location is a specific
disk or pool:

```bash
# where did the data actually go?
ls -d /mnt/*/appdata/hearth/postgres

# what pools exist? "cache" is only a convention — yours may be named anything
awk '$2 ~ /^\/mnt\// {print $2, $3}' /proc/mounts
```

A `/mnt/diskN/...` result means it's on the array, behind parity. Move it to a pool
with `--pgdata-path`, which leaves the app files and backups on `/mnt/user` where
the Appdata Backup plugin and SMB can still see them. If the database would land on
`/mnt/user`, the installer lists the pools it can see and suggests one.

If you keep your nginx configs somewhere specific, or name them your own way:

```bash
sh deploy-hearth.sh \
  --domain hearth.example.com \
  --port 3080 \
  --proxy-conf-dir  nginx/site-confs \
  --proxy-conf-name HEARTH.EXAMPLE.COM.conf \
  --host-ip 192.168.0.2          # override the detected address if needed
```

`--proxy-conf-dir` accepts a path relative to SWAG's `/config` mount, which the
script discovers from the container. That matters because the host side of that
mount differs between setups — some map `.../appdata/swag` to `/config`, others
`.../appdata/swag/config` — so `nginx/site-confs` is correct everywhere while an
absolute path is a guess. Absolute paths still work if you prefer them, and a wrong
one now reports the real mount and lists what's actually there.

`--port` is the **host** port. The container always listens on 3000 internally, so
in host mode the generated `proxy_pass` gets your port, while in network mode the
upstream stays `hearth-app:3000` — the proxy connects to the container directly and
never goes through the published port.

Two safeguards worth knowing about, since both protect your *other* sites:

- The generated config is checked with `nginx -t` **before** SWAG is restarted. If
  nginx rejects it the file is removed again and SWAG is left running untouched, so
  a bad config can't take down every other site the proxy serves.
- If the filename wouldn't be picked up by nginx's include glob for that directory
  (`*.subdomain.conf` / `*.subfolder.conf` in `proxy-confs/`, `*.conf` in
  `site-confs/`), you get a warning. That mistake writes the file successfully,
  never loads it, and logs nothing.

To deploy changes later, from the install directory:

```bash
sh update-hearth.sh                 # backup, pull, rebuild, restart, verify
sh update-hearth.sh --no-pull       # rebuild after editing .env only
sh update-hearth.sh --prune         # also reclaim docker.img space
```

[update-hearth.sh](update-hearth.sh) takes a verified `pg_dump` **before**
anything else, because the container applies migrations on boot and migrations
only run forwards — that dump is the only thing that can undo a bad one. It
aborts without rebuilding if the backup fails, keeps the newest 10, and reports
the version before and after.

The rest of this section explains what those scripts are doing and why, which is
worth reading once — particularly the first item, which will stop you dead if you
haven't dealt with it.

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

The default is `/mnt/user/appdata/hearth`, the standard Unraid appdata location —
it's what every official template uses, what the Appdata Backup plugin covers, and
what you can reach over SMB to edit `.env` comfortably.

Whichever path you use, set the `appdata` share to **primary storage: cache,
secondary storage: none**. This is the part that actually matters: if the Mover is
allowed to relocate appdata to the array, it will move the database files out from
under a running container.

If you'd rather bypass Unraid's FUSE layer for database writes, point the install
at a pool directly — `--install-root /mnt/user/appdata/hearth`, substituting your
pool's real name. It's measurably faster for write-heavy workloads, at the cost of
a path that breaks if you ever move the share.

### 3. Prerequisites

`docker compose` needs the **Docker Compose Manager** plugin from Community
Applications. `git`, `openssl` and `curl` must be on the host — recent Unraid has
all three, and the Nerd Tools plugin provides git if yours doesn't.

`scripts/docker-up.sh` is the one exception: it deliberately depends on neither
git nor node, reading the version out of `package.json` and the commit out of
`.git/` with plain shell, so an image built somewhere leaner still gets a correct
build stamp.

Doing it by hand rather than with `deploy-hearth.sh`:

```bash
mkdir -p /mnt/user/appdata/hearth/postgres
git clone https://gitlab.com/hammerling/hearth.git /mnt/user/appdata/hearth/app

cd /mnt/user/appdata/hearth/app
cp .env.example .env
openssl rand -base64 32          # paste into AUTH_SECRET
vi .env                          # or edit \\TOWER\appdata\hearth\app\.env over SMB

sh scripts/docker-up.sh
curl -s http://localhost:3000/api/health
```

For a private repository, put a token in the clone URL:

```bash
git clone https://oauth2:YOUR_TOKEN@gitlab.com/hammerling/hearth.git \
  /mnt/user/appdata/hearth/app
```

It persists in that clone's `.git/config`, which is what lets `update-hearth.sh`
pull unattended. A deploy token scoped to `read_repository` is a better fit than a
personal access token, since the server only ever needs to read.

`.env` needs, at minimum:

```ini
POSTGRES_PASSWORD=<something long>
DATABASE_URL=postgresql://hearth:<same password>@db:5432/hearth?schema=public
PGDATA_PATH=/mnt/user/appdata/hearth/postgres
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://hearth.example.com
AUTH_TRUST_HOST=true
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

### Behind SWAG

There are two ways to point SWAG at Hearth. Both work; the difference is only
what SWAG connects *to*.

**Host IP — the default, and the one to pick if you already manage your reverse
proxies in SWAG.** SWAG connects to the port Hearth publishes on the Docker host,
so it doesn't matter what network anything is on, and nothing about your SWAG
container changes.

```bash
# SWAG's appdata path varies with how the template was set up, so ask the
# container where its /config actually is rather than guessing.
SWAG_CONFIG=$(docker inspect swag \
  --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}')

cp deploy/swag/hearth-hostip.subdomain.conf \
   "$SWAG_CONFIG/nginx/proxy-confs/hearth.subdomain.conf"
# replace UNRAID_HOST_IP with your server's LAN IP
docker restart swag
```

`.env` needs `AUTH_URL`, `AUTH_TRUST_HOST=true`, and **`APP_BIND` left unset**.

The trade-off: port 3000 stays open on your LAN over plain HTTP. Anyone hitting it
directly gets the sign-in page but cannot establish a session, because an `https`
`AUTH_URL` makes Auth.js issue `__Secure-` cookies that browsers refuse to send
over HTTP. It is an open door to nowhere rather than a hole, but it is open.

**Shared Docker network — if you'd rather nothing listened on the LAN at all.**
SWAG reaches the container by name, and the host port binds to loopback only.

```bash
docker network create proxynet          # skip if it exists
docker network connect proxynet swag    # attaches to your existing SWAG
# SWAG's appdata path varies with how the template was set up, so ask the
# container where its /config actually is rather than guessing.
SWAG_CONFIG=$(docker inspect swag \
  --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}')

cp deploy/swag/hearth.subdomain.conf \
   "$SWAG_CONFIG/nginx/proxy-confs/hearth.subdomain.conf"
docker restart swag
```

…plus in `.env`:

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
PROXY_NETWORK=proxynet
APP_BIND=127.0.0.1
```

`COMPOSE_FILE` in `.env` makes compose load the overlay automatically, so later
commands need no `-f` flags.

`deploy-hearth.sh` picks host mode automatically when it finds SWAG; use
`--proxy network` for the second option, or `--no-proxy` to be left alone. It
never overwrites an existing proxy config.

Whichever you choose, three things are easy to get wrong:

- **`AUTH_TRUST_HOST=true` is required.** Without it Auth.js ignores the
  `X-Forwarded-Proto` header SWAG sets, decides the request was plain HTTP, and
  builds an `http://` OAuth callback that Google then rejects — which looks like
  a Google Console problem and isn't.
- **Don't set `APP_BIND=127.0.0.1` in host mode.** SWAG connects from outside the
  container to your host's LAN address, so binding the port to loopback gives it
  connection refused.
- **In network mode, `resolver.conf` matters.** nginx resolves an upstream
  hostname once at startup unless a resolver is configured. The app container gets
  a new IP each time it's recreated, so without that include Hearth works until
  your first rebuild and then 502s until SWAG is restarted. Not an issue in host
  mode, where the upstream is a literal IP.

If a wildcard certificate already covers your domain, `hearth.example.com` works
immediately. Otherwise add `hearth` to SWAG's `SUBDOMAINS` and restart it to have
a certificate issued.

### When a rebuild runs out of disk

Unraid keeps Docker inside a fixed-size `docker.img`, and building Hearth locally fills it
with BuildKit cache — one layer per `npm ci`, per build, forever. The array having plenty of
room is no help: this is a separate, smaller disk.

`update-hearth.sh` checks before it builds and stops with the fix rather than failing three
minutes in. To reclaim by hand:

```bash
docker system df              # "Build Cache" is usually the bulk of it
docker builder prune -af
docker image prune -f
```

Do **not** use `docker image prune -a` on Unraid: it removes images no *running* container
references, which means re-downloading anything you have stopped.

For a durable fix, either grow the vDisk (Settings → Docker, with the service stopped) or
switch Docker from a vDisk to a directory so it draws on the pool's real free space. The
other answer is to stop building on the server at all — build the image elsewhere and have
Unraid only ever pull it.

### Afterwards

- **Autostart** is handled by `restart: unless-stopped` once Docker is up. To get
  the stack in the Unraid UI, add it in Docker Compose Manager with the project
  directory set to `/mnt/user/appdata/hearth/app` and enable autostart.
- **Updating**: `sh update-hearth.sh` from the install directory. Migrations apply
  automatically on boot.
- **Backups**: the Appdata Backup plugin covers `/mnt/user/appdata`. For a
  restorable logical dump, prefer
  `docker compose exec -T db pg_dump -U hearth hearth | gzip > hearth-$(date +%F).sql.gz`.
- **Build space**: `next build` needs roughly 2 GB of RAM and a couple of GB of
  layer space on `docker.img`. If a build fails for space, `docker system prune`.
- **Port 3000** is a popular default; set `APP_PORT` in `.env` if something else
  already has it.

---

## Contact sync

Turn it on in Settings once Google is connected. Nothing is sent until you do.

Hearth pushes; it never pulls. Every contact with **Add to Google** ticked is
created in your Google Contacts and kept up to date. Untick it, or delete the
person, and the Google copy is removed on the next run.

**Hearth is authoritative for the fields it manages** — names, nickname,
organisation and job title, birthday, notes, and every email, phone, address and
link. Editing one of those directly in Google is overwritten on the next push.
Anything Hearth does not manage is left alone.

Each synced contact carries a `hearth_id` custom field. That is what lets Hearth
recognise its own contacts, so a create that reached Google but never got recorded
locally is adopted on the next run instead of becoming a duplicate.

Custom fields are **not** pushed unless you switch that on separately — exporting
everything you record about people should be a deliberate act. When enabled they
become Google custom fields labelled as you named them. Per-field mapping arrives
in M4.

### How it runs

A timer inside the app process, every 5 minutes by default. No extra container:
each run takes a per-user database lease first, so the scheduled loop and the
**Sync now** button cannot process the same records twice, and a crashed run
expires rather than blocking sync forever.

| Variable | Default | |
|---|---|---|
| `SYNC_ENABLED` | `true` | `false` stops the timer; "Sync now" still works |
| `SYNC_INTERVAL_SECONDS` | `300` | Minimum 30 |

Only records that changed are pushed — saving a person marks it pending. **Re-queue
every contact** in Settings forces a full push, which is what you want after
enabling custom fields or to overwrite Google-side edits.

### When it goes wrong

Failures are per-record and visible: the contact shows a **Sync error** badge, the
message is on its detail page, and Settings counts how many are failing. A failing
record backs off exponentially from 1 minute to a 6-hour ceiling, so it keeps
retrying without dominating every run.

Errors are classified rather than lumped together, because the right response
differs sharply:

- **Revoked or insufficient grant** — sync stops and Settings prompts a reconnect.
  Retrying cannot help until you act, so it waits 15 minutes between attempts
  instead of burning calls.
- **Rate limited** — the run stops immediately and resumes next cycle. Records are
  left pending rather than marked failed, because nothing was wrong with them.
- **Stale etag** — someone changed the contact in Google. Hearth re-reads and
  overwrites, which is the source-of-truth contract.
- **Contact deleted in Google** — the resource id is forgotten and the contact is
  re-created.
- **Server or network wobble** — retried with backoff.

## Calendar sync

Turn it on in Settings and pick a target calendar. Then tick **Send to Google
Calendar** on the events you actually want there.

**Events are Hearth-only by default.** Most of what a PRM records is history — who
was at a gathering — and history does not belong on a calendar, least of all with
invitations attached. So unlike contacts, an event reaches Google only when you say
so, per event. Recording last year's dinner party needs no thought: leave the box
unticked and nothing is sent and nobody is emailed.

Once ticked, the event is created on the calendar and kept up to date; unticking it,
or deleting the event, removes the Google copy.

Hearth owns the event's title, description, location, timing and guest list.
Changing the target calendar moves existing events — the old copy is deleted and
recreated on the new one.

### Finding a location

The event location field offers place suggestions, from a provider you choose in
Settings:

| Provider | Needs | Good at |
|---|---|---|
| **OpenStreetMap** (default) | nothing | addresses, known venues |
| **Google Places** | `GOOGLE_PLACES_API_KEY` + billing on the Cloud project | small businesses |
| **Off** | — | plain text only |

`auto` uses Google when a key is present and OpenStreetMap otherwise, so an install
works immediately and improves by adding a key — no setting to change.

The field is a plain text box underneath: suggestions only ever write into it, so
typing an address by hand, pasting one, or the provider being unreachable all leave
it fully usable. The resolved address is stored as text in the same `location`
column regardless of provider, so switching or disabling search never migrates data.

Lookups run server-side. The API key never reaches the browser, and the rate limit
OpenStreetMap asks for is enforced per install rather than per browser tab — client
debouncing alone cannot promise that when two tabs are open.

### Guests

Attendees with a primary email are added as Google guests, marked **optional** when
their Hearth role is Optional. Anyone without an email cannot be sent at all —
Google identifies guests only by address — so they stay on the Hearth guest list and
the event page says who was left off.

Google **does** email the guests, because a guest who is never emailed can never
RSVP, and the RSVP writeback is the point of inviting them. That is only safe
because nothing reaches Google unasked: you ticked *Send to Google Calendar* on this
specific event. As a further guard, notifications are suppressed for events that
have already finished even with the setting on, and *Let Google email the guests*
can be turned off entirely for silent mirroring.

### RSVPs coming back

This is the one place Google is authoritative. Each run asks Google for events
changed since the last check and copies guest replies onto the matching Hearth
attendee, which then shows "RSVP from Google" on the event page.

Replies are matched on **the address the guest was actually invited under**, not the
person's current primary email — those diverge once someone changes their address,
and the invite Google holds still carries the old one.

Two consequences worth knowing:

- A push has to read the event first, because patching the attendee list would
  otherwise reset everyone's reply to "no response". Hearth carries each existing
  responseStatus back into the payload.
- An event's Google form depends on data outside the event: changing someone's
  email changes who gets invited but touches only the Person row, so the events
  they are on are not re-pushed automatically. **Re-queue every event** in Settings
  after changing addresses.

## Labels, filtering and CSV

### Labels and filtering

Contacts can be labelled — Family, Book club, whatever you like — from any contact's
page, with the labels themselves managed in **Settings → Labels**. Each one also
becomes a label in Google Contacts, so the grouping you build here is the one you see
on your phone.

Google labels belong to an account rather than to a contact, so a label on a shared
contact is created separately in each person's Google: same name, different
underlying group. Hearth only ever touches groups it created — labels you make by
hand in Google are left alone. A shared contact carries its **owner's** labels, so it
reads the same for everyone who can see it.

The contact list filters by label (any or all of them), by who can see a contact
(mine, private, shared by me, shared with me), by Google sync state, and by whether
there is an email or phone. Every filter is a link, so a filtered list is a URL you
can bookmark and Back out of one step at a time.

### Doing one thing to many contacts

Tick the rows you want — or the checkbox in the header to take everything listed — and a bar
appears with what can be done to a selection: add or remove **labels**, set or clear **any
field**, turn **Add to Google** on or off, or **move them to the trash**. When the list is
showing the first 200 of more, the bar offers *all N matching this filter* instead of only
what is on screen.

**Fields** covers everything a contact form does — core fields and your own custom ones —
with two rules that make it safe to use on two hundred rows at once. Only a field you tick is
written, so nothing you left alone is blanked. And clearing is a separate tick, because an
empty box on a ticked field cannot otherwise be told apart from not touching it. Values are
validated exactly as the single-contact form validates them, and each contact records the
change in its history.

**Sharing** works the same way: pick who, pick whether they can edit, and share or withdraw
the whole selection. Only contacts you own can be shared — an edit grant is help maintaining
a record, not the right to pass it on — and withdrawing a share removes those contacts from
that person's Google. If they can still see them through a blanket grant, the confirmation
says so rather than letting you believe otherwise.

Deleting stays owner-only, per record, and the bar tells you when it left something alone
rather than quietly doing most of what you asked. Emails, phones and addresses are not
offered: those are repeatable rows belonging to one person.

### Import and export

**Export** writes a CSV of whatever the contact list is currently showing — filter
first, and the export follows. It includes labels, sharing, contact details and your
own custom fields, plus a `Hearth ID` column that makes the file re-importable.

**Import** previews every row before writing anything: what will be created, what
will be updated, which rows are skipped and why. Rows match on `Hearth ID`, then on
the first email among your own contacts. Columns the file leaves out are left alone,
so a narrow CSV cannot blank out fields it never mentions.

Sharing in an import **grants only** — a recipient the file omits never loses access.
Import never deletes a contact.

The CSV has a column per field rather than a nested format, addresses included: `Address 1
street`, `Address 1 city`, `Address 2 postcode` and so on, as many slots as the contact
with the most addresses needs. A file that mentions only some of them leaves the rest
alone.

## Photos

Each contact can have a picture, shown on their page and beside every row in the list.
Initials stand in when there is none.

The **owner's photo is the default** and reaches everyone the contact is shared with —
but a recipient can set their own instead. That is the one place Hearth deliberately
lets one record look different to two people: a photo answers *is this the person I
mean?*, and the answer can honestly differ. You might have a picture of someone from a
work event while your wife has one from her sister's wedding; neither is wrong, and
Google gets whichever one belongs to that account.

Anyone who can see a contact may set their own photo, whether or not they can edit it.
Doing so changes nothing for anybody else. Clearing it hands you back the owner's.

Pictures are resized to 512px in your browser before being uploaded, which also strips
EXIF metadata such as where the photo was taken. They are stored in Postgres, so the
backup `update-hearth.sh` already takes before every update includes them.

Your own Google profile picture appears in the header.

## Transferring a contact

From a contact's page, under **Record**, an owner can hand it to another user of the
install. Ownership is not a label: it decides which field definitions read the record,
whose labels apply to it, and who may delete or share it.

You choose what you keep — nothing, view, or view and edit. **Choosing nothing is what
takes the contact out of your Google Contacts**; keeping access necessarily keeps it
there, since you can still read it.

| | |
|---|---|
| **Shares you granted** | Move with the record — nobody already sharing it loses access |
| **Your labels on it** | Removed. A label is your own filing system, not theirs |
| **Custom field values** | Kept, but hidden unless the new owner has a field of the same name. Transferring back restores them |
| **Who can transfer** | The owner alone. An edit share is help maintaining a contact, not a say in who owns it |

The confirmation lists whichever of these apply before you commit. The new owner is not
notified.

## Sharing

Anyone else signed in to the same install can be given access to your records, from
**Settings → Sharing** for everything at once, or from a contact's or event's own
page for just that one. You pick them from a list of the install's users and can tick
several at once — there is no address to type, since sharing can only ever target
someone who has already signed in.

Ticking someone grants or updates their access; unticking does **not** revoke it.
Revoking is a separate control, so an accidental untick cannot quietly withdraw
access.

| | |
|---|---|
| **View** | They can see it. |
| **View and edit** | They can change it too. |
| **Delete** | Always yours alone, whatever you grant. |

Sharing everything is a standing grant: it covers records you add later, which is
why it exists rather than being expressed as one share per record.

Shared records appear in the recipient's lists marked *shared*, and their detail page
says who it came from. Either side can withdraw a share — the owner revoking it, or
the recipient removing it from their own lists.

### Shared contacts reach everyone's Google

A shared contact lands in **every** shared user's Google Contacts, and an edit by any
of them updates all the copies. One Hearth record, one source of truth, N address
books.

Each copy has its own resource id, etag and retry state, so they succeed and fail
independently — a permissions problem in one account never stalls another. Custom
fields render through the **owner's** field definitions and mappings, so the contact
looks the same everywhere rather than being reinterpreted per viewer.

Withdrawing a share removes the contact from that person's Google, and only theirs.
Deleting the contact removes it from all of them. Anyone who would rather not have a
partner's whole address book in their own Google can turn *Push contacts shared with
me* off in Settings.

Events work differently, and deliberately: a shared event stays on the owner's
calendar only. Guests reach their own calendars by being invited and accepting, which
is the mechanism Google already has for it. A shared editor can still add attendees
and change the event in Hearth, and their additions are invited from the owner's copy
— so nobody receives two invitations to the same thing.

## Gifts and thank-yous

Gifts are recorded on an event or on a contact's own page: what it was, who gave it, who
it was for, and a note if you want one. A present at a gathering hangs off that
gathering, so Christmas reads as Christmas rather than as fourteen loose rows.

**One gift can have several recipients, and each of them owes their own note.** A week in
Wales for both children is one gift and two thank-yous — the state lives on the pairing of
gift and recipient, not on the gift.

*write thank you* opens a box, and sending it mails the note **as you, from your own
address, to whoever gave the present**. Once it has gone, a *thanked* badge takes the
link's place. Nothing is marked thanked by a send that failed, and a refused send keeps
what you wrote.

Whose thanks you may write is a narrower question than whose record you may edit:

| | |
|---|---|
| **Your own** | Always |
| **Another user's** | Only if they have ticked *allow the head of household to write my thank-yous*, and only by the head |
| **Anyone else's** | Never — a note is signed by whoever sends it |

Only users of the install send thank-yous, by design. A contact who is not a user has
nobody to write for them, and that is the answer rather than an omission.

## Household cards

Every user of the install gets a contact card — the record that represents *them*. The
head of the household owns those cards and everyone can edit them, so your own details
reach your own Google Contacts, which is what your phone's "share contact" sends.

The first user to sign in becomes the head, and it can be handed over in **Settings →
Sharing**. A card can be moved to the trash and restored like any contact, but it cannot
be destroyed while a user is attached to it: their thank-yous and their place in the
household hang off that row. Unlink it first.

## Importing from Google Contacts

**People → Import from Google**, beside *Import CSV* at the top of the contact list. Pick a Google label or tick individual
contacts, and Hearth adopts them: the Google contact is not moved, copied or re-created.
It stays exactly where it is, gains a `hearth_id`, and from then on the two are the same
contact.

The preview says what each row will bring with it and, when something has nowhere to go,
what will be kept as a custom field rather than dropped. **Pictures come across as
pictures** — the photo is downloaded and becomes the contact's picture in Hearth, whether
Google holds it as the contact's own photo or as a *Photo* custom field left behind by its
CSV importer. Google's generated grey silhouette is skipped, so contacts without a real
picture keep their initials. Everything Hearth models lands in
a real column — the parts of a name, the parts of an address, organisation detail, chat
handles, external ids, interests, skills, significant dates and Google's own relation
labels — because the alternative is a sync that reads a field it cannot write and deletes
it on the way back out.

Known limits, stated rather than discovered: only **one organisation** per contact is kept,
and Google's `clientData` is left untouched. Titles and suffixes are safe — Google keeps
*Mrs* and *The Best* in structured fields of their own and Hearth returns them there — but a
name that reached Google as one unsplit string from some other client comes back as a first
name, so "Dr. Liz Smith Jr." typed into a single box elsewhere loses its shape on the next
push. A contact created in Google's own interface is unaffected.

Two scripts answer all of this for **your** contacts before you commit to it:

- `scripts/e2e/google-import-check.mts` is **read-only** — it writes nothing, adopts nothing
  and needs no database. Per contact, it prints what the import would store and what a push
  would send back, flagging any field that would be cleared.
- `scripts/e2e/google-write-check.mts` does the push, to exactly **one** contact you name,
  and then re-reads it to report what Google actually kept. It saves the before payload
  first, and `--clear-id` takes its own marker back off afterwards.

## History and the trash

Every change to a contact is remembered. The **History** card lists each version newest
first, with who made it and which fields moved, and it is worked out from stored snapshots
rather than from a changelog — so wording a change better improves every entry already
recorded. A push to Google is not an edit and records nothing.

Events keep no history, deliberately: an event happened on a date and is then over, where
a contact is meant to persist and to change for years.

**Deleting moves a record to the trash, and nothing empties the trash but you.** No
retention window, no nightly prune, no thirty days. The **Trash** page offers *Restore* and
*Delete permanently* per record, and *Empty trash* for the lot at once in front of a count
of what it will destroy — thirty deleted contacts should not be thirty decisions. What
makes the page safe is that the decision is never made *for* you.

A trashed contact still leaves Google Contacts and a trashed event still leaves Google
Calendar, because deleted has to mean deleted on your phone. Restoring cancels that removal
if it has not gone out yet and pushes the record back if it has. Everything hanging off the
record — gifts, guest lists, shares, history — is kept, which is what makes restoring
honest. Somebody else's trash is not a place you can look, even for a record they had
shared with you.

## Appearance

**Settings → Appearance.** Light, dark, or follow the system, with a **separate accent
colour for each** — a scheme that reads well on white is often too pale on black. Seven
built-in schemes, or a hue of your own on a slider.

The choice is stored against your user and applied on the server, so there is no flash of
the wrong theme on the first paint, and it follows you to another browser.

## On a phone

Hearth is one responsive app rather than a desktop site with a mobile version: the two-column
card layouts collapse to one, the contact page reads top to bottom, and the bulk bar wraps to
as many rows as it needs. There is no separate mobile build and no app to install.

The people list keeps its table and scrolls **inside its own card** on a narrow screen, which
is deliberate — a table of contacts is still the fastest way to scan for one, and turning it
into cards would cost more than it buys. Nothing else scrolls sideways: §22 of the automated
suite measures four pages, a contact, and the bulk bar against a 390px viewport, so a
component that pushes the page wide fails the build rather than being noticed on a phone
later.

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
| What Google is told | [src/lib/google/serialize-person.ts](src/lib/google/serialize-person.ts) | Pure, and `MANAGED_PERSON_FIELDS` is the update mask. A field Hearth reads but omits here is **deleted from Google on the next push** — the reason "a column for every Google field" was a bug fix rather than a feature. |
| Planning an import | [src/lib/google/import-plan.ts](src/lib/google/import-plan.ts) | Pure: decides what each Google contact becomes before anything is written, so the preview and the write cannot disagree. |
| History | [src/lib/person-history.ts](src/lib/person-history.ts) · [person-versions.ts](src/lib/person-versions.ts) | Snapshot and diff are pure; the recorder reads the contact back after the write rather than trusting what the caller intended. |
| The trash | `deletedAt` + the clauses in [src/lib/access.ts](src/lib/access.ts) | Soft delete is a read-path problem. Reaching the bin needs `trashedPeopleWhere` / `trashedEventsWhere`, which are owner-only. |
| Theme | [src/lib/theme.ts](src/lib/theme.ts) | The oklch ramp is driven by one `--accent-hue`, and light/dark each have their own. |

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
| `npm run typecheck` | `tsc --noEmit`, over the app **and** the e2e suite |
| `npm run db:migrate` | Create a migration from schema changes |
| `npm run db:deploy` | Apply committed migrations |
| `npm run db:seed` | Seed built-in relationship types (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run docker:up` | Build and start via compose, stamping version + commit into the image |
| `npm run e2e` | Build, then drive a real browser through 532 checks against an embedded Postgres |
| `npm run e2e:google` | The Google-facing half, against throwaway accounts. **Destructive** — it refuses to run against an account that looks like a real address book |
| `npm run token` | Mint the refresh tokens `e2e:google` needs, into `.env.e2e` (gitignored) |

`GET /api/health` returns `{"status":"ok"}` and is what the container healthcheck
uses.

Pinned to Next 15 rather than 16; moving up is a version bump with no code changes
expected.

---

## Versioning

Hearth follows [Semantic Versioning](https://semver.org). From `1.0.0` onward: a
breaking change to the database, the environment or the Google contract is a
**major**, a feature is a **minor**, a fix is a **patch**.

Below `1.0.0` each milestone landed as a minor bump, cut only once it had been
confirmed against a real Google account rather than on a green test suite.

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
User ─┬─ UserSettings          sync toggles, target calendar, timezone, theme + accents
      ├─ Account               Google tokens (Auth.js)
      ├─ isHeadOfHousehold     owns the household cards; exactly one, by partial index
      ├─ contactCard ── Person the record representing this user
      ├─ Person ─┬─ ContactPoint         repeatable emails/phones/addresses/links,
      │          │                       with the parts of an address as columns
      │          ├─ custom JSONB         user-defined field values
      │          ├─ PersonLabel ── Label which labels are on this contact
      │          ├─ PersonPhoto          ONE ROW PER VIEWER — the owner's is the default
      │          ├─ PersonSync           ONE ROW PER GOOGLE ACCOUNT holding a copy
      │          ├─ PersonGoogleEvent    Google's own dated events (anniversaries)
      │          ├─ PersonGoogleRelation Google's own relation labels, as text
      │          ├─ PersonVersion        one snapshot per change, with who made it
      │          ├─ addToGoogle          the owner's decision that it belongs there
      │          └─ deletedAt            in the trash since; NOTHING prunes it
      ├─ Event ──┬─ EventAttendee        role + RSVP + per-person invite flag
      │          ├─ EventGiftRecipient   who the presents at this event are for
      │          ├─ custom JSONB
      │          ├─ google sync state
      │          └─ deletedAt            same trash, same guarantee
      ├─ Gift ── GiftRecipient   ONE ROW PER RECIPIENT, each with its own thanks
      ├─ Relationship ── RelationshipType   directional or symmetric
      ├─ Label ── LabelGroup      ONE ROW PER GOOGLE ACCOUNT holding the group
      ├─ FieldDefinition       describes one custom field
      ├─ FieldMapping          where a field lands in Google
      ├─ Share                 per-record or blanket, VIEW or EDIT
      └─ SyncTombstone         Google resources awaiting deletion
```

`PersonPhoto` is the one table keyed on the *viewer* rather than the owner, and the one
deliberate exception to "a shared record reads the same to everyone": the owner's photo
is the default, but a recipient may set their own. Everything else — labels, custom
fields, mappings — follows the owner, because those describe the record while a photo
serves the person looking at it.

The two "one row per Google account" tables are the shape sharing forces. A contact
shared with three people needs four copies in Google, each with its own resource id,
etag and retry state — so the resource id cannot live on `Person`. Labels are the
same story one level up: Google contact groups belong to an account, so one Hearth
label is N groups.

`Label` and `Person` must agree on their owner for a `PersonLabel` to be valid. That
spans two rows, so it is enforced in the action layer rather than by a constraint.

`GiftRecipient` carries the thanks rather than `Gift` doing so, because a present shared
between two children earns two notes. `PersonVersion` stores a whole snapshot per change
and derives the differences on reading, so there is no second representation of the truth
to keep in step.

`deletedAt` is the whole of the trash. It works as a single column only because every read
of a contact or an event goes through a clause in `src/lib/access.ts`, so one line in each
covers the lists, the search, the export, the pickers, the gifts and the sync push. There
is no job anywhere that deletes by age.

Deleting a user cascades to everything they own. The seeded relationship types
(`ownerId = null`) are shared and survive.

## Licence

Not yet chosen.

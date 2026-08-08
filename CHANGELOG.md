# Changelog

All notable changes to Hearth are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Hearth uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, each planned milestone lands as a **minor**
bump and may include breaking changes; patch releases are fixes only.

| Version | Milestone |
|---|---|
| `0.1.0` | M1 — data model, extensible fields, CRUD, Google sign-in |
| `0.2.0` | M2 — one-way contacts push to Google |
| `0.3.0` | M3 — calendar push, attendee invites, RSVP writeback |
| `0.4.0` | M4 — field↔Google mapping settings, record sharing |
| `1.0.0` | All four milestones shipped and stable |

## [Unreleased]

### Added

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

### Changed

- The default install root is now `/mnt/user/appdata/hearth`, the standard Unraid
  appdata location — what official templates use, what the Appdata Backup plugin
  covers, and what is reachable over SMB. Pointing `--install-root` at a pool
  directly (`/mnt/cache/appdata/hearth`) still works and bypasses the FUSE layer
  for database writes. The mount-point safety check is unaffected: Unraid mounts
  shfs at `/mnt/user`, so a real share and a real pool both pass, while a typo
  still fails.
- The installer now defaults to proxying via the **host IP** rather than creating
  a shared Docker network. Proxying to the published port works regardless of
  what networks exist and, unlike the shared-network mode, does not modify the
  reverse-proxy container at all — the least surprising thing to do to
  infrastructure someone already set up. `--proxy network` opts into the old
  behaviour, `--no-proxy` skips it entirely.

### Fixed

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

[Unreleased]: https://gitlab.com/hammerling/hearth/-/compare/v0.1.0...main
[0.1.0]: https://gitlab.com/hammerling/hearth/-/tags/v0.1.0

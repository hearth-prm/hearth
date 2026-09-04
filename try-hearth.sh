#!/bin/sh
# ===========================================================================
# try-hearth.sh — stand up a throwaway Hearth beside the real one
#
# For trying a build before releasing it, on a copy of your real data, without any
# possibility of touching the install you depend on.
#
#   sh try-hearth.sh --tag sha-e50319f3
#   sh try-hearth.sh --down
#
# What it does: dumps your production database, clones the repository at the commit
# matching the image you asked for, writes an .env of its own with a different port
# and a different data directory, restores the dump into a fresh Postgres, and starts
# the app so its migrations run against real rows.
#
# WHY A SCRIPT. Doing this by hand needs `-p` on every compose command, because
# docker-compose.yml pins `name: hearth` — so a second checkout is the SAME COMPOSE
# PROJECT as production, and one forgotten flag recreates your live containers with
# the test configuration. That has happened. Every compose call here carries the
# project name, and the guards below refuse to run at all if any of the paths, ports
# or names would collide with production.
#
# Assumes POSIX sh, docker and git. Nothing here shells out to node.
#
# Options
#   --tag <tag>        Image tag to run. Default edge (every commit to main).
#                      A sha- tag also decides which commit is checked out, so the
#                      compose file and the image cannot disagree.
#   --ref <git-ref>    Override the commit to check out. Default: derived from --tag.
#   --port <n>         Host port. Default 3081
#   --root <path>      Where the test install lives. Default /mnt/user/appdata/hearth-test
#   --from <path>      The production checkout to copy settings from.
#                      Default /mnt/user/appdata/hearth/app
#   --project <name>   Compose project name. Default hearth-test
#   --dump <file>      Restore this dump instead of taking a fresh one.
#   --empty            Start with no data at all. Fastest, but tests no migration.
#   --keep-data        Reuse the test database already there; skip dump and restore.
#   --yes              Do not ask before replacing an existing test install.
#   --status           Say what the test stack is doing, then exit.
#   --down             Stop it and delete its data, then exit.
#   -h, --help
# ===========================================================================
set -eu

TAG="edge"
REF=""
APP_PORT="3081"
ROOT="/mnt/user/appdata/hearth-test"
FROM="/mnt/user/appdata/hearth/app"
PROJECT="hearth-test"
DUMP=""
PROD_USER="hearth"
PROD_DB="hearth"
MODE="copy"     # copy | empty | keep
ASSUME_YES="no"
ACTION="up"     # up | status | down

say() { printf '[try-hearth] %s\n' "$*"; }
die() { printf '[try-hearth] %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
need_arg() { [ -n "$2" ] || die "$1 needs a value"; }

while [ $# -gt 0 ]; do
  case "$1" in
  --tag) need_arg "$1" "${2:-}" && TAG="$2" && shift 2 ;;
  --tag=*) TAG="${1#*=}" && shift ;;
  --ref) need_arg "$1" "${2:-}" && REF="$2" && shift 2 ;;
  --ref=*) REF="${1#*=}" && shift ;;
  --port) need_arg "$1" "${2:-}" && APP_PORT="$2" && shift 2 ;;
  --port=*) APP_PORT="${1#*=}" && shift ;;
  --root) need_arg "$1" "${2:-}" && ROOT="$2" && shift 2 ;;
  --root=*) ROOT="${1#*=}" && shift ;;
  --from) need_arg "$1" "${2:-}" && FROM="$2" && shift 2 ;;
  --from=*) FROM="${1#*=}" && shift ;;
  --project) need_arg "$1" "${2:-}" && PROJECT="$2" && shift 2 ;;
  --project=*) PROJECT="${1#*=}" && shift ;;
  --dump) need_arg "$1" "${2:-}" && DUMP="$2" && shift 2 ;;
  --dump=*) DUMP="${1#*=}" && shift ;;
  --empty) MODE="empty" && shift ;;
  --keep-data) MODE="keep" && shift ;;
  --yes | -y) ASSUME_YES="yes" && shift ;;
  --status) ACTION="status" && shift ;;
  --down | --destroy) ACTION="down" && shift ;;
  -h | --help) usage ;;
  *) die "unknown option: $1 (try --help)" ;;
  esac
done

APP_DIR="$ROOT/app"
PGDATA="$ROOT/postgres"
DUMPS="$ROOT/dumps"
dc() { docker compose -p "$PROJECT" -f "$APP_DIR/docker-compose.yml" --env-file "$APP_DIR/.env" "$@"; }

# --- guards ----------------------------------------------------------------
#
# Every one of these has a specific production accident behind it. They run before
# anything is created, and before --down deletes anything.

command -v docker >/dev/null 2>&1 || die "docker is not on PATH"
docker compose version >/dev/null 2>&1 || die "this docker has no 'compose' subcommand"

[ "$PROJECT" != "hearth" ] ||
  die "--project hearth IS the production project. That is the collision this script exists to avoid."

case "$ROOT" in
"$FROM" | "$FROM"/*) die "--root is inside the production checkout ($FROM). Pick somewhere else." ;;
esac

if [ -f "$FROM/.env" ]; then
  # Read only the keys that matter, never the whole file: it holds AUTH_SECRET, the
  # database password and the Google client secret.
  PROD_PORT=$(sed -n 's/^APP_PORT=\(.*\)/\1/p' "$FROM/.env" | tail -n 1)
  PROD_PGDATA=$(sed -n 's/^PGDATA_PATH=\(.*\)/\1/p' "$FROM/.env" | tail -n 1)
  PROD_USER=$(sed -n 's/^POSTGRES_USER=\(.*\)/\1/p' "$FROM/.env" | tail -n 1)
  PROD_DB=$(sed -n 's/^POSTGRES_DB=\(.*\)/\1/p' "$FROM/.env" | tail -n 1)
  [ "$APP_PORT" != "${PROD_PORT:-3000}" ] ||
    die "--port $APP_PORT is the production port. Pick another."
  if [ -n "${PROD_PGDATA:-}" ]; then
    case "$PGDATA" in
    "$PROD_PGDATA" | "$PROD_PGDATA"/*)
      die "the test database would land in the production data directory ($PROD_PGDATA)." ;;
    esac
  fi
fi

# --- status / down ---------------------------------------------------------

if [ "$ACTION" = "status" ]; then
  { [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/.env" ]; } ||
    die "no test install at $ROOT"
  dc ps
  say "app: http://localhost:$APP_PORT (through an SSH tunnel — see below)"
  sed -n 's/^HEARTH_TAG=\(.*\)/  image tag: \1/p' "$APP_DIR/.env"
  exit 0
fi

if [ "$ACTION" = "down" ]; then
  if [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/.env" ]; then
    say "stopping project '$PROJECT' and removing its volumes"
    # -v is safe here ONLY because -p names the test project: it removes that project's
    # volumes and nothing else, and the test data directory is its own bind mount.
    dc down -v || true
  fi
  if [ -d "$ROOT" ]; then
    if [ "$ASSUME_YES" != "yes" ]; then
      printf '[try-hearth] delete %s entirely? [y/N] ' "$ROOT"
      read -r reply
      case "$reply" in y | Y | yes) ;; *) die "left alone" ;; esac
    fi
    rm -rf "$ROOT"
    say "removed $ROOT"
  fi
  say "done. Production was never referenced."
  exit 0
fi

# --- which commit goes with which image ------------------------------------
#
# A sha- tag names its own commit, so the checkout follows it and the compose file
# cannot describe a different build than the one running. Anything else falls back to
# main, which is what :edge tracks.
if [ -z "$REF" ]; then
  case "$TAG" in
  sha-*) REF="${TAG#sha-}" ;;
  *) REF="main" ;;
  esac
fi

say "tag $TAG, checkout $REF, port $APP_PORT, project $PROJECT"

if [ -d "$ROOT" ] && [ "$MODE" != "keep" ] && [ "$ASSUME_YES" != "yes" ]; then
  printf '[try-hearth] %s exists. Replace the checkout and rebuild the database? [y/N] ' "$ROOT"
  read -r reply
  case "$reply" in y | Y | yes) ;; *) die "left alone — use --keep-data to reuse it" ;; esac
fi

# --- 1. the dump -----------------------------------------------------------

mkdir -p "$DUMPS"
if [ "$MODE" = "copy" ] && [ -z "$DUMP" ]; then
  [ -f "$FROM/docker-compose.yml" ] || die "no production install at $FROM (use --empty or --from)"
  DUMP="$DUMPS/production-$(date -u +%Y%m%d-%H%M%S).sql.gz"
  say "dumping production (it stays up throughout)"
  # Read-only against production, and the ONLY command here that touches it.
  ( cd "$FROM" && docker compose exec -T db \
      pg_dump -U "$PROD_USER" -d "$PROD_DB" --clean --if-exists ) 2>/dev/null | gzip >"$DUMP" ||
    die "the dump failed — is production running? (docker compose ps in $FROM)"
  [ -s "$DUMP" ] || die "the dump came out empty; refusing to restore nothing over nothing"
  say "dumped $(du -h "$DUMP" | cut -f1) to $DUMP"
elif [ -n "$DUMP" ]; then
  [ -f "$DUMP" ] || die "no such dump: $DUMP"
  say "using the dump you gave me: $DUMP"
fi

# --- 2. the checkout -------------------------------------------------------

command -v git >/dev/null 2>&1 || die "git is needed to fetch the code"
REPO_URL="https://gitlab.com/hearth-prm/hearth.git"
if [ -d "$APP_DIR/.git" ]; then
  say "updating the existing checkout"
  ( cd "$APP_DIR" && git fetch --quiet --tags origin && git checkout --quiet --force "$REF" &&
    git reset --hard --quiet "$REF" 2>/dev/null || git reset --hard --quiet "origin/$REF" )
else
  say "cloning $REPO_URL"
  mkdir -p "$ROOT"
  git clone --quiet "$REPO_URL" "$APP_DIR"
  ( cd "$APP_DIR" && git checkout --quiet --force "$REF" 2>/dev/null ||
    git checkout --quiet --force "origin/$REF" )
fi
say "checkout is $(cd "$APP_DIR" && git rev-parse --short=8 HEAD)"

grep -q 'HEARTH_TAG' "$APP_DIR/docker-compose.yml" ||
  die "that commit's docker-compose.yml cannot pull a published image — pick a newer --ref"

# --- 3. its own .env -------------------------------------------------------
#
# Copied from production so the Google credentials and the database password match
# the dump, then overridden where it must differ. Written with 600 because it carries
# the same secrets production does.

if [ -f "$FROM/.env" ]; then
  cp "$FROM/.env" "$APP_DIR/.env"
else
  [ -f "$APP_DIR/.env.example" ] && cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"

set_env() {
  key="$1"; value="$2"
  if grep -q "^$key=" "$APP_DIR/.env"; then
    # A literal replacement, so a value containing / or & cannot corrupt the file.
    awk -v k="$key" -v v="$value" -F= '
      $1 == k { print k "=" v; next } { print }
    ' "$APP_DIR/.env" >"$APP_DIR/.env.tmp" && mv "$APP_DIR/.env.tmp" "$APP_DIR/.env"
  else
    printf '%s=%s\n' "$key" "$value" >>"$APP_DIR/.env"
  fi
  chmod 600 "$APP_DIR/.env"
}

# Anything the copied .env could not supply — which is the --empty case with no production
# install to inherit from. Generated rather than left blank, because the compose file refuses
# to start without them and a placeholder that looks like a secret is worse than a real one.
if ! grep -q '^AUTH_SECRET=.\+' "$APP_DIR/.env" 2>/dev/null; then
  command -v openssl >/dev/null 2>&1 || die "no AUTH_SECRET to inherit and no openssl to make one"
  set_env AUTH_SECRET "$(openssl rand -base64 32)"
  say "generated an AUTH_SECRET for this stack"
fi
if ! grep -q '^POSTGRES_PASSWORD=.\+' "$APP_DIR/.env" 2>/dev/null; then
  NEWPW="$(openssl rand -hex 16)"
  set_env POSTGRES_PASSWORD "$NEWPW"
  set_env DATABASE_URL "postgresql://$PROD_USER:$NEWPW@db:5432/$PROD_DB"
  say "generated a database password for this stack"
fi
if ! grep -q '^AUTH_GOOGLE_ID=.\+' "$APP_DIR/.env" 2>/dev/null; then
  # Enough to boot and serve the sign-in page; signing in needs real credentials.
  set_env AUTH_GOOGLE_ID "not-configured.apps.googleusercontent.com"
  set_env AUTH_GOOGLE_SECRET "not-configured"
  say "no Google credentials to inherit — the app will start but sign-in will not work"
fi

set_env APP_PORT "$APP_PORT"
set_env PGDATA_PATH "$PGDATA"
set_env HEARTH_TAG "$TAG"
# localhost, because Google accepts an http redirect URI only for localhost — so an
# SSH tunnel is the only way to sign in to this without a certificate of its own.
set_env AUTH_URL "http://localhost:$APP_PORT"
# The background workers stay off: this stack shares production's Google grant, and a
# test install pushing contacts and events to the same account would be indistinguishable
# from production doing it.
set_env SYNC_ENABLED "false"
set_env OLLAMA_URL ""

mkdir -p "$PGDATA"

# --- 4. database first, then the data, then the app -----------------------
#
# In that order deliberately: the app runs `prisma migrate deploy` on boot, so the
# restore has to be in place before it starts or the migrations run against nothing
# and prove nothing.

say "starting Postgres"
dc up -d db
i=0
until dc exec -T db pg_isready -q 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || die "Postgres did not come up; try: docker compose -p $PROJECT logs db"
  sleep 2
done
say "Postgres is ready"

if [ "$MODE" = "copy" ] && [ -n "$DUMP" ]; then
  say "restoring $(basename "$DUMP")"
  gunzip -c "$DUMP" | dc exec -T db psql -q -U "$PROD_USER" -d "$PROD_DB" >/dev/null 2>&1 ||
    say "psql reported problems; --clean --if-exists says a lot of that on a fresh database. Checking…"
  COUNT=$(dc exec -T db psql -tAq -U "$PROD_USER" -d "$PROD_DB" \
    -c 'select count(*) from "Person"' 2>/dev/null || echo 0)
  [ "${COUNT:-0}" -gt 0 ] || die "the restore left no contacts; stopping before the migrations run"
  say "restored — $COUNT contacts"
fi

say "starting the app (its migrations run now)"
dc up -d
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost:$APP_PORT/signin" 2>/dev/null)" = "200" ]; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || die "the app did not answer; try: docker compose -p $PROJECT logs app"
  sleep 2
done

cat <<EOF

[try-hearth] up.

  image      $TAG
  commit     $(cd "$APP_DIR" && git rev-parse --short=8 HEAD)
  project    $PROJECT   (pass -p $PROJECT to every compose command here)
  data       $PGDATA
  dump       ${DUMP:-none}

To reach it, tunnel — Google only accepts an http redirect for localhost:

  ssh -L $APP_PORT:localhost:$APP_PORT $(whoami)@\$(hostname)

then add this to your OAuth client's authorised redirect URIs:

  http://localhost:$APP_PORT/api/auth/callback/google

and open http://localhost:$APP_PORT

Logs:      docker compose -p $PROJECT -f $APP_DIR/docker-compose.yml logs -f app
Tear down: sh $0 --down --root $ROOT --project $PROJECT

Google sync is OFF in this stack: it shares production's grant, and a test install
pushing to the same account would be indistinguishable from the real one doing it.
EOF

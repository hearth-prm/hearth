#!/bin/sh
# ===========================================================================
# try-hearth.sh — stand up a throwaway Hearth from THIS checkout
#
# The whole procedure:
#
#   mkdir -p /tmp/hearth-try && cd /tmp/hearth-try
#   git clone https://gitlab.com/hearth-prm/hearth.git .
#   sh try-hearth.sh                  # tests the image for this checkout's HEAD
#   ...try things out...
#   sh try-hearth.sh --down
#   cd / && rm -rf /tmp/hearth-try
#
# Nothing in production is modified — not its checkout, not its .env, not its
# containers. The only thing this reads from production is a database dump, and that
# is read-only while it stays running.
#
# The image tag defaults to sha-<this checkout's HEAD>, so cloning at a ref and running
# this tests exactly that commit: the compose file and the running image cannot
# describe different builds. --tag overrides it.
#
# WHY A SCRIPT. docker-compose.yml pins `name: hearth`, so a second checkout on one
# host is the SAME COMPOSE PROJECT as production — one forgotten `-p` recreates the
# live containers with the test configuration. That has happened here. Every compose
# command below carries the project name, the guards refuse to run if any path, port or
# name would collide with production, and the environment is written to .env.try rather
# than .env so an existing one is never overwritten.
#
# MIGRATIONS. The app image runs `prisma migrate deploy` on boot, so a build that needs
# a migration applies it to the test database by itself. This says which ones are
# pending BEFORE starting the app, names any marked destructive, and confirms afterwards
# that every one landed — because a migration that copies data is invisible to the test
# suite, whose database is always empty.
#
# Assumes POSIX sh and docker. Needs no git and no node.
#
# Options
#   --tag <tag>       Image to run. Default sha-<HEAD>. Use `edge` for the newest
#                     commit on main, or a version like 1.2.0.
#   --port <n>        Host port. Default 3081
#   --project <name>  Compose project. Default hearth-try
#   --from <path>     Production checkout to dump and copy settings from.
#                     Default /mnt/user/appdata/hearth/app
#                     Also takes ssh://user@host/path, to test on a DIFFERENT machine
#                     from the one production runs on — the dump and the settings are
#                     then fetched over ssh and everything else stays local.
#   --dump <file>     Restore this dump instead of taking a fresh one.
#   --empty           No data at all. Fast, but exercises no migration.
#   --keep-data       Reuse the test database already there.
#   --data <path>     Where the test Postgres keeps its data. Default ./.try/postgres
#   --yes             Do not ask before replacing an existing test database.
#   --status          Say what the test stack is doing, then exit.
#   --down            Stop it and delete its data, then exit.
#   -h, --help
# ===========================================================================
set -eu

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
TAG=""
APP_PORT="3081"
PROJECT="hearth-try"
FROM="/mnt/user/appdata/hearth/app"
DUMP=""
DATA=""
MODE="copy" # copy | empty | keep
ASSUME_YES="no"
ACTION="up"
PROD_USER="hearth"
PROD_DB="hearth"
REMOTE="" # set when --from is an ssh:// URL

say() { printf '[try-hearth] %s\n' "$*"; }
warn() { printf '[try-hearth] !! %s\n' "$*"; }
die() {
  printf '[try-hearth] %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}
need_arg() { [ -n "$2" ] || die "$1 needs a value"; }

while [ $# -gt 0 ]; do
  case "$1" in
  --tag) need_arg "$1" "${2:-}" && TAG="$2" && shift 2 ;;
  --tag=*) TAG="${1#*=}" && shift ;;
  --port) need_arg "$1" "${2:-}" && APP_PORT="$2" && shift 2 ;;
  --port=*) APP_PORT="${1#*=}" && shift ;;
  --project) need_arg "$1" "${2:-}" && PROJECT="$2" && shift 2 ;;
  --project=*) PROJECT="${1#*=}" && shift ;;
  --from) need_arg "$1" "${2:-}" && FROM="$2" && shift 2 ;;
  --from=*) FROM="${1#*=}" && shift ;;
  --dump) need_arg "$1" "${2:-}" && DUMP="$2" && shift 2 ;;
  --dump=*) DUMP="${1#*=}" && shift ;;
  --data) need_arg "$1" "${2:-}" && DATA="$2" && shift 2 ;;
  --data=*) DATA="${1#*=}" && shift ;;
  --empty) MODE="empty" && shift ;;
  --keep-data) MODE="keep" && shift ;;
  --yes | -y) ASSUME_YES="yes" && shift ;;
  --status) ACTION="status" && shift ;;
  --down | --destroy) ACTION="down" && shift ;;
  -h | --help) usage ;;
  *) die "unknown option: $1 (try --help)" ;;
  esac
done

# --- where production is, and how to reach it ------------------------------
#
# Local by default. An ssh:// URL means production lives on another machine — the dump
# and the settings come over ssh and everything else still happens here, which is the
# whole point of testing somewhere that is not the server.
case "$FROM" in
ssh://*)
  rest="${FROM#ssh://}"
  # A missing slash makes ${rest#*/} return the whole string, so "ssh://justahost" would
  # become host "justahost" and path "/justahost" and fail later with a confusing message
  # about a path nobody typed. Checked for a separator instead.
  case "$rest" in
  */?*) REMOTE="${rest%%/*}" && FROM="/${rest#*/}" ;;
  *) die "--from ssh://user@host/path needs a path after the host" ;;
  esac
  [ -n "$REMOTE" ] || die "--from ssh://user@host/path needs a host"
  ;;
esac

# Run a command where production is: here, or over ssh. Single call site for both, so
# the local and remote paths cannot drift apart.
prod_sh() {
  if [ -n "$REMOTE" ]; then
    ssh -o BatchMode=yes "$REMOTE" "$1"
  else
    sh -c "$1"
  fi
}

[ -n "$DATA" ] || DATA="$SELF_DIR/.try/postgres"
ENV_FILE="$SELF_DIR/.env.try"
COMPOSE="$SELF_DIR/docker-compose.yml"

# Every compose call goes through here, so -p and --env-file cannot be forgotten.
dc() { docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" "$@"; }
psql_t() { dc exec -T db psql -tAq -U "$PROD_USER" -d "$PROD_DB" "$@"; }

# --- guards ----------------------------------------------------------------
#
# Each one has a specific production accident behind it. They run before anything is
# created and before --down deletes anything.

command -v docker >/dev/null 2>&1 || die "docker is not on PATH"
docker compose version >/dev/null 2>&1 || die "this docker has no 'compose' subcommand"

[ "$PROJECT" != "hearth" ] ||
  die "--project hearth IS the production project. That collision is why this script exists."

{ [ -n "$REMOTE" ] || [ "$SELF_DIR" != "$FROM" ]; } ||
  die "this is the production checkout ($FROM). Clone somewhere else and run it from there."

# Production's environment, fetched once. It holds AUTH_SECRET, the database password
# and the Google client secret, so it is read into a variable and never echoed.
PROD_ENV=""
if [ -n "$REMOTE" ]; then
  command -v ssh >/dev/null 2>&1 || die "--from ssh:// needs ssh on PATH"
  PROD_ENV=$(prod_sh "cat '$FROM/.env'" 2>/dev/null || true)
  [ -n "$PROD_ENV" ] ||
    die "could not read $FROM/.env on $REMOTE — is the path right, and does your key work? (ssh $REMOTE true)"
elif [ -f "$FROM/.env" ]; then
  PROD_ENV=$(cat "$FROM/.env")
fi

if [ -n "$PROD_ENV" ]; then
  from_env() { printf '%s\n' "$PROD_ENV" | sed -n "s/^$1=\(.*\)/\1/p" | tail -n 1; }
  PROD_PORT=$(from_env APP_PORT)
  PROD_PGDATA=$(from_env PGDATA_PATH)
  PU=$(from_env POSTGRES_USER)
  PD=$(from_env POSTGRES_DB)
  [ -z "$PU" ] || PROD_USER="$PU"
  [ -z "$PD" ] || PROD_DB="$PD"
  # Collisions are only possible when the two share a machine. On a remote production
  # the local port and data directory cannot clash with anything of its, so insisting
  # would refuse a perfectly safe run.
  if [ -z "$REMOTE" ]; then
    [ "$APP_PORT" != "${PROD_PORT:-3000}" ] ||
      die "--port $APP_PORT is the production port. Pick another."
    if [ -n "${PROD_PGDATA:-}" ]; then
      case "$DATA" in
      "$PROD_PGDATA" | "$PROD_PGDATA"/*)
        die "the test database would land in production's data directory ($PROD_PGDATA)."
        ;;
      esac
    fi
  fi
fi

# --- status / down ---------------------------------------------------------

if [ "$ACTION" = "status" ]; then
  { [ -f "$COMPOSE" ] && [ -f "$ENV_FILE" ]; } || die "nothing set up here yet"
  dc ps
  sed -n 's/^HEARTH_TAG=\(.*\)/  image tag: \1/p' "$ENV_FILE"
  applied=$(psql_t -c 'select count(*) from _prisma_migrations where finished_at is not null' 2>/dev/null || echo "?")
  people=$(psql_t -c 'select count(*) from "Person"' 2>/dev/null || echo "?")
  say "migrations applied: $applied · contacts: $people"
  exit 0
fi

if [ "$ACTION" = "down" ]; then
  if [ -f "$COMPOSE" ] && [ -f "$ENV_FILE" ]; then
    say "stopping project '$PROJECT'"
    # -v is safe ONLY because -p names the test project: it removes that project's
    # volumes and nothing else.
    dc down -v || true
  else
    # The realistic mistake is deleting the directory first. The containers are still
    # labelled with the project, so they can be found without the compose file.
    say "no compose file here; removing anything labelled with project '$PROJECT'"
    ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" || true)
    [ -z "$ids" ] || docker rm -f $ids >/dev/null
  fi
  if [ -d "$(dirname "$DATA")" ] && [ "$DATA" = "$SELF_DIR/.try/postgres" ]; then
    rm -rf "$SELF_DIR/.try"
    say "removed $SELF_DIR/.try"
  else
    say "left $DATA alone — it is not the default location, so it may not be mine to delete"
  fi
  rm -f "$ENV_FILE"
  say "done. Production was never referenced."
  exit 0
fi

# --- which image ------------------------------------------------------------

[ -f "$COMPOSE" ] || die "no docker-compose.yml beside this script — is this a Hearth checkout?"
grep -q 'HEARTH_TAG' "$COMPOSE" ||
  die "this checkout's docker-compose.yml cannot pull a published image; it is too old"

if [ -z "$TAG" ]; then
  # From this checkout's HEAD, read without needing git: a clone has either a loose ref
  # or an entry in packed-refs. Same approach as scripts/docker-up.sh.
  head_sha=""
  if command -v git >/dev/null 2>&1 &&
    head_sha=$(cd "$SELF_DIR" && git rev-parse --short=8 HEAD 2>/dev/null); then
    :
  elif [ -f "$SELF_DIR/.git/HEAD" ]; then
    h=$(cat "$SELF_DIR/.git/HEAD")
    case "$h" in
    "ref: "*)
      r=${h#ref: }
      if [ -f "$SELF_DIR/.git/$r" ]; then
        head_sha=$(cut -c1-8 "$SELF_DIR/.git/$r")
      elif [ -f "$SELF_DIR/.git/packed-refs" ]; then
        head_sha=$(grep " $r\$" "$SELF_DIR/.git/packed-refs" | cut -c1-8)
      fi
      ;;
    *) head_sha=$(printf '%s' "$h" | cut -c1-8) ;;
    esac
  fi
  [ -n "$head_sha" ] ||
    die "could not read this checkout's commit; pass --tag edge or --tag <version>"
  TAG="sha-$head_sha"
fi

say "checkout $SELF_DIR"
say "image     $TAG   ·  port $APP_PORT  ·  project $PROJECT"

# --- the environment, in a file of its own ---------------------------------
#
# .env.try, never .env: an existing environment is never overwritten, so this cannot
# damage a checkout that is also being used for something else.

if [ -n "$PROD_ENV" ]; then
  printf '%s\n' "$PROD_ENV" >"$ENV_FILE"
  say "settings taken from production${REMOTE:+ on $REMOTE} (secrets included, so the dump will open)"
else
  [ -f "$SELF_DIR/.env.example" ] && cp "$SELF_DIR/.env.example" "$ENV_FILE"
  say "no production settings at $FROM — starting from .env.example"
fi
chmod 600 "$ENV_FILE"

set_env() {
  key="$1"
  value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    # awk with literal fields rather than sed: a generated password contains / & and $,
    # every one of which is meaningful in a sed replacement.
    awk -v k="$key" -v v="$value" -F= '$1 == k { print k "=" v; next } { print }' \
      "$ENV_FILE" >"$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

if ! grep -q '^AUTH_SECRET=.\+' "$ENV_FILE" 2>/dev/null; then
  command -v openssl >/dev/null 2>&1 || die "no AUTH_SECRET to inherit and no openssl to make one"
  set_env AUTH_SECRET "$(openssl rand -base64 32)"
fi
if ! grep -q '^POSTGRES_PASSWORD=.\+' "$ENV_FILE" 2>/dev/null; then
  NEWPW="$(openssl rand -hex 16)"
  set_env POSTGRES_PASSWORD "$NEWPW"
  set_env DATABASE_URL "postgresql://$PROD_USER:$NEWPW@db:5432/$PROD_DB"
fi
if ! grep -q '^AUTH_GOOGLE_ID=.\+' "$ENV_FILE" 2>/dev/null; then
  set_env AUTH_GOOGLE_ID "not-configured.apps.googleusercontent.com"
  set_env AUTH_GOOGLE_SECRET "not-configured"
  warn "no Google credentials to inherit — it will start, but sign-in will not work"
fi

set_env APP_PORT "$APP_PORT"
set_env PGDATA_PATH "$DATA"
set_env HEARTH_TAG "$TAG"
# localhost, because Google accepts an http redirect URI only for localhost — so a tunnel
# is the only way to sign in to this without a certificate of its own.
set_env AUTH_URL "http://localhost:$APP_PORT"
# Off deliberately: this stack inherits production's Google grant, and a test install
# pushing contacts and events to the same account would be indistinguishable from the
# real one doing it.
set_env SYNC_ENABLED "false"
set_env OLLAMA_URL ""

mkdir -p "$DATA"

# --- the dump ---------------------------------------------------------------

if [ "$MODE" = "copy" ] && [ -z "$DUMP" ]; then
  if [ -z "$REMOTE" ] && [ ! -f "$FROM/docker-compose.yml" ]; then
    die "no production install at $FROM (use --empty, --dump, or --from)"
  fi
  mkdir -p "$SELF_DIR/.try"
  DUMP="$SELF_DIR/.try/production.sql.gz"
  say "dumping production${REMOTE:+ over ssh from $REMOTE} — read-only, and it stays up throughout"
  # Gzipped on the far side when it is remote, so what crosses the network is compressed
  # and the local end only has to write bytes.
  if [ -n "$REMOTE" ]; then
    prod_sh "cd '$FROM' && docker compose exec -T db pg_dump -U '$PROD_USER' -d '$PROD_DB' --clean --if-exists | gzip" \
      >"$DUMP" 2>/dev/null ||
      die "the dump failed on $REMOTE — is production running there? (ssh $REMOTE 'cd $FROM && docker compose ps')"
  else
    (cd "$FROM" && docker compose exec -T db \
      pg_dump -U "$PROD_USER" -d "$PROD_DB" --clean --if-exists) 2>/dev/null | gzip >"$DUMP" ||
      die "the dump failed — is production running? (docker compose ps in $FROM)"
  fi
  [ -s "$DUMP" ] || die "the dump came out empty; refusing to restore nothing"
  say "dumped $(du -h "$DUMP" | cut -f1)"
elif [ -n "$DUMP" ]; then
  [ -f "$DUMP" ] || die "no such dump: $DUMP"
fi

if [ "$MODE" = "copy" ] && [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null || true)" ] &&
  [ "$ASSUME_YES" != "yes" ]; then
  printf '[try-hearth] %s already holds a database. Replace it? [y/N] ' "$DATA"
  read -r reply
  case "$reply" in y | Y | yes) rm -rf "${DATA:?}"/* && mkdir -p "$DATA" ;;
  *) die "left alone — use --keep-data to reuse it" ;; esac
fi

# --- database, then data, then the app -------------------------------------
#
# In that order deliberately: the app runs `prisma migrate deploy` on boot, so the
# restore has to be in place first or the migrations run against nothing and prove
# nothing.

say "starting Postgres"
dc up -d db
i=0
until dc exec -T db pg_isready -q 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || die "Postgres did not come up: docker compose -p $PROJECT logs db"
  sleep 2
done

if [ "$MODE" = "copy" ] && [ -n "$DUMP" ]; then
  say "restoring"
  gunzip -c "$DUMP" | dc exec -T db psql -q -U "$PROD_USER" -d "$PROD_DB" >/dev/null 2>&1 || true
  people=$(psql_t -c 'select count(*) from "Person"' 2>/dev/null || echo 0)
  [ "${people:-0}" -gt 0 ] || die "the restore left no contacts; stopping before migrations run"
  say "restored — $people contacts"
fi

# --- what this build will do to the schema --------------------------------
#
# Said BEFORE the app starts, because "does the new code need a migration" is the
# question that matters when testing a build, and a migration that copies data is
# invisible to the test suite — whose database is always empty, so its INSERT..SELECTs
# run against zero rows.

have=$(psql_t -c 'select migration_name from _prisma_migrations where finished_at is not null' 2>/dev/null || true)
PENDING=""
DESTRUCTIVE=""
for d in "$SELF_DIR"/prisma/migrations/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  if ! printf '%s\n' "$have" | grep -qx "$name"; then
    PENDING="$PENDING $name"
    if grep -q 'hearth:allow-destructive' "$d/migration.sql" 2>/dev/null; then
      DESTRUCTIVE="$DESTRUCTIVE $name"
    fi
  fi
done

if [ -z "${PENDING# }" ]; then
  say "schema is already current — this build adds no migrations"
else
  n=$(printf '%s' "$PENDING" | wc -w | tr -d ' ')
  say "this build will apply $n migration(s) to the TEST database:"
  for m in $PENDING; do printf '        %s\n' "$m"; done
  if [ -n "${DESTRUCTIVE# }" ]; then
    warn "one or more of those is marked DESTRUCTIVE — it drops or rewrites columns:"
    for m in $DESTRUCTIVE; do printf '        %s\n' "$m"; done
    warn "harmless here (this is a copy) but it is what production would do too."
  fi
fi

say "starting the app — migrations run now"
dc up -d
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost:$APP_PORT/signin" 2>/dev/null)" = "200" ]; do
  i=$((i + 1))
  [ "$i" -lt 90 ] || die "the app did not answer: docker compose -p $PROJECT -f $COMPOSE logs app"
  sleep 2
done

# --- and confirm they landed ------------------------------------------------

if [ -n "${PENDING# }" ]; then
  missing=""
  now=$(psql_t -c 'select migration_name from _prisma_migrations where finished_at is not null' 2>/dev/null || true)
  for m in $PENDING; do
    printf '%s\n' "$now" | grep -qx "$m" || missing="$missing $m"
  done
  if [ -n "${missing# }" ]; then
    warn "these did NOT apply:$missing"
    warn "look at: docker compose -p $PROJECT -f $COMPOSE logs app"
  else
    say "all $(printf '%s' "$PENDING" | wc -w | tr -d ' ') migration(s) applied"
  fi
fi
say "contacts after migrating: $(psql_t -c 'select count(*) from "Person"' 2>/dev/null || echo '?')"

cat <<EOF

[try-hearth] up.

  image     $TAG
  project   $PROJECT
  data      $DATA
  env       $ENV_FILE   (production's .env was not touched)

Reach it through a tunnel — Google accepts an http redirect only for localhost:

  ssh -L $APP_PORT:localhost:$APP_PORT root@\$(hostname)

add this to your OAuth client's authorised redirect URIs:

  http://localhost:$APP_PORT/api/auth/callback/google

then open http://localhost:$APP_PORT

  logs        docker compose -p $PROJECT -f $COMPOSE --env-file $ENV_FILE logs -f app
  status      sh $0 --status
  tear down   sh $0 --down        <- BEFORE deleting this directory

Google sync is off in this stack: it shares production's grant, and a test install
pushing to the same account would be indistinguishable from the real one doing it.
EOF

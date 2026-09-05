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
#                     then fetched over ssh and everything else stays local. Keys or a
#                     password both work; a password is asked for once per run.
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

# A run makes two trips to production — the settings, then the dump — and with password
# authentication that is two prompts, the second arriving in the middle of "dumping
# production" where it reads as a hang rather than a question. So one authenticated
# connection is opened up front and both trips share it, which is what ssh's own
# multiplexing is for. Keys still work and simply never prompt.
SSH_CTL=""
ssh_ctl_close() {
  [ -n "$SSH_CTL" ] || return 0
  ssh -o ControlPath="$SSH_CTL/s" -O exit "$REMOTE" >/dev/null 2>&1 || true
  rm -rf "$SSH_CTL"
  SSH_CTL=""
}
ssh_open() {
  # The socket is a logged-in session in the shape of a file: anyone who can open it is
  # on the server as you, with nothing to authenticate. Hence a private directory of its
  # own, 0700, and a trap rather than trusting the end of the script to be reached.
  SSH_CTL=$(mktemp -d "${TMPDIR:-/tmp}/hearth-ssh.XXXXXX") ||
    die "could not make a directory for the ssh socket"
  chmod 700 "$SSH_CTL"
  trap 'ssh_ctl_close' EXIT
  trap 'ssh_ctl_close; exit 130' INT TERM
  say "connecting to $REMOTE — if it asks for a password, that is once for the whole run"
  ssh -o ControlMaster=yes -o ControlPath="$SSH_CTL/s" -N -f "$REMOTE" ||
    die "could not connect to $REMOTE — check the host, your user, and the password or key"
}

# Run a command where production is: here, or over ssh. Single call site for both, so
# the local and remote paths cannot drift apart.
prod_sh() {
  if [ -n "$REMOTE" ]; then
    ssh -o ControlPath="${SSH_CTL:-/nonexistent}/s" "$REMOTE" "$1"
  else
    sh -c "$1"
  fi
}

[ -n "$DATA" ] || DATA="$SELF_DIR/.try/postgres"
ENV_FILE="$SELF_DIR/.env.try"
COMPOSE="$SELF_DIR/docker-compose.yml"

# Postgres writes its data directory as its own uid — 70 in the alpine image — with mode
# 700, so the person who started the stack cannot delete it afterwards and plain rm stops
# at "Permission denied" partway through, having already taken the dump with it. Docker
# created those files as root and Docker can remove them: same bind mount, one throwaway
# container, no sudo.
#
# The image comes out of the compose file rather than being written down again here, so it
# is always one that has just been used and is therefore already pulled.
remove_pgdata() {
  _t="$1"
  [ -e "$_t" ] || return 0
  rm -rf "$_t" 2>/dev/null
  [ -e "$_t" ] || return 0
  _img=$(sed -n 's/^[[:space:]]*image:[[:space:]]*"\{0,1\}\(postgres:[^"[:space:]]*\).*/\1/p' \
    "$COMPOSE" 2>/dev/null | head -n 1)
  docker run --rm -v "$(dirname "$_t"):/target" "${_img:-postgres:16-alpine}" \
    rm -rf "/target/$(basename "$_t")" >/dev/null 2>&1 || true
  [ ! -e "$_t" ]
}

# Every compose call goes through here, so -p and --env-file cannot be forgotten.
dc() { docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" "$@"; }
psql_t() { dc exec -T db psql -tAq -U "$PROD_USER" -d "$PROD_DB" "$@"; }

# --- guards ----------------------------------------------------------------
#
# Each one has a specific production accident behind it. They run before anything is
# created and before --down deletes anything.

# Not inlined: scripts/docker-up.sh needs the same answer, and a version check that
# disagrees with itself between two entry points is worse than one that lives in a file.
[ -f "$SELF_DIR/scripts/require-compose-v2.sh" ] ||
  die "no scripts/require-compose-v2.sh beside this script — is this a Hearth checkout?"
. "$SELF_DIR/scripts/require-compose-v2.sh"
require_compose_v2

[ "$PROJECT" != "hearth" ] ||
  die "--project hearth IS the production project. That collision is why this script exists."

{ [ -n "$REMOTE" ] || [ "$SELF_DIR" != "$FROM" ]; } ||
  die "this is the production checkout ($FROM). Clone somewhere else and run it from there."

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
# Only a real run has an image to speak of. Printing this under --down read as though the
# teardown cared which build it was tearing down, which it does not.
[ "$ACTION" != "up" ] ||
  say "image     $TAG   ·  port $APP_PORT  ·  project $PROJECT"

# Asked HERE, before the ssh password and the dump, because it is the one thing in this
# script that can fail instantly and the only one that did: a commit pushed minutes ago
# has no image yet — CI takes about three minutes per commit — and finding that out cost
# a password prompt, 1.5MB over the network, a Postgres container and a restore of 329
# contacts before compose said "not found".
#
# Default repository read from the compose file rather than repeated here, so overriding
# HEARTH_IMAGE cannot make the check and the run disagree about what they are talking
# about.
if [ "$ACTION" = "up" ]; then
  default_image=$(sed -n 's/.*\${HEARTH_IMAGE:-\([^}]*\)}.*/\1/p' "$COMPOSE" | head -n 1)
  IMAGE_REF="${HEARTH_IMAGE:-${default_image:-registry.gitlab.com/hearth-prm/hearth}}:$TAG"
  if ! docker manifest inspect "$IMAGE_REF" >/dev/null 2>&1; then
    # A registry that cannot be reached is not the same as a tag that does not exist, and
    # a copy already pulled makes both moot.
    if docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
      say "registry unreachable — using the copy of $TAG already on this machine"
    else
      die "no image $IMAGE_REF, and no local copy.

  CI builds one image per commit and takes a few minutes, so a commit pushed just now
  has not landed yet. Either wait and run this again, or pick a tag that exists:

    --tag edge              the newest build of main
    --tag sha-<commit>      a specific earlier commit
    --tag 1.2.0             a release

  Browse them at https://gitlab.com/hearth-prm/hearth/container_registry"
    fi
  fi
fi

# Production's environment, fetched once. It holds AUTH_SECRET, the database password
# and the Google client secret, so it is read into a variable and never echoed.
#
# Only a real run needs it: --status questions the TEST database and --down works from
# the local compose file. Reaching for production there would be a password prompt to
# tear down a stack that is entirely here.
PROD_ENV=""
if [ "$ACTION" != "up" ]; then
  [ ! -f "$ENV_FILE" ] || PROD_ENV=$(cat "$ENV_FILE")
elif [ -n "$REMOTE" ]; then
  command -v ssh >/dev/null 2>&1 || die "--from ssh:// needs ssh on PATH"
  ssh_open
  PROD_ENV=$(prod_sh "cat '$FROM/.env'" 2>/dev/null || true)
  [ -n "$PROD_ENV" ] ||
    die "connected to $REMOTE but could not read $FROM/.env — is that the right path? (ssh $REMOTE 'ls $FROM/.env')"
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
  # Collisions are only possible when the two share a machine, and only matter when a
  # stack is about to be created. On a remote production nothing local can clash with
  # it, and under --status these values describe the test stack itself.
  if [ -z "$REMOTE" ] && [ "$ACTION" = "up" ]; then
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
  # Secrets first, and before anything that can fail. This file is production's AUTH_SECRET,
  # database password and Google client secret; it used to be removed AFTER the data
  # directory, so the first time that rm hit a root-owned file `set -e` ended the run with
  # the secrets still on disk. What must go does not queue behind what might not.
  if [ -f "$ENV_FILE" ]; then
    rm -f "$ENV_FILE"
    say "removed $ENV_FILE — production's secrets are no longer on this machine"
  fi

  if [ "$DATA" = "$SELF_DIR/.try/postgres" ]; then
    if remove_pgdata "$DATA" && rm -rf "$SELF_DIR/.try" 2>/dev/null; then
      say "removed $SELF_DIR/.try"
    else
      # Never left as a silent partial: it holds a full copy of the contact database.
      warn "could not remove $SELF_DIR/.try — it still holds a copy of your data. Remove it with:
        sudo rm -rf '$SELF_DIR/.try'"
    fi
  else
    say "left $DATA alone — it is not the default location, so it may not be mine to delete"
  fi
  say "done. Production was never referenced."
  exit 0
fi

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
#
# SYNC_ENABLED stops the background loop and nothing else — pressing "Sync now" still
# pushes, because an install that syncs only on the button is a workflow somebody wants.
# So the writes are refused at the source as well, which also covers the thank-you mail
# the loop was never involved in. Belt and braces, and the braces are the load-bearing
# half: the test database is a copy of production's, so it holds every thank-you not yet
# sent, and sending one from here mails a real person while production goes on believing
# it still owes them a note.
set_env SYNC_ENABLED "false"
set_env HEARTH_GOOGLE_WRITES "off"
set_env HEARTH_ENABLE_MAIL ""
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
      die "the dump failed on $REMOTE — is production running there? (ssh $REMOTE \"cd $FROM && docker compose ps\")"
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
# --wait, rather than a readiness loop of this script's own. The compose healthcheck already
# asks the right question — `pg_isready -U <user> -d <db>`, with a comment beside it saying
# why the bare form is wrong — and this had written a second, weaker one three lines away:
#
#   until dc exec -T db pg_isready -q; do ...
#
# Without -U/-d that reports on a different database, and on first boot there is a window
# where it says ready while `hearth` does not exist: the entrypoint runs a temporary server
# on the socket to do initdb before the real one starts. Measured on a fresh data directory,
# the bare form said READY two polls before a connection to hearth could be made — and the
# restore then ran against a database that was not there.
dc up -d --wait --wait-timeout 300 db ||
  die "Postgres did not come up: docker compose -p $PROJECT logs db"

if [ "$MODE" = "copy" ] && [ -n "$DUMP" ]; then
  say "restoring"
  # Kept, not discarded. The failure above was diagnosed as "no contacts" because psql's
  # output went to /dev/null, so the one message naming the cause was the one thing thrown
  # away. A step whose failure is noticed later has to leave its evidence behind.
  mkdir -p "$SELF_DIR/.try"
  restore_log="$SELF_DIR/.try/restore.log"
  gunzip -c "$DUMP" | dc exec -T db psql -q -U "$PROD_USER" -d "$PROD_DB" \
    >"$restore_log" 2>&1 || true
  people=$(psql_t -c 'select count(*) from "Person"' 2>/dev/null || echo 0)
  if [ "${people:-0}" -le 0 ]; then
    warn "the restore produced no contacts. The last of what psql said:"
    tail -n 15 "$restore_log" >&2
    die "stopping before migrations run — an empty database would prove nothing.
  Full output: $restore_log"
  fi
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

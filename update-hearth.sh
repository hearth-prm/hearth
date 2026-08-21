#!/bin/sh
# ===========================================================================
# update-hearth.sh — pull changes, rebuild, restart
#
#   sh update-hearth.sh
#
# Takes a database backup before doing anything else. That is not belt-and-
# braces: the container applies Prisma migrations on boot, and migrations only
# ever run forwards. Rolling the image back to an older commit does NOT roll the
# schema back, so the dump taken here is the only thing that can undo a bad
# migration.
#
# Options
#   --no-pull        Rebuild from the working tree as-is. Use after editing .env
#                    or making local changes.
#   --no-backup      Skip the pre-update dump. Not advised.
#   --branch <name>  Switch to this branch before rebuilding.
#   --prune          Reclaim docker.img space afterwards: dangling images AND the
#                    BuildKit cache, which is the one that actually fills up.
#   --keep <n>       Backups to retain. Default 10
#   -h, --help       This message
# ===========================================================================
set -eu

DO_PULL=yes
DO_BACKUP=yes
DO_PRUNE=no
BRANCH=""
KEEP=10

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok() { printf '    \033[1;32mok\033[0m   %s\n' "$*"; }
note() { printf '    \033[1;33m--\033[0m   %s\n' "$*"; }
die() {
  printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '3,/^# ===/p' "$0" | sed 's/^# \{0,1\}//;$d'
  exit "${1:-0}"
}

need_arg() { [ -n "${2:-}" ] || die "$1 requires a value"; }

while [ $# -gt 0 ]; do
  case "$1" in
  --no-pull) DO_PULL=no && shift ;;
  --no-backup) DO_BACKUP=no && shift ;;
  --prune) DO_PRUNE=yes && shift ;;
  --branch) need_arg "$1" "${2:-}" && BRANCH="$2" && shift 2 ;;
  --branch=*) BRANCH="${1#*=}" && shift ;;
  --keep) need_arg "$1" "${2:-}" && KEEP="$2" && shift 2 ;;
  --keep=*) KEEP="${1#*=}" && shift ;;
  -h | --help) usage 0 ;;
  *) die "unknown option: $1  (try --help)" ;;
  esac
done

# --- locate the install ---------------------------------------------------
APP_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
[ -f "$APP_DIR/docker-compose.yml" ] ||
  die "$APP_DIR does not look like a Hearth checkout (no docker-compose.yml). Run this from inside the install directory."
cd "$APP_DIR"
[ -f .env ] || die "no .env in $APP_DIR. Run deploy-hearth.sh first."

command -v docker >/dev/null 2>&1 || die "docker not found."
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon."
if [ "$DO_PULL" = yes ] && [ -d .git ]; then
  command -v git >/dev/null 2>&1 ||
    die "git not found. Install it, or re-run with --no-pull to rebuild the working tree as-is."
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "docker compose not found."
fi

# Read a key out of .env without sourcing it — values can contain characters
# that a shell would happily interpret.
env_get() { sed -n "s/^$1=//p" .env | head -n 1; }

APP_PORT=$(env_get APP_PORT)
[ -n "$APP_PORT" ] || APP_PORT=3000
BACKUP_DIR=$(dirname "$APP_DIR")/backups
mkdir -p "$BACKUP_DIR"

say "Hearth at $APP_DIR"

# --- record what is running now -------------------------------------------
BEFORE=$(curl -fsS "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)
if [ -n "$BEFORE" ]; then
  ok "currently running: $BEFORE"
else
  note "app is not responding right now; continuing"
fi

# --- backup ---------------------------------------------------------------
if [ "$DO_BACKUP" = yes ]; then
  say "Backing up the database"
  if $COMPOSE ps --status running db 2>/dev/null | grep -q db; then
    STAMP=$(date -u +%Y%m%d-%H%M%S)
    DEST="$BACKUP_DIR/hearth-$STAMP.sql.gz"
    PGUSER=$(env_get POSTGRES_USER)
    [ -n "$PGUSER" ] || PGUSER=hearth
    PGDB=$(env_get POSTGRES_DB)
    [ -n "$PGDB" ] || PGDB=hearth

    # A pipeline's exit status is the LAST command's, so `pg_dump | gzip` reports
    # gzip's success even when pg_dump died. POSIX sh has no PIPESTATUS, so stash
    # pg_dump's real status in a file — writing it inside the group keeps it out
    # of the pipe.
    #
    # -T because there is no TTY here; without it the dump gets mangled.
    STATUS_FILE="$DEST.status"
    {
      $COMPOSE exec -T db pg_dump -U "$PGUSER" "$PGDB" 2>/dev/null
      echo "$?" >"$STATUS_FILE"
    } | gzip >"$DEST"
    DUMP_RC=$(cat "$STATUS_FILE" 2>/dev/null || echo 1)
    rm -f "$STATUS_FILE"

    if [ "$DUMP_RC" != 0 ]; then
      rm -f "$DEST"
      die "pg_dump failed (exit $DUMP_RC). Is the db container healthy? Check: $COMPOSE logs db
      Re-run with --no-backup to skip, but understand that a bad migration would then be unrecoverable."
    fi

    # Second line of defence: a dump cut short by a full disk can still leave a
    # perfectly valid gzip file, so confirm the marker pg_dump writes on success.
    if gzip -dc "$DEST" 2>/dev/null | tail -5 | grep -q 'PostgreSQL database dump complete'; then
      ok "$DEST ($(du -h "$DEST" | cut -f1))"
    else
      rm -f "$DEST"
      die "backup completed but looks truncated, so it was discarded. Out of disk space on $BACKUP_DIR?"
    fi

    # Retention, newest first.
    COUNT=$(ls -1t "$BACKUP_DIR"/hearth-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
    if [ "$COUNT" -gt "$KEEP" ]; then
      ls -1t "$BACKUP_DIR"/hearth-*.sql.gz | tail -n +$((KEEP + 1)) | while read -r old; do
        rm -f "$old"
      done
      ok "pruned to the newest $KEEP backups"
    fi
  else
    note "db container is not running; nothing to back up"
  fi
else
  note "skipping backup (--no-backup)"
fi

# --- pull -----------------------------------------------------------------
OLD_SHA=""
NEW_SHA=""
if [ "$DO_PULL" = yes ]; then
  say "Fetching changes"
  if [ ! -d .git ]; then
    note "not a git checkout; nothing to pull"
  else
    OLD_SHA=$(git rev-parse --short=7 HEAD)

    if [ -n "$BRANCH" ]; then
      git fetch origin "$BRANCH" || die "fetch failed"
      git checkout -B "$BRANCH" "origin/$BRANCH" || die "checkout failed"
      ok "switched to $BRANCH"
    else
      git pull --ff-only ||
        die "pull failed. If you have local edits, commit or discard them, or use --no-pull."
    fi

    NEW_SHA=$(git rev-parse --short=7 HEAD)

    if [ "$OLD_SHA" = "$NEW_SHA" ]; then
      note "already at $NEW_SHA — no new commits, rebuilding anyway"
    else
      ok "$OLD_SHA -> $NEW_SHA"
      git log --oneline --no-decorate "$OLD_SHA..$NEW_SHA" | sed 's/^/         /'
    fi
  fi
else
  note "skipping pull (--no-pull)"
fi

# --- room to build in -----------------------------------------------------
#
# Docker on Unraid lives inside a fixed-size docker.img, and building a Node app
# fills it with BuildKit cache: every npm ci layer from every build ever run is
# still in there. Running out shows up as an ENOSPC three minutes into a build,
# buried under a page of BuildKit output — so it is worth saying beforehand, with
# the commands that fix it, rather than after.
#
# Skipped silently where /var/lib/docker is not a mount point of its own, since
# then the number would be the host filesystem's and mean nothing.
say "Checking there is room to build"
DOCKER_DIR=/var/lib/docker
if [ -d "$DOCKER_DIR" ] && command -v df >/dev/null 2>&1; then
  FREE_MB=$(df -Pm "$DOCKER_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
  case "$FREE_MB" in
  '' | *[!0-9]*) note "could not read free space for $DOCKER_DIR; carrying on" ;;
  *)
    if [ "$FREE_MB" -lt 2048 ]; then
      printf '\033[1;31mERROR\033[0m only %sMB free in %s — a build needs a few GB.\n' \
        "$FREE_MB" "$DOCKER_DIR" >&2
      printf '      Reclaim it:\n' >&2
      printf '        docker builder prune -af   # build cache, usually the bulk of it\n' >&2
      printf '        docker image prune -f      # dangling images\n' >&2
      printf '      Or grow docker.img: Unraid Settings -> Docker (stop the service first),\n' >&2
      printf '      or switch Docker from a vDisk to a directory so it uses the pool.\n' >&2
      printf '      Nothing has been changed; the running container is untouched.\n' >&2
      exit 1
    fi
    if [ "$FREE_MB" -lt 5120 ]; then
      note "$FREE_MB MB free in $DOCKER_DIR — tight. Consider --prune after this."
    else
      ok "$FREE_MB MB free in $DOCKER_DIR"
    fi
    ;;
  esac
else
  note "no $DOCKER_DIR to measure; skipping the space check"
fi

# --- rebuild --------------------------------------------------------------
say "Rebuilding and restarting"
note "migrations apply automatically as the container starts"
sh scripts/docker-up.sh || die "build or start failed: cd $APP_DIR && $COMPOSE logs --tail 50 app"

# --- wait for health ------------------------------------------------------
say "Waiting for the app to come back"
AFTER=""
i=0
while [ "$i" -lt 150 ]; do
  AFTER=$(curl -fsS "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)
  case "$AFTER" in
  *'"status":"ok"'*) break ;;
  esac
  AFTER=""
  i=$((i + 1))
  [ $((i % 15)) -eq 0 ] && note "still waiting ($((i * 2))s)…"
  sleep 2
done

if [ -z "$AFTER" ]; then
  printf '\033[1;31mERROR\033[0m app did not come back within 300s.\n' >&2
  printf '      cd %s && %s logs --tail 50 app\n' "$APP_DIR" "$COMPOSE" >&2
  if [ "$DO_BACKUP" = yes ] && [ -n "${DEST:-}" ]; then
    printf '      A pre-update backup is at %s\n' "$DEST" >&2
  fi
  exit 1
fi

# --- prune ----------------------------------------------------------------
if [ "$DO_PRUNE" = yes ]; then
  say "Reclaiming space"
  # Both stores, because they fill up separately and only one of them was being
  # cleared. The build cache is the larger by far after a few rebuilds — which is
  # how a disk with a hundred spare gigabytes on the array still ran out mid-build.
  docker image prune -f >/dev/null
  ok "dangling images"
  docker builder prune -f >/dev/null 2>&1 || note "build cache: nothing to prune"
  ok "build cache"
  if [ -d /var/lib/docker ] && command -v df >/dev/null 2>&1; then
    AFTER_MB=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
    [ -n "$AFTER_MB" ] && ok "$AFTER_MB MB free in /var/lib/docker"
  fi
fi

# --- summary --------------------------------------------------------------
printf '\n\033[1;32mUpdate complete.\033[0m\n'
[ -n "$BEFORE" ] && printf '  before: %s\n' "$BEFORE"
printf '  after:  %s\n' "$AFTER"
[ -n "${DEST:-}" ] && printf '  backup: %s\n' "$DEST"
printf '\n'

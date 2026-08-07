#!/bin/sh
# ---------------------------------------------------------------------------
# Build and start Hearth with build identity baked in.
#
# `docker compose up --build` on its own works fine, but produces an image that
# cannot say which commit it came from — .dockerignore excludes .git, so the
# build has no repository to ask. This passes the answers in.
#
# Deliberately assumes nothing beyond POSIX sh and docker. Appliance hosts
# (Unraid, Synology, TrueNAS) generally have neither node nor git installed, and
# this script has to work there — that is where it matters most.
# ---------------------------------------------------------------------------
set -eu

cd "$(dirname "$0")/.."

# --- version: from package.json, without needing node ----------------------
read_version() {
  if command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('./package.json').version)" && return 0
  fi
  # Top-level "version" key. Anchored to a two-space indent so it cannot match a
  # nested "version" inside dependencies.
  sed -n 's/^  "version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json |
    head -n 1
}

# --- commit: from git if present, else read .git directly ------------------
read_sha() {
  if command -v git >/dev/null 2>&1 &&
    sha=$(git rev-parse --short=7 HEAD 2>/dev/null); then
    printf '%s' "$sha"
    return 0
  fi

  # No git binary — parse the repository by hand. A clone has either a loose ref
  # file or an entry in packed-refs.
  [ -f .git/HEAD ] || return 1
  head=$(cat .git/HEAD)
  case "$head" in
  "ref: "*)
    ref=${head#ref: }
    if [ -f ".git/$ref" ]; then
      cut -c1-7 ".git/$ref"
    elif [ -f .git/packed-refs ]; then
      grep " $ref\$" .git/packed-refs | cut -c1-7
    else
      return 1
    fi
    ;;
  *) printf '%s' "$head" | cut -c1-7 ;;
  esac
}

# --- dirty check: only meaningful when git is available -------------------
is_dirty() {
  command -v git >/dev/null 2>&1 || return 1
  ! git diff-index --quiet HEAD -- 2>/dev/null
}

APP_VERSION=$(read_version)
if [ -z "$APP_VERSION" ]; then
  echo "[hearth] could not read the version from package.json" >&2
  exit 1
fi

GIT_SHA=$(read_sha 2>/dev/null || echo unknown)
[ -n "$GIT_SHA" ] || GIT_SHA=unknown

# A build from uncommitted work is not reproducible from the SHA alone, so say so
# rather than letting the image claim to be that commit.
if is_dirty; then
  GIT_SHA="${GIT_SHA}-dirty"
fi

BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export APP_VERSION GIT_SHA BUILD_TIME

echo "[hearth] building v${APP_VERSION} (${GIT_SHA}) at ${BUILD_TIME}"
exec docker compose up -d --build "$@"

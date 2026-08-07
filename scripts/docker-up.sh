#!/bin/sh
# ---------------------------------------------------------------------------
# Build and start Hearth with build identity baked in.
#
# `docker compose up --build` on its own works fine, but produces an image that
# cannot say which commit it came from — .dockerignore excludes .git, so the
# build has no repository to ask. This passes the answers in.
# ---------------------------------------------------------------------------
set -eu

cd "$(dirname "$0")/.."

APP_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")

if GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null); then
  # A build from uncommitted work is not reproducible from the SHA alone, so say
  # so rather than letting the image claim to be that commit.
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    GIT_SHA="${GIT_SHA}-dirty"
  fi
else
  GIT_SHA=unknown
fi

BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

export APP_VERSION GIT_SHA BUILD_TIME

echo "[hearth] building v${APP_VERSION} (${GIT_SHA}) at ${BUILD_TIME}"
exec docker compose up -d --build "$@"

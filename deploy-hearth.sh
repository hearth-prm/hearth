#!/bin/sh
# ===========================================================================
# deploy-hearth.sh — first-time installation of Hearth
#
# Tuned for Unraid but works on any Docker host. Assumes only POSIX sh, docker,
# openssl and curl: appliance hosts generally have neither git nor node, so the
# repository is cloned through a container and nothing here shells out to node.
#
#   sh deploy-hearth.sh --domain hearth.example.com
#
# Safe to re-run. It never overwrites an existing .env — the generated database
# password is baked into the running Postgres volume, so regenerating it would
# lock the app out of its own data. Use update-hearth.sh to deploy changes.
#
# Options
#   --domain <host>     Public hostname, e.g. hearth.example.com. Without it a
#                       placeholder is written and sign-in will not work until
#                       you set AUTH_URL yourself.
#   --install-root <p>  Where to install. Default /mnt/user/appdata/hearth
#   --port <n>          Host port to publish. Default 3000
#   --branch <name>     Branch to deploy. Default main
#   --proxy-network <n> Docker network shared with the reverse proxy.
#                       Default proxynet
#   --swag-container <n> Name of the SWAG container. Default swag
#   --proxy <mode>      How the reverse proxy reaches Hearth:
#                         host    - proxy_pass to <host-ip>:PORT. Default when
#                                   SWAG is found. Changes nothing about your
#                                   SWAG container or its networks.
#                         network - share a Docker network and proxy_pass to
#                                   hearth-app:3000, so no port need be exposed
#                                   on the LAN. Connects SWAG to that network.
#                         none    - do not touch the proxy at all.
#   --no-proxy          Same as --proxy none
#   --proxy-conf-dir <p>  Directory to write the nginx config into. Default is
#                         <swag>/nginx/proxy-confs, discovered from the container.
#                         Use e.g. /mnt/user/appdata/swag/nginx/site-confs for a
#                         site-confs style config.
#   --proxy-conf-name <f> Exact filename to write. Default <subdomain>.subdomain.conf
#   --host-ip <addr>      Address the proxy should connect to, overriding
#                         auto-detection (useful on a multi-homed server).
#   --force-path        Allow an install root that is not on a mounted pool
#   --repo <url>        Source repository
#   -h, --help          This message
# ===========================================================================
set -eu

REPO_URL="https://gitlab.com/hammerling/hearth.git"
BRANCH="main"
INSTALL_ROOT="/mnt/user/appdata/hearth"
DOMAIN=""
APP_PORT="3000"
PROXY_NETWORK="proxynet"
SWAG_CONTAINER="swag"
PROXY_MODE="auto" # auto|host|network|none
PROXY_CONF_DIR=""
PROXY_CONF_NAME=""
HOST_IP_OVERRIDE=""
FORCE_PATH="no"
GIT_IMAGE="alpine/git:latest"

# --- output ---------------------------------------------------------------
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

# --- arguments ------------------------------------------------------------
need_arg() { [ -n "${2:-}" ] || die "$1 requires a value"; }

while [ $# -gt 0 ]; do
  case "$1" in
  --domain) need_arg "$1" "${2:-}" && DOMAIN="$2" && shift 2 ;;
  --domain=*) DOMAIN="${1#*=}" && shift ;;
  --install-root) need_arg "$1" "${2:-}" && INSTALL_ROOT="$2" && shift 2 ;;
  --install-root=*) INSTALL_ROOT="${1#*=}" && shift ;;
  --port) need_arg "$1" "${2:-}" && APP_PORT="$2" && shift 2 ;;
  --port=*) APP_PORT="${1#*=}" && shift ;;
  --branch) need_arg "$1" "${2:-}" && BRANCH="$2" && shift 2 ;;
  --branch=*) BRANCH="${1#*=}" && shift ;;
  --proxy-network) need_arg "$1" "${2:-}" && PROXY_NETWORK="$2" && shift 2 ;;
  --proxy-network=*) PROXY_NETWORK="${1#*=}" && shift ;;
  --swag-container) need_arg "$1" "${2:-}" && SWAG_CONTAINER="$2" && shift 2 ;;
  --swag-container=*) SWAG_CONTAINER="${1#*=}" && shift ;;
  --repo) need_arg "$1" "${2:-}" && REPO_URL="$2" && shift 2 ;;
  --repo=*) REPO_URL="${1#*=}" && shift ;;
  --proxy) need_arg "$1" "${2:-}" && PROXY_MODE="$2" && shift 2 ;;
  --proxy=*) PROXY_MODE="${1#*=}" && shift ;;
  --no-proxy) PROXY_MODE="none" && shift ;;
  --proxy-conf-dir) need_arg "$1" "${2:-}" && PROXY_CONF_DIR="$2" && shift 2 ;;
  --proxy-conf-dir=*) PROXY_CONF_DIR="${1#*=}" && shift ;;
  --proxy-conf-name) need_arg "$1" "${2:-}" && PROXY_CONF_NAME="$2" && shift 2 ;;
  --proxy-conf-name=*) PROXY_CONF_NAME="${1#*=}" && shift ;;
  --host-ip) need_arg "$1" "${2:-}" && HOST_IP_OVERRIDE="$2" && shift 2 ;;
  --host-ip=*) HOST_IP_OVERRIDE="${1#*=}" && shift ;;
  --force-path) FORCE_PATH="yes" && shift ;;
  -h | --help) usage 0 ;;
  *) die "unknown option: $1  (try --help)" ;;
  esac
done

case "$PROXY_MODE" in
auto | host | network | none) ;;
*) die "--proxy must be one of: host, network, none" ;;
esac

APP_DIR="$INSTALL_ROOT/app"
PGDATA_DIR="$INSTALL_ROOT/postgres"
BACKUP_DIR="$INSTALL_ROOT/backups"

# --- preflight ------------------------------------------------------------
say "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker not found."
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon. Is it running, and are you root?"
ok "docker"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "docker compose not found. On Unraid, install the 'Docker Compose Manager' plugin from Community Applications."
fi
ok "$COMPOSE"

command -v openssl >/dev/null 2>&1 || die "openssl not found — needed to generate secrets."
command -v curl >/dev/null 2>&1 || die "curl not found — needed to verify the app started."
ok "openssl, curl"

# Verify the storage root is really mounted, not just that the path resolves.
#
# This guards a genuinely nasty Unraid failure mode: `mkdir -p /mnt/typo/appdata`
# SUCCEEDS — the root filesystem is a RAM disk, so a mistyped share or pool name
# produces a directory that works perfectly until the next reboot, then takes the
# database with it. Both /mnt/user (the FUSE share layer) and /mnt/<pool> appear
# in /proc/mounts on a healthy system, so requiring a real mount point catches the
# typo without caring which of the two you chose.
case "$INSTALL_ROOT" in
/mnt/*)
  POOL_ROOT="/mnt/$(printf '%s' "${INSTALL_ROOT#/mnt/}" | cut -d/ -f1)"
  if [ ! -d "$POOL_ROOT" ]; then
    printf '\033[1;31mERROR\033[0m %s does not exist.\n' "$POOL_ROOT" >&2
    printf '      Available under /mnt:\n' >&2
    ls -1 /mnt 2>/dev/null | sed 's/^/        /' >&2
    printf '      Re-run with --install-root <path>, e.g. /mnt/user/appdata/hearth\n' >&2
    exit 1
  fi
  if [ "$FORCE_PATH" != yes ] && [ -r /proc/mounts ] &&
    ! awk -v p="$POOL_ROOT" '$2==p{found=1} END{exit !found}' /proc/mounts; then
    printf '\033[1;31mERROR\033[0m %s exists but is not a mount point.\n' "$POOL_ROOT" >&2
    printf "      On Unraid that means it is on the RAM-backed root filesystem,\n" >&2
    printf "      and everything written there is lost on reboot.\n" >&2
    printf '      Currently mounted under /mnt:\n' >&2
    awk '$2 ~ /^\/mnt\// {print "        " $2}' /proc/mounts 2>/dev/null >&2
    printf '      Pass --force-path if you really mean this location.\n' >&2
    exit 1
  fi
  ok "$POOL_ROOT is mounted"
  ;;
*)
  mkdir -p "$INSTALL_ROOT" 2>/dev/null || die "cannot create $INSTALL_ROOT"
  ok "install root writable ($INSTALL_ROOT)"
  ;;
esac

# --- reverse proxy detection ---------------------------------------------
#
# Default to "host" when SWAG is present. Proxying to the published host port
# works regardless of what networks exist, and — unlike the shared-network mode —
# it does not modify the SWAG container at all. Least surprising thing to do to
# infrastructure someone else already set up.
SWAG_CONFIG=""
HOST_IP=""

# Naming a config location is an unambiguous request for proxy setup, so let it
# resolve "auto" even when the SWAG container cannot be inspected.
if [ "$PROXY_MODE" = auto ] && [ -n "$PROXY_CONF_DIR" ]; then
  PROXY_MODE=host
fi

if [ "$PROXY_MODE" != "none" ]; then
  if docker inspect "$SWAG_CONTAINER" >/dev/null 2>&1; then
    # Ask the container where its /config lives rather than assuming
    # /mnt/user/appdata/swag — people relocate it.
    SWAG_CONFIG=$(docker inspect "$SWAG_CONTAINER" \
      --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)
    if [ -n "$SWAG_CONFIG" ] && [ -d "$SWAG_CONFIG/nginx/proxy-confs" ]; then
      [ "$PROXY_MODE" = auto ] && PROXY_MODE=host
      ok "found SWAG (config at $SWAG_CONFIG)"
    else
      SWAG_CONFIG=""
      note "container '$SWAG_CONTAINER' found but its /config/nginx/proxy-confs is not visible"
      [ "$PROXY_MODE" = auto ] && PROXY_MODE=none
    fi
  else
    note "no container named '$SWAG_CONTAINER'"
    [ "$PROXY_MODE" = auto ] && PROXY_MODE=none
  fi
fi

if [ "$PROXY_MODE" = host ]; then
  # The address SWAG will proxy to. "ip route get" reports the source address the
  # kernel would actually use, which beats guessing from the interface list on a
  # host with bridges, VLANs and docker0 all present.
  if [ -n "$HOST_IP_OVERRIDE" ]; then
    HOST_IP="$HOST_IP_OVERRIDE"
  else
    HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -n 1)
    [ -n "$HOST_IP" ] || HOST_IP=$(hostname -i 2>/dev/null | awk '{print $1}')
  fi
  if [ -n "$HOST_IP" ]; then
    ok "host address for the proxy upstream: $HOST_IP:$APP_PORT"
  else
    note "could not determine this host's LAN IP; you will need to fill it in yourself"
  fi
fi
ok "proxy mode: $PROXY_MODE"

# --- directories ----------------------------------------------------------
say "Creating $INSTALL_ROOT"
mkdir -p "$PGDATA_DIR" "$BACKUP_DIR"
ok "$PGDATA_DIR"
ok "$BACKUP_DIR"

# --- source ---------------------------------------------------------------
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

if [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/prisma/schema.prisma" ]; then
  say "Source already present at $APP_DIR"
  note "leaving it untouched — use update-hearth.sh to pull changes"
elif [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -f "$SCRIPT_DIR/prisma/schema.prisma" ]; then
  # Running from inside a checkout: use it in place rather than cloning a second
  # copy, which would leave two trees that silently drift apart.
  say "Running from inside a checkout"
  APP_DIR="$SCRIPT_DIR"
  ok "using $APP_DIR"
else
  say "Cloning $REPO_URL ($BRANCH)"
  note "git is not installed on Unraid, so this runs in a container"
  docker run --rm -v "$INSTALL_ROOT:/work" "$GIT_IMAGE" \
    clone --branch "$BRANCH" --depth 1 "$REPO_URL" /work/app ||
    die "clone failed. Check the URL, the branch name, and that $INSTALL_ROOT is writable."
  [ -f "$APP_DIR/docker-compose.yml" ] || die "clone appeared to succeed but $APP_DIR/docker-compose.yml is missing"
  ok "cloned to $APP_DIR"
fi

cd "$APP_DIR"

# --- .env -----------------------------------------------------------------
if [ -f .env ]; then
  say "Keeping existing .env"
  note "not regenerating — the database password in it is baked into $PGDATA_DIR"
else
  say "Generating .env"

  # Hex, not base64: this value gets embedded in the DATABASE_URL, and the
  # '/' and '+' from base64 are not safe in a URI's userinfo section.
  DB_PASSWORD=$(openssl rand -hex 24)
  # Not embedded in a URL, so base64 is fine (and is what Auth.js documents).
  AUTH_SECRET=$(openssl rand -base64 32)

  if [ -n "$DOMAIN" ]; then
    AUTH_URL="https://$DOMAIN"
  else
    AUTH_URL="https://hearth.example.com"
  fi

  case "$PROXY_MODE" in
  network)
    PROXY_BLOCK=$(
      cat <<EOF
# Join the reverse proxy's Docker network so it can reach this app by name as
# hearth-app:3000.
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
PROXY_NETWORK=$PROXY_NETWORK
# Publish on loopback only: the proxy reaches the container over the Docker
# network, so nothing needs to listen on the LAN.
APP_BIND=127.0.0.1
EOF
    )
    ;;
  host)
    PROXY_BLOCK=$(
      cat <<EOF
# The reverse proxy connects to the published port on this host, so the port must
# stay reachable from it. Do NOT set APP_BIND=127.0.0.1 in this mode — that would
# bind to loopback only and the proxy would get connection refused.
#APP_BIND=127.0.0.1
#COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
EOF
    )
    ;;
  *)
    PROXY_BLOCK="# No reverse proxy configured; the app listens on all interfaces.
#COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
#PROXY_NETWORK=$PROXY_NETWORK
#APP_BIND=127.0.0.1"
    ;;
  esac

  umask 077
  cat >.env <<EOF
# ---------------------------------------------------------------------------
# Hearth configuration — generated by deploy-hearth.sh
#
# Secrets below were randomly generated. Do not change POSTGRES_PASSWORD after
# the first start: it is baked into the Postgres data directory, and changing
# only this file locks the app out of its own database.
# ---------------------------------------------------------------------------

# --- Database -------------------------------------------------------------
POSTGRES_USER=hearth
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=hearth
DATABASE_URL=postgresql://hearth:$DB_PASSWORD@db:5432/hearth?schema=public

# Bind-mount the data directory instead of using a Docker named volume, which
# on Unraid lives on the fixed-size docker.img that a Docker reset erases.
PGDATA_PATH=$PGDATA_DIR

# --- Auth.js --------------------------------------------------------------
AUTH_SECRET=$AUTH_SECRET

# Must exactly match the origin you browse to, and the redirect URI you
# register with Google.
AUTH_URL=$AUTH_URL
# Required behind a reverse proxy: without it Auth.js ignores X-Forwarded-Proto,
# assumes plain http, and builds a callback URL Google will reject.
AUTH_TRUST_HOST=true

# --- Google OAuth ---------------------------------------------------------
# TODO: fill these in from Google Cloud Console -> APIs & Services ->
# Credentials -> OAuth 2.0 Client ID (type: Web application).
# Authorised redirect URI: $AUTH_URL/api/auth/callback/google
AUTH_GOOGLE_ID=REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID
AUTH_GOOGLE_SECRET=REPLACE_WITH_YOUR_GOOGLE_CLIENT_SECRET

# --- App ------------------------------------------------------------------
APP_PORT=$APP_PORT

# --- Reverse proxy --------------------------------------------------------
$PROXY_BLOCK
EOF
  umask 022
  chmod 600 .env
  ok "wrote .env (mode 600) with generated secrets"
  [ -n "$DOMAIN" ] || note "no --domain given, so AUTH_URL is a placeholder"
fi

# --- reverse proxy wiring -------------------------------------------------
CONF_DST=""
if [ "$PROXY_MODE" != none ]; then
  # Destination directory: an explicit --proxy-conf-dir wins, otherwise derive it
  # from the container's own /config mount.
  if [ -n "$PROXY_CONF_DIR" ]; then
    CONF_DIR="$PROXY_CONF_DIR"
  elif [ -n "$SWAG_CONFIG" ]; then
    CONF_DIR="$SWAG_CONFIG/nginx/proxy-confs"
  else
    CONF_DIR=""
  fi

  if [ -n "$CONF_DIR" ]; then
    say "Configuring the reverse proxy ($PROXY_MODE mode)"

    [ -d "$CONF_DIR" ] || die "proxy config directory does not exist: $CONF_DIR"

    SUBDOMAIN="hearth"
    [ -n "$DOMAIN" ] && SUBDOMAIN="${DOMAIN%%.*}"

    if [ -n "$PROXY_CONF_NAME" ]; then
      CONF_FILE="$PROXY_CONF_NAME"
    else
      CONF_FILE="$SUBDOMAIN.subdomain.conf"
    fi
    CONF_DST="$CONF_DIR/$CONF_FILE"

    # nginx only includes files matching the glob defined for each directory. A
    # non-matching name is written successfully, never loaded, and produces a 404
    # or a fall-through to the default site with nothing in any log to explain it —
    # so warn rather than let that be discovered the hard way.
    case "$CONF_DIR" in
    */proxy-confs)
      case "$CONF_FILE" in
      *.subdomain.conf | *.subfolder.conf) ;;
      *) note "WARNING: SWAG includes only *.subdomain.conf and *.subfolder.conf from proxy-confs/, so '$CONF_FILE' will be written but never loaded" ;;
      esac
      ;;
    */site-confs)
      case "$CONF_FILE" in
      *.conf) ;;
      *) note "WARNING: SWAG includes only *.conf from site-confs/, so '$CONF_FILE' will be written but never loaded" ;;
      esac
      ;;
    esac

    if [ "$PROXY_MODE" = network ]; then
      if docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1; then
        ok "network '$PROXY_NETWORK' exists"
      else
        docker network create "$PROXY_NETWORK" >/dev/null
        ok "created network '$PROXY_NETWORK'"
      fi

      if docker inspect "$SWAG_CONTAINER" \
        --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null |
        tr ' ' '\n' | grep -qx "$PROXY_NETWORK"; then
        ok "$SWAG_CONTAINER already on '$PROXY_NETWORK'"
      else
        docker network connect "$PROXY_NETWORK" "$SWAG_CONTAINER"
        ok "connected $SWAG_CONTAINER to '$PROXY_NETWORK'"
      fi
      CONF_SRC="$APP_DIR/deploy/swag/hearth.subdomain.conf"
    else
      CONF_SRC="$APP_DIR/deploy/swag/hearth-hostip.subdomain.conf"
    fi

    # An explicit FQDN when we know it, rather than SWAG's "hearth.*" wildcard:
    # unambiguous, and it matches how most hand-written configs are written.
    if [ -n "$DOMAIN" ]; then
      SERVER_NAME="$DOMAIN"
    else
      SERVER_NAME="$SUBDOMAIN.*"
    fi

    if [ ! -f "$CONF_SRC" ]; then
      note "$CONF_SRC missing; skipping proxy config"
      CONF_DST=""
    elif [ -f "$CONF_DST" ]; then
      # Never clobber a hand-written config. Anyone already running SWAG has
      # configs they care about, and silently replacing one would be hostile.
      note "$CONF_DST already exists; leaving your version alone"
      if [ "$PROXY_MODE" = host ] && [ -n "$HOST_IP" ]; then
        note "check that it proxies to http://$HOST_IP:$APP_PORT"
      fi
      CONF_DST=""
    else
      if [ "$PROXY_MODE" = host ]; then
        # Only host mode rewrites the port. In network mode the proxy talks to the
        # container directly, and the container always listens on 3000 whatever
        # port is published on the host — rewriting it there would break the
        # upstream.
        sed -e "s|^\( *server_name *\)hearth\.\*;|\1$SERVER_NAME;|" \
          -e "s|UNRAID_HOST_IP|${HOST_IP:-UNRAID_HOST_IP}|g" \
          -e "s|\(proxy_pass http://[^:]*\):3000;|\1:$APP_PORT;|" \
          "$CONF_SRC" >"$CONF_DST"
      else
        sed -e "s|^\( *server_name *\)hearth\.\*;|\1$SERVER_NAME;|" \
          "$CONF_SRC" >"$CONF_DST"
      fi
      ok "installed $CONF_DST"
      if [ "$PROXY_MODE" = host ] && [ -z "$HOST_IP" ]; then
        note "edit it and replace UNRAID_HOST_IP before restarting SWAG"
      fi

      # Validate before restarting. A syntax error, an unsupported directive or a
      # duplicate server_name would stop nginx from starting — which would take
      # down every other site this proxy serves, not just Hearth. Roll back rather
      # than let that happen.
      if docker inspect -f '{{.State.Running}}' "$SWAG_CONTAINER" 2>/dev/null | grep -q true; then
        if NGINX_OUT=$(docker exec "$SWAG_CONTAINER" nginx -t 2>&1); then
          ok "nginx accepted the new config"
          docker restart "$SWAG_CONTAINER" >/dev/null
          ok "restarted $SWAG_CONTAINER"
        else
          rm -f "$CONF_DST"
          printf '\033[1;31mERROR\033[0m nginx rejected the generated config, so it was removed again.\n' >&2
          printf '      %s was NOT restarted and your other sites are unaffected.\n' "$SWAG_CONTAINER" >&2
          printf '%s\n' "$NGINX_OUT" | sed 's/^/      /' >&2
          exit 1
        fi
      else
        note "$SWAG_CONTAINER is not running; skipped validation and restart"
      fi
    fi
  fi
fi

# --- build and start ------------------------------------------------------
say "Building and starting (first build takes a few minutes)"
sh scripts/docker-up.sh || die "build or start failed. Inspect with: cd $APP_DIR && $COMPOSE logs"

# --- wait for health ------------------------------------------------------
say "Waiting for the app to come up"
HEALTH=""
i=0
while [ "$i" -lt 90 ]; do
  HEALTH=$(curl -fsS "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)
  case "$HEALTH" in
  *'"status":"ok"'*) break ;;
  esac
  HEALTH=""
  i=$((i + 1))
  sleep 2
done

if [ -z "$HEALTH" ]; then
  printf '\033[1;31mERROR\033[0m app did not report healthy within 180s.\n' >&2
  printf '      cd %s && %s logs --tail 50 app\n' "$APP_DIR" "$COMPOSE" >&2
  exit 1
fi
ok "$HEALTH"

# --- summary --------------------------------------------------------------
GOOGLE_UNSET=""
grep -q '^AUTH_GOOGLE_ID=REPLACE_WITH' .env 2>/dev/null && GOOGLE_UNSET=yes
CONFIGURED_URL=$(sed -n 's/^AUTH_URL=//p' .env | head -n 1)

printf '\n\033[1;32mHearth is running.\033[0m  %s\n\n' "$APP_DIR"

if [ -n "$GOOGLE_UNSET" ] || [ -z "$DOMAIN" ]; then
  printf '\033[1;33mBefore you can sign in:\033[0m\n\n'
  n=1
  if [ -z "$DOMAIN" ]; then
    printf '  %s. Set AUTH_URL in .env to your real https hostname.\n' "$n"
    n=$((n + 1))
  fi
  if [ -n "$GOOGLE_UNSET" ]; then
    cat <<EOF
  $n. Create a Google OAuth client:
       console.cloud.google.com -> APIs & Services
       - Library: enable "People API" and "Google Calendar API"
       - OAuth consent screen: External, add yourself under Test users, and add
         the scopes openid, userinfo.email, userinfo.profile, auth/contacts,
         auth/calendar.events, auth/calendar.readonly
       - Credentials -> OAuth client ID -> Web application
         Authorised redirect URI:
           $CONFIGURED_URL/api/auth/callback/google
     Then put the client id and secret in .env.
EOF
    n=$((n + 1))
  fi
  printf '  %s. Apply the changes:  cd %s && sh update-hearth.sh --no-pull\n\n' "$n" "$APP_DIR"
fi

cat <<EOF
Useful commands (from $APP_DIR):
  $COMPOSE logs -f app        follow the app log
  $COMPOSE ps                 container status
  curl -s localhost:$APP_PORT/api/health
  sh update-hearth.sh         pull, rebuild and restart

Config: $APP_DIR/.env       Database: $PGDATA_DIR       Backups: $BACKUP_DIR
EOF

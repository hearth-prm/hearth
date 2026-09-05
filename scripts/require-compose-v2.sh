# ---------------------------------------------------------------------------
# Refuse to start against Docker Compose v1.  Sourced, not run.
#
# The check that was here before asked whether `docker compose` answered at all, which
# is not the question. podman's docker shim answers it cheerfully by handing the call to
# whatever `docker-compose` it finds on PATH — on a Mint or Ubuntu box that is usually
# the Python v1.29.2 from the distro repos. It then fails on Hearth's compose file with
#
#   'name' does not match any of the regexes: '^x-'
#   You might be seeing this error because you're using the wrong Compose file version.
#
# which names neither the cause nor the fix, and sends people off to add a `version:`
# key that would not help. v1 predates the Compose Specification's top-level `name:`,
# and reached end of life in July 2023.
#
# Asking for the version number is the whole fix: `docker compose version --short`
# prints 1.29.2 on v1 and 2.x on v2, and exits 0 on both.
# ---------------------------------------------------------------------------

require_compose_v2() {
  command -v docker >/dev/null 2>&1 || {
    printf '%s\n' "[hearth] docker is not on PATH" >&2
    exit 1
  }

  _cv=$(docker compose version --short 2>/dev/null | tr -d '[:space:]')
  _cv="${_cv#v}"
  case "${_cv%%.*}" in
  [2-9] | [1-9][0-9]*) return 0 ;;
  esac

  # Worth naming: somebody who typed `apt install podman-docker` believes they installed
  # Docker, and every error they are about to read says "docker".
  _shim=""
  if docker --version 2>/dev/null | grep -qi podman; then
    _shim="
  This 'docker' is podman's compatibility shim. It passes compose calls to the
  docker-compose on your PATH, which here is v1 — so installing a current Docker
  Compose is what fixes it, whether or not you keep podman."
  fi

  printf '%s\n' "[hearth] Docker Compose ${_cv:-v1 (or older than --short)} cannot read this compose file.

  Hearth's docker-compose.yml uses the Compose Specification, whose top-level 'name:'
  key needs Compose v2 or newer. Compose v1 reports it as \"'name' does not match any of the
  regexes\" and suggests adding a version: key, which does not help.${_shim}

  On Debian/Ubuntu/Mint, Docker's own repository carries it:

    sudo apt install docker-compose-plugin

  or install Docker Engine from https://docs.docker.com/engine/install/ , which
  includes it. Then 'docker compose version' should say v2 or later." >&2
  exit 1
}

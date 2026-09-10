#!/bin/sh
set -eu

RUNTIME_DIR="${RUNTIME_DIR:-/run/valheim}"
LOG_PREFIX="[valheim-health]"

HEALTHCHECK_PORT="${HEALTHCHECK_PORT:-2456}"
HEALTHCHECK_REQUIRE_BIND="${HEALTHCHECK_REQUIRE_BIND:-true}"
VALHEIM_START_PARAMS="${VALHEIM_START_PARAMS:-}"

. /app/common.sh

if ! is_valheim_server_running; then
  die "Valheim server process is not running."
fi

if is_truthy "${HEALTHCHECK_REQUIRE_BIND}"; then
  if has_valheim_crossplay; then
    PROBED_PORT=$((HEALTHCHECK_PORT + 1))
    PROBED_LABEL="Steam query port"
  else
    PROBED_PORT="${HEALTHCHECK_PORT}"
    PROBED_LABEL="game port"
  fi

  if ! ss -H -u -l -n "sport = :${PROBED_PORT}" 2>/dev/null | grep -q .; then
    die "Valheim ${PROBED_LABEL} ${PROBED_PORT}/udp is not bound yet."
  fi
fi

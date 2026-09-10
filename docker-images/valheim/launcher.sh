#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
VALHEIM_INSTALL_DIR="${VALHEIM_INSTALL_DIR:-${DATA_DIR}/server}"
VALHEIM_SAVE_DIR="${VALHEIM_SAVE_DIR:-${DATA_DIR}/save}"
VALHEIM_SERVER_BIN="${VALHEIM_SERVER_BIN:-${VALHEIM_INSTALL_DIR}/valheim_server.x86_64}"
RUNTIME_DIR="${RUNTIME_DIR:-/run/valheim}"

VALHEIM_SERVER_NAME="${VALHEIM_SERVER_NAME:-Valheim server}"
VALHEIM_WORLD_NAME="${VALHEIM_WORLD_NAME:-Dedicated}"
VALHEIM_SERVER_PASSWORD="${VALHEIM_SERVER_PASSWORD:-}"
VALHEIM_PORT="${VALHEIM_PORT:-2456}"
VALHEIM_PUBLIC="${VALHEIM_PUBLIC:-1}"
VALHEIM_START_PARAMS="${VALHEIM_START_PARAMS:-}"

VALHEIM_CLIENT_STEAM_APP_ID="${VALHEIM_CLIENT_STEAM_APP_ID:-892970}"

STOP_TIMEOUT_SECONDS="${STOP_TIMEOUT_SECONDS:-60}"
LOG_PREFIX="[valheim]"

. /app/common.sh

PID_FILE="$(valheim_pid_file_path)"
STOP_REQUESTED="false"

mkdir -p "${RUNTIME_DIR}"

cleanup() {
  rm -f "${PID_FILE}"
}
trap cleanup EXIT

graceful_stop() {
  if [ "${STOP_REQUESTED}" = "true" ]; then
    return 0
  fi

  STOP_REQUESTED="true"
  log "Shutdown requested, stopping Valheim..."

  if is_valheim_server_running; then
    RUNNING_PID="$(read_valheim_pid)"
    kill -INT "-${RUNNING_PID}" 2>/dev/null || kill -INT "${RUNNING_PID}" 2>/dev/null || true

    DEADLINE=$(( $(date +%s) + STOP_TIMEOUT_SECONDS ))
    while kill -0 "${RUNNING_PID}" 2>/dev/null; do
      if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
        log "Valheim did not stop in time, killing process..."
        kill -KILL "-${RUNNING_PID}" 2>/dev/null || kill -KILL "${RUNNING_PID}" 2>/dev/null || true
        break
      fi

      sleep 1
    done
  fi
}

trap graceful_stop TERM INT

if [ ! -x "${VALHEIM_SERVER_BIN}" ]; then
  die "Valheim server binary is not executable: ${VALHEIM_SERVER_BIN}"
fi

if [ ! -d "${VALHEIM_INSTALL_DIR}" ]; then
  die "Valheim install directory not found: ${VALHEIM_INSTALL_DIR}"
fi

if ! command -v setsid >/dev/null 2>&1; then
  die "setsid is required to supervise the Valheim server process group."
fi

mkdir -p "${VALHEIM_SAVE_DIR}"

cd "${VALHEIM_INSTALL_DIR}"

export SteamAppId="${VALHEIM_CLIENT_STEAM_APP_ID}"
export LD_LIBRARY_PATH="./linux64:${LD_LIBRARY_PATH:-}"

if [ -f "${VALHEIM_INSTALL_DIR}/BepInEx/core/BepInEx.Preloader.dll" ] && [ -d "${VALHEIM_INSTALL_DIR}/doorstop_libs" ]; then
  log "BepInEx detected; enabling the Doorstop mod loader."
  export DOORSTOP_ENABLED="1"
  export DOORSTOP_TARGET_ASSEMBLY="${VALHEIM_INSTALL_DIR}/BepInEx/core/BepInEx.Preloader.dll"
  export LD_LIBRARY_PATH="${VALHEIM_INSTALL_DIR}/doorstop_libs:${LD_LIBRARY_PATH}"
  export LD_PRELOAD="libdoorstop_x64.so${LD_PRELOAD:+:${LD_PRELOAD}}"
fi

set -- "${VALHEIM_SERVER_BIN}" \
  -nographics \
  -batchmode \
  -name "${VALHEIM_SERVER_NAME}" \
  -port "${VALHEIM_PORT}" \
  -world "${VALHEIM_WORLD_NAME}" \
  -savedir "${VALHEIM_SAVE_DIR}" \
  -public "${VALHEIM_PUBLIC}"

if [ -n "${VALHEIM_SERVER_PASSWORD}" ]; then
  set -- "$@" -password "${VALHEIM_SERVER_PASSWORD}"
fi

set -f
set -- "$@" ${VALHEIM_START_PARAMS}
set +f

setsid stdbuf -oL "$@" </dev/null &
VALHEIM_PID=$!

echo "${VALHEIM_PID}" > "${PID_FILE}"
log "Server PID: ${VALHEIM_PID}"
log "Launching Valheim dedicated server..."

EXIT_CODE=0

while :; do
  if wait "${VALHEIM_PID}"; then
    EXIT_CODE=0
    break
  fi

  EXIT_CODE=$?

  if kill -0 "${VALHEIM_PID}" 2>/dev/null; then
    continue
  fi

  break
done

log "Valheim server exited with code ${EXIT_CODE}"
exit "${EXIT_CODE}"

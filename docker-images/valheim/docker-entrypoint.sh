#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
VALHEIM_INSTALL_DIR="${VALHEIM_INSTALL_DIR:-${DATA_DIR}/server}"
VALHEIM_SAVE_DIR="${VALHEIM_SAVE_DIR:-${DATA_DIR}/save}"
RUNTIME_DIR="${RUNTIME_DIR:-/run/valheim}"
STEAMCMD_DIR="${STEAMCMD_DIR:-/opt/steamcmd}"
VALHEIM_STEAM_APP_ID="${VALHEIM_STEAM_APP_ID:-896660}"
VALHEIM_UPDATE_ON_START="${VALHEIM_UPDATE_ON_START:-false}"
VALHEIM_VALIDATE_ON_START="${VALHEIM_VALIDATE_ON_START:-false}"
VALHEIM_START_PARAMS="${VALHEIM_START_PARAMS:-}"
VALHEIM_SERVER_PASSWORD="${VALHEIM_SERVER_PASSWORD:-}"
VALHEIM_PUBLIC="${VALHEIM_PUBLIC:-1}"
LOG_PREFIX="[valheim]"

. /app/common.sh

VALHEIM_SERVER_BIN="${VALHEIM_SERVER_BIN:-${VALHEIM_INSTALL_DIR}/valheim_server.x86_64}"
STEAMCMD_BIN="${STEAMCMD_DIR}/steamcmd.sh"

log "Starting bootstrap..."

if [ "$#" -gt 0 ]; then
  log "Custom command requested, bypassing server bootstrap."
  exec "$@"
fi

assert_safe_data_dir
assert_writable_dir "${DATA_DIR}"
assert_writable_dir "${RUNTIME_DIR}"
assert_writable_dir "${VALHEIM_INSTALL_DIR}"
assert_writable_dir "${VALHEIM_SAVE_DIR}"

if [ ! -x "${STEAMCMD_BIN}" ]; then
  die "SteamCMD executable not found: ${STEAMCMD_BIN}"
fi

setup_steam_runtime_paths() {
  mkdir -p "${HOME}/.steam/sdk64" "${HOME}/.steam/sdk32"

  if [ -f "${STEAMCMD_DIR}/linux64/steamclient.so" ]; then
    ln -sf "${STEAMCMD_DIR}/linux64/steamclient.so" "${HOME}/.steam/sdk64/steamclient.so"
  fi

  if [ -f "${STEAMCMD_DIR}/linux32/steamclient.so" ]; then
    ln -sf "${STEAMCMD_DIR}/linux32/steamclient.so" "${HOME}/.steam/sdk32/steamclient.so"
  fi
}

install_or_update_valheim() {
  UPDATE_REASON=""
  VALIDATE_APP="false"

  if [ ! -x "${VALHEIM_SERVER_BIN}" ]; then
    UPDATE_REASON="server binary is missing"
    VALIDATE_APP="true"
  elif is_truthy "${VALHEIM_UPDATE_ON_START}"; then
    UPDATE_REASON="VALHEIM_UPDATE_ON_START is enabled"
  fi

  if is_truthy "${VALHEIM_VALIDATE_ON_START}"; then
    VALIDATE_APP="true"
  fi

  if [ -z "${UPDATE_REASON}" ] && [ "${VALIDATE_APP}" != "true" ]; then
    log "Found existing Valheim installation, skipping SteamCMD update."
    return 0
  fi

  if [ -n "${UPDATE_REASON}" ]; then
    log "Running SteamCMD update because ${UPDATE_REASON}."
  else
    log "Running SteamCMD validation."
  fi

  set -- "${STEAMCMD_BIN}" \
    +force_install_dir "${VALHEIM_INSTALL_DIR}" \
    +login anonymous \
    +app_update "${VALHEIM_STEAM_APP_ID}"

  if [ "${VALIDATE_APP}" = "true" ]; then
    set -- "$@" validate
  fi

  set -- "$@" +quit

  STEAMCMD_MAX_ATTEMPTS="${STEAMCMD_MAX_ATTEMPTS:-5}"
  STEAMCMD_RETRY_DELAY_SECONDS="${STEAMCMD_RETRY_DELAY_SECONDS:-10}"
  ATTEMPT=1
  STEAMCMD_OUTPUT="$(mktemp "${RUNTIME_DIR}/steamcmd-output.XXXXXX")"
  STEAMCMD_EXIT_CODE_FILE="${STEAMCMD_OUTPUT}.exit-code"

  while :; do
    : > "${STEAMCMD_OUTPUT}"
    rm -f "${STEAMCMD_EXIT_CODE_FILE}"

    (
      set +e
      "$@"
      printf '%s\n' "$?" > "${STEAMCMD_EXIT_CODE_FILE}"
    ) 2>&1 | tee "${STEAMCMD_OUTPUT}"

    if [ ! -f "${STEAMCMD_EXIT_CODE_FILE}" ]; then
      rm -f "${STEAMCMD_OUTPUT}"
      die "SteamCMD exit code could not be determined."
    fi

    STEAMCMD_EXIT_CODE="$(cat "${STEAMCMD_EXIT_CODE_FILE}")"

    if [ "${STEAMCMD_EXIT_CODE}" -eq 0 ]; then
      rm -f "${STEAMCMD_OUTPUT}" "${STEAMCMD_EXIT_CODE_FILE}"
      break
    fi

    if ! grep -Fq "Failed to install app '${VALHEIM_STEAM_APP_ID}' (Missing configuration)" "${STEAMCMD_OUTPUT}"; then
      rm -f "${STEAMCMD_OUTPUT}" "${STEAMCMD_EXIT_CODE_FILE}"
      die "SteamCMD failed with exit code ${STEAMCMD_EXIT_CODE}."
    fi

    if [ "${ATTEMPT}" -ge "${STEAMCMD_MAX_ATTEMPTS}" ]; then
      rm -f "${STEAMCMD_OUTPUT}" "${STEAMCMD_EXIT_CODE_FILE}"
      die "SteamCMD failed after ${ATTEMPT} attempt(s) with the known transient 'Missing configuration' error."
    fi

    log "SteamCMD attempt ${ATTEMPT}/${STEAMCMD_MAX_ATTEMPTS} failed with the known transient 'Missing configuration' error; retrying in ${STEAMCMD_RETRY_DELAY_SECONDS}s..."
    ATTEMPT=$((ATTEMPT + 1))
    sleep "${STEAMCMD_RETRY_DELAY_SECONDS}"
  done
}

validate_server_password() {
  # A password is only required for a public server; if provided it must be at least 5 chars.
  if [ -n "${VALHEIM_SERVER_PASSWORD}" ]; then
    if [ "${#VALHEIM_SERVER_PASSWORD}" -lt 5 ]; then
      die "VALHEIM_SERVER_PASSWORD is too short (Valheim requires at least 5 characters)."
    fi
    return 0
  fi

  if [ "${VALHEIM_PUBLIC}" = "1" ]; then
    die "A public server (VALHEIM_PUBLIC=1) requires VALHEIM_SERVER_PASSWORD (min 5 characters). Set a password, or set VALHEIM_PUBLIC=0 for a private (join-by-IP) server."
  fi
}

validate_server_password

install_or_update_valheim

setup_steam_runtime_paths

if [ ! -x "${VALHEIM_SERVER_BIN}" ]; then
  die "Valheim server binary is not executable after install/update: ${VALHEIM_SERVER_BIN}"
fi

export DATA_DIR
export VALHEIM_INSTALL_DIR
export VALHEIM_SAVE_DIR
export VALHEIM_SERVER_BIN
export RUNTIME_DIR
export VALHEIM_SERVER_PASSWORD
export VALHEIM_START_PARAMS

log "Bootstrap complete, handing over to launcher..."
exec /app/launcher.sh

#!/bin/sh

LOG_PREFIX="${LOG_PREFIX:-[app]}"

log() {
  printf '%s %s\n' "${LOG_PREFIX}" "$*"
}

die() {
  printf '%s ERROR: %s\n' "${LOG_PREFIX}" "$*" >&2
  exit 1
}

is_truthy() {
  case "$1" in
    1|[Tt][Rr][Uu][Ee]|[Yy]|[Yy][Ee][Ss]|[Oo][Nn])
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_safe_data_dir() {
  case "${DATA_DIR:-}" in
    ""|"/")
      die "Refusing to operate on unsafe DATA_DIR='${DATA_DIR:-}'."
      ;;
  esac
}

assert_writable_dir() {
  TARGET_DIR="$1"
  TEST_FILE="${TARGET_DIR}/.writable-check-$$"

  if ! mkdir -p "${TARGET_DIR}" 2>/dev/null; then
    die "Directory '${TARGET_DIR}' cannot be created or accessed by user '$(id -un)' (uid=$(id -u), gid=$(id -g))."
  fi

  if ! : > "${TEST_FILE}" 2>/dev/null; then
    die "Directory '${TARGET_DIR}' is not writable by user '$(id -un)' (uid=$(id -u), gid=$(id -g))."
  fi

  rm -f "${TEST_FILE}"
}

curl_to_stdout() {
  CURL_URL="$1"

  curl -fsSL \
    --retry "${CURL_RETRY_COUNT:-3}" \
    --retry-delay "${CURL_RETRY_DELAY_SECONDS:-2}" \
    --connect-timeout "${CURL_CONNECT_TIMEOUT_SECONDS:-15}" \
    --max-time "${CURL_MAX_TIME_SECONDS:-300}" \
    "${CURL_URL}"
}

download_to_file() {
  DOWNLOAD_URL="$1"
  DOWNLOAD_DEST="$2"
  DOWNLOAD_DEST_DIR="$(dirname "${DOWNLOAD_DEST}")"

  mkdir -p "${DOWNLOAD_DEST_DIR}"
  DOWNLOAD_TMP="$(mktemp "${DOWNLOAD_DEST_DIR}/.download.XXXXXX")"

  if ! curl -fsSL \
    --retry "${CURL_RETRY_COUNT:-3}" \
    --retry-delay "${CURL_RETRY_DELAY_SECONDS:-2}" \
    --connect-timeout "${CURL_CONNECT_TIMEOUT_SECONDS:-15}" \
    --max-time "${CURL_MAX_TIME_SECONDS:-300}" \
    -o "${DOWNLOAD_TMP}" \
    "${DOWNLOAD_URL}"; then
    rm -f "${DOWNLOAD_TMP}"
    return 1
  fi

  mv "${DOWNLOAD_TMP}" "${DOWNLOAD_DEST}"
}

valheim_pid_file_path() {
  printf '%s/server.pid\n' "${RUNTIME_DIR:-/run/valheim}"
}

read_valheim_pid() {
  VALHEIM_PID_FILE="$(valheim_pid_file_path)"

  [ -f "${VALHEIM_PID_FILE}" ] || return 1

  VALHEIM_PID="$(cat "${VALHEIM_PID_FILE}" 2>/dev/null || true)"
  case "${VALHEIM_PID}" in
    ""|*[!0-9]*)
      return 1
      ;;
  esac

  printf '%s\n' "${VALHEIM_PID}"
}

is_valheim_server_running() {
  RUNNING_PID="$(read_valheim_pid)" || return 1
  kill -0 "${RUNNING_PID}" 2>/dev/null
}

assert_valheim_server_stopped() {
  if RUNNING_PID="$(read_valheim_pid)" && kill -0 "${RUNNING_PID}" 2>/dev/null; then
    die "Valheim server is still running with PID ${RUNNING_PID}. Stop the server before running this operation."
  fi
}

has_valheim_crossplay() {
  case " ${VALHEIM_START_PARAMS:-} " in
    *" -crossplay "*)
      return 0
      ;;
  esac

  return 1
}

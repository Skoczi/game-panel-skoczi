#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
VALHEIM_INSTALL_DIR="${VALHEIM_INSTALL_DIR:-${DATA_DIR}/server}"
RUNTIME_DIR="${RUNTIME_DIR:-/run/valheim}"
BEPINEX_VERSION_INPUT="${1:-${BEPINEX_VERSION:-latest}}"
BEPINEX_NAMESPACE="${BEPINEX_NAMESPACE:-denikson}"
BEPINEX_PACKAGE="${BEPINEX_PACKAGE:-BepInExPack_Valheim}"
BEPINEX_API_BASE="${BEPINEX_API_BASE:-https://thunderstore.io/api/experimental/package}"
BEPINEX_DOWNLOAD_BASE="${BEPINEX_DOWNLOAD_BASE:-https://thunderstore.io/package/download}"
LOG_PREFIX="[valheim-bepinex]"

. /app/common.sh

VALHEIM_SERVER_BIN="${VALHEIM_SERVER_BIN:-${VALHEIM_INSTALL_DIR}/valheim_server.x86_64}"

WORK_DIR=""
cleanup() {
  [ -n "${WORK_DIR}" ] && [ -d "${WORK_DIR}" ] && rm -rf "${WORK_DIR}" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM HUP

resolve_bepinex_download() {
  if [ "${BEPINEX_VERSION_INPUT}" = "latest" ]; then
    API_URL="${BEPINEX_API_BASE}/${BEPINEX_NAMESPACE}/${BEPINEX_PACKAGE}/"

    PACKAGE_JSON="$(curl_to_stdout "${API_URL}")" \
      || die "Could not query the Thunderstore package API: ${API_URL}"

    BEPINEX_RESOLVED_VERSION="$(printf '%s' "${PACKAGE_JSON}" | jq -r '.latest.version_number // empty')"
    BEPINEX_DOWNLOAD_URL="$(printf '%s' "${PACKAGE_JSON}" | jq -r '.latest.download_url // empty')"

    [ -n "${BEPINEX_DOWNLOAD_URL}" ] && [ "${BEPINEX_DOWNLOAD_URL}" != "null" ] \
      || die "Could not resolve the latest BepInEx version from Thunderstore (${API_URL})."
  else
    BEPINEX_RESOLVED_VERSION="${BEPINEX_VERSION_INPUT}"
    BEPINEX_DOWNLOAD_URL="${BEPINEX_DOWNLOAD_BASE}/${BEPINEX_NAMESPACE}/${BEPINEX_PACKAGE}/${BEPINEX_VERSION_INPUT}/"
  fi
}

assert_safe_data_dir

if [ ! -x "${VALHEIM_SERVER_BIN}" ]; then
  die "Valheim is not installed yet (${VALHEIM_SERVER_BIN} missing). Install the game before BepInEx."
fi

assert_writable_dir "${VALHEIM_INSTALL_DIR}"
mkdir -p "${RUNTIME_DIR}"

if is_valheim_server_running; then
  die "Valheim server is running in this container. Stop it before installing BepInEx."
fi

resolve_bepinex_download

log "Installing BepInEx for Valheim."
log "Requested version: ${BEPINEX_VERSION_INPUT}"
log "Resolved version: ${BEPINEX_RESOLVED_VERSION}"
log "Download URL: ${BEPINEX_DOWNLOAD_URL}"

WORK_DIR="$(mktemp -d "${RUNTIME_DIR}/bepinex-install.XXXXXX")"
ARCHIVE_PATH="${WORK_DIR}/bepinex.zip"
STAGE_DIR="${WORK_DIR}/stage"

download_to_file "${BEPINEX_DOWNLOAD_URL}" "${ARCHIVE_PATH}"

mkdir -p "${STAGE_DIR}"
unzip -oq "${ARCHIVE_PATH}" -d "${STAGE_DIR}"

PACK_BEPINEX_DIR="$(find "${STAGE_DIR}" -type d -name BepInEx -prune | head -n1)"
[ -n "${PACK_BEPINEX_DIR}" ] || die "Downloaded archive does not contain a BepInEx/ directory."
PACK_ROOT="$(dirname "${PACK_BEPINEX_DIR}")"

[ -f "${PACK_ROOT}/BepInEx/core/BepInEx.Preloader.dll" ] \
  || die "Downloaded archive is missing BepInEx/core/BepInEx.Preloader.dll."
[ -d "${PACK_ROOT}/doorstop_libs" ] \
  || die "Downloaded archive is missing doorstop_libs/."

cp -a "${PACK_ROOT}/." "${VALHEIM_INSTALL_DIR}/"

mkdir -p "${VALHEIM_INSTALL_DIR}/BepInEx/plugins" "${VALHEIM_INSTALL_DIR}/BepInEx/config"

[ -f "${VALHEIM_INSTALL_DIR}/BepInEx/core/BepInEx.Preloader.dll" ] \
  || die "BepInEx files were copied, but the preloader is still missing after install."

log "BepInEx installation completed successfully (version ${BEPINEX_RESOLVED_VERSION})."
log "Drop mod .dll files into ${VALHEIM_INSTALL_DIR}/BepInEx/plugins and restart the server."

#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
VALHEIM_SAVE_DIR="${VALHEIM_SAVE_DIR:-${DATA_DIR}/save}"
VALHEIM_WORLD_NAME="${VALHEIM_WORLD_NAME:-Dedicated}"
RUNTIME_DIR="${RUNTIME_DIR:-/run/valheim}"
RESTORE_BACKUP="${RESTORE_BACKUP:-${1:-}}"
RESTORE_LOCK_DIR="${RESTORE_LOCK_DIR:-${VALHEIM_SAVE_DIR}/.restore.lock}"
LOG_PREFIX="[valheim-restore]"

. /app/common.sh

WORLDS_DIR="${VALHEIM_SAVE_DIR}/worlds_local"
WORLD_DIR="${WORLDS_DIR}/${VALHEIM_WORLD_NAME}"

BACKUP_DIR=""
BACKUP_NAME=""
LOCK_ACQUIRED="false"
RESTORE_SUCCESS="false"
ITEMS_MOVED="false"
WORK_DIR=""
OLD_DIR=""
NEW_DIR=""

usage() {
  echo "[valheim-restore] Usage: /app/restore.sh <backup-name>" >&2
  echo "[valheim-restore] Example: /app/restore.sh ${VALHEIM_WORLD_NAME}_backup_auto-20260909-143539" >&2
  echo "[valheim-restore] Or set RESTORE_BACKUP=<backup-name>" >&2
}

cleanup() {
  if [ "${RESTORE_SUCCESS}" != "true" ] && [ "${ITEMS_MOVED}" = "true" ] && [ -d "${OLD_DIR}" ]; then
    log "Restore failed before completion, rolling back the previous world..."

    for CURRENT_ITEM in "${WORLD_DIR}"/* "${WORLD_DIR}"/.[!.]*; do
      [ -e "${CURRENT_ITEM}" ] || continue
      rm -rf "${CURRENT_ITEM}" 2>/dev/null || true
    done

    for OLD_ITEM in "${OLD_DIR}"/* "${OLD_DIR}"/.[!.]*; do
      [ -e "${OLD_ITEM}" ] || continue
      mv "${OLD_ITEM}" "${WORLD_DIR}/" 2>/dev/null || true
    done

    ITEMS_MOVED="false"
  fi

  if [ -n "${WORK_DIR}" ] && [ -d "${WORK_DIR}" ]; then
    rm -rf "${WORK_DIR}" 2>/dev/null || true
  fi

  if [ "${LOCK_ACQUIRED}" = "true" ]; then
    rmdir "${RESTORE_LOCK_DIR}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM HUP

resolve_backup_dir() {
  INPUT="$1"

  if [ -z "${INPUT}" ]; then
    usage
    exit 1
  fi

  case "${INPUT}" in
    */*|.|..)
      die "Invalid backup name (path separators are not allowed): ${INPUT}"
      ;;
  esac

  printf '%s\n' "${WORLDS_DIR}/${INPUT}"
}

validate_backup_dir() {
  if [ ! -d "${BACKUP_DIR}" ]; then
    die "Backup not found: ${BACKUP_DIR}"
  fi

  if find "${BACKUP_DIR}" -type l | grep . >/dev/null 2>&1; then
    die "Backup contains symbolic links, which are not supported by restore."
  fi

  if ! find "${BACKUP_DIR}" -maxdepth 1 -type f -name '_main.*.ok' -print -quit | grep . >/dev/null 2>&1; then
    die "Backup '${BACKUP_NAME}' holds no complete world generation (no '_main.<n>.ok' marker) and cannot be restored."
  fi
}

assert_safe_data_dir
assert_writable_dir "${VALHEIM_SAVE_DIR}"
mkdir -p "${WORLDS_DIR}" "${RUNTIME_DIR}"

assert_valheim_server_stopped

if ! mkdir "${RESTORE_LOCK_DIR}" 2>/dev/null; then
  die "Another restore is already running."
fi
LOCK_ACQUIRED="true"

BACKUP_DIR="$(resolve_backup_dir "${RESTORE_BACKUP}")"
BACKUP_NAME="$(basename "${BACKUP_DIR}")"

log "Starting restore..."
log "Backup: ${BACKUP_NAME}"
log "World: ${VALHEIM_WORLD_NAME}"

if [ "${BACKUP_DIR}" = "${WORLD_DIR}" ]; then
  die "Refusing to restore the live world '${VALHEIM_WORLD_NAME}' onto itself."
fi

validate_backup_dir

mkdir -p "${WORLD_DIR}"

WORK_DIR="$(mktemp -d "${VALHEIM_SAVE_DIR}/.restore-work.XXXXXX")"
OLD_DIR="${WORK_DIR}/old"
NEW_DIR="${WORK_DIR}/new"
mkdir -p "${OLD_DIR}" "${NEW_DIR}"

log "Staging the backup contents..."
cp -a "${BACKUP_DIR}/." "${NEW_DIR}/"

log "Moving the current world aside for rollback..."
ITEMS_MOVED="true"
for CURRENT_ITEM in "${WORLD_DIR}"/* "${WORLD_DIR}"/.[!.]*; do
  [ -e "${CURRENT_ITEM}" ] || continue
  mv "${CURRENT_ITEM}" "${OLD_DIR}/"
done

log "Installing backup '${BACKUP_NAME}' as world '${VALHEIM_WORLD_NAME}'..."
for NEW_ITEM in "${NEW_DIR}"/* "${NEW_DIR}"/.[!.]*; do
  [ -e "${NEW_ITEM}" ] || continue
  mv "${NEW_ITEM}" "${WORLD_DIR}/"
done

RESTORE_SUCCESS="true"
log "Restore completed successfully."

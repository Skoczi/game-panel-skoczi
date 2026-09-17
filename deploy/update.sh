#!/usr/bin/env bash
# Modified by Skoczi: default updates to this fork, not upstream.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=deploy/lib/update-common.sh
. "$SCRIPT_DIR/lib/update-common.sh"

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-root)
        GP_APP_ROOT="${2:-}"
        shift 2
        ;;
      --project-name)
        GP_COMPOSE_PROJECT_NAME="${2:-}"
        shift 2
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(48))
PY
    return
  fi

  tr -dc 'A-Fa-f0-9' </dev/urandom | head -c 96
}

generate_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi

  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
    return
  fi

  die "Unable to generate a UUID (missing uuidgen, /proc/sys/kernel/random/uuid, and python3)."
}

ensure_runtime_env_defaults() {
  local current_db_api_base_url=""

  current_db_api_base_url="$(read_env_raw_value 'VITE_DB_API_BASE_URL')"
  if [[ -z "$current_db_api_base_url" ]]; then
    current_db_api_base_url="https://db.gamepanel.ovh/"
  fi

  append_env_if_missing 'APP_INSTANCE_ID' "$(generate_uuid)"
  append_env_if_missing 'APP_INSTANCE_SECRET' "$(generate_secret)"
  append_env_if_missing 'TRUST_PROXY' "1"
  append_env_if_missing 'TELEMETRY_ENABLED' "false"
  append_env_if_missing 'TELEMETRY_API_BASE_URL' "$current_db_api_base_url"
  append_env_if_missing 'GAMEPANEL_APP_ROOT' "$APP_ROOT"
  append_env_if_missing 'GAMEPANEL_REPOSITORY_URL' "https://github.com/Skoczi/game-panel-skoczi.git"
}

wait_for_stack() {
  local max_attempts=60
  local sleep_seconds=2

  for ((i=1; i<=max_attempts; i++)); do
    local backend_id=""
    local frontend_id=""
    local traefik_id=""

    backend_id="$(docker ps -q \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=backend")"
    frontend_id="$(docker ps -q \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=frontend")"
    traefik_id="$(docker ps -q \
      --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
      --filter "label=com.docker.compose.service=traefik")"

    if [[ -n "$backend_id" && -n "$frontend_id" && -n "$traefik_id" ]]; then
      if wait_for_panel_http 90; then
        return
      fi

      warn "The stack is up but the panel is not reachable through Traefik."
      warn "If it stays unreachable, restore the previous version with: sudo bash deploy/rollback.sh"
      return
    fi

    sleep "$sleep_seconds"
  done

  warn "Stack did not become fully ready in time. Current status:"
  compose_cmd ps || true
}

main() {
  ensure_linux
  parse_args "$@"
  ensure_root "$@"
  require_cmd systemctl

  LOCAL_SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  require_local_source_tree "$LOCAL_SOURCE_ROOT"

  APP_ROOT="${GP_APP_ROOT:-/opt/gamepanel}"
  COMPOSE_PROJECT_NAME="${GP_COMPOSE_PROJECT_NAME:-gamepanel}"

  APP_SOURCE_DIR="${APP_ROOT}/app"
  DEPLOY_DIR="${APP_ROOT}/deploy"
  DATA_DIR="${APP_ROOT}/data"
  BACKUP_DIR="${APP_ROOT}/update-backups"
  ENV_FILE="${DEPLOY_DIR}/.env"
  COMPOSE_FILE="${DEPLOY_DIR}/compose.yml"

  [[ -d "$APP_SOURCE_DIR" ]] || die "Missing app source directory: $APP_SOURCE_DIR (run install first)."
  [[ -d "$DEPLOY_DIR" ]] || die "Missing deploy directory: $DEPLOY_DIR (run install first)."
  [[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE (run install first)."
  [[ -f "$COMPOSE_FILE" ]] || die "Missing compose file: $COMPOSE_FILE (run install first)."

  ensure_docker_stack
  ensure_compose_traefik_image "$COMPOSE_FILE"

  log "Using local source tree from $LOCAL_SOURCE_ROOT."
  SOURCE_ROOT="$LOCAL_SOURCE_ROOT"
  assert_app_versions_match "$SOURCE_ROOT"

  local from_version="" to_version="" backup_path=""
  from_version="$(read_app_version "$APP_SOURCE_DIR")"
  to_version="$(read_app_version "$SOURCE_ROOT")"

  log "Creating the update backup..."
  backup_path="$(create_backup_unit "$from_version" "$to_version")"
  prune_backups
  log "Backup created: $backup_path"

  sync_project_sources
  ensure_runtime_env_defaults

  render_compose_if_available

  log "Running deploy migrations..."
  run_deploy_migrations

  log "Skoczi preview: no upstream updater image will be pulled."

  log "Rebuilding and starting updated GamePanel stack..."
  compose_cmd build --pull
  compose_cmd up -d --remove-orphans

  wait_for_stack
  send_panel_updated_event

  printf '\n'
  log "Update complete."
  printf 'Compose project: %s\n' "$COMPOSE_PROJECT_NAME"
  printf 'Compose file: %s\n' "$COMPOSE_FILE"
}

main "$@"

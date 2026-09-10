#!/usr/bin/env bash
# Moves the panel onto two explicit Docker networks:
#   - gamepanel-edge   traefik <-> frontend <-> backend (replaces "web")
#   - gamepanel-games  backend <-> game containers, declared external so that
#                      compose never removes it from under stopped game servers
#
# The work is done by the compose renderer, which every later update now runs on
# its own.
set -euo pipefail

APP_SOURCE_DIR="${GP_APP_SOURCE_DIR:?GP_APP_SOURCE_DIR is required}"
COMPOSE_FILE="${GP_COMPOSE_FILE:?GP_COMPOSE_FILE is required}"

renderer="$APP_SOURCE_DIR/deploy/lib/render-compose.sh"
if [[ ! -f "$renderer" ]]; then
  printf '[ERROR] %s\n' "Missing compose renderer: $renderer" >&2
  exit 1
fi

GP_COMPOSE_FILE="$COMPOSE_FILE" bash "$renderer"

# Fail before the stack is touched rather than after: the panel keeps running the
# previous version if the render did not produce what we expect.
grep -q 'name: gamepanel-games' "$COMPOSE_FILE" \
  || { printf '[ERROR] %s\n' "Rendered compose file is missing the games network" >&2; exit 1; }

printf '[INFO] %s\n' "Compose file migrated to the gamepanel-edge / gamepanel-games networks." >&2

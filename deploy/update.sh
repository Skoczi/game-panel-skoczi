#!/usr/bin/env bash
# Game Panel PRO standard-layout updater. Builds this release, never upstream.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/upgrade.py" update "$@"

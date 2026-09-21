#!/usr/bin/env bash
# Explicit snapshot required; no network checkout or rebuild during rollback.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/upgrade.py" rollback "$@"

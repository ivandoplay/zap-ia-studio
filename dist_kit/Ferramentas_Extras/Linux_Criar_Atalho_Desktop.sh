#!/usr/bin/env bash
set -e
OUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$OUTER_DIR/sistema/scripts/setup_linux_portable.sh" --create-shortcut

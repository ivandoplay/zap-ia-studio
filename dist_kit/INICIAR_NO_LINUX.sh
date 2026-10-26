#!/usr/bin/env bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$BASE_DIR/sistema/package.json" ]; then
  echo ""
  echo "[ATENCAO] Extraia o arquivo .ZIP completamente antes de executar."
  echo ""
  exit 1
fi

exec bash "$BASE_DIR/sistema/scripts/setup_linux_portable.sh" --start-app

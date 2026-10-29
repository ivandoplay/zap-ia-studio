#!/data/data/com.termux/files/usr/bin/bash
set -e

OUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$OUTER_DIR/sistema"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get full-upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y libc++ openssl zlib nodejs-lts ffmpeg

cd "$APP_DIR"
npm install --legacy-peer-deps --no-bin-links --no-audit --no-fund
echo ""
echo "[OK] Ambiente Termux verificado e reparado com sucesso!"

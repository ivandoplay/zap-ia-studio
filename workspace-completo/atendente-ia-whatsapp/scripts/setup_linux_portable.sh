#!/usr/bin/env bash
set -e

MODE="start"
for arg in "$@"; do
  case "$arg" in
    --force-install) MODE="install" ;;
    --start-app)     MODE="start" ;;
    --create-shortcut) MODE="shortcut" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTER_DIR="$(cd "$ROOT_DIR/.." && pwd)"

# Se alguem executar este script dentro do Android Termux por engano, redireciona para o fluxo nativo Termux
if [ -n "${PREFIX:-}" ] && echo "$PREFIX" | grep -q "com.termux"; then
  if [ -f "$OUTER_DIR/INICIAR_NO_TERMUX.sh" ]; then
    exec bash "$OUTER_DIR/INICIAR_NO_TERMUX.sh"
  fi
fi

if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo ""
  echo "[ATENCAO] Extraia o arquivo .ZIP completamente antes de executar o sistema."
  echo ""
  exit 1
fi

if [ "$MODE" = "shortcut" ]; then
  DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
  [ -d "$HOME/Área de Trabalho" ] && DESKTOP_DIR="$HOME/Área de Trabalho"
  mkdir -p "$DESKTOP_DIR"
  TARGET_SH="$OUTER_DIR/INICIAR_NO_LINUX.sh"
  [ ! -f "$TARGET_SH" ] && TARGET_SH="$SCRIPT_DIR/setup_linux_portable.sh --start-app"
  SHORTCUT_FILE="$DESKTOP_DIR/Ienvia.desktop"
  cat > "$SHORTCUT_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Ienvia (WhatsApp)
Comment=Atendente Humano IA & CRM Multi-Contas
Exec=bash "$OUTER_DIR/INICIAR_NO_LINUX.sh"
Path=$OUTER_DIR
Terminal=true
Icon=$ROOT_DIR/public/icon.svg
Categories=Office;Network;
EOF
  chmod +x "$SHORTCUT_FILE" 2>/dev/null || true
  echo "[PRONTO] Atalho criado em: $SHORTCUT_FILE"
  exit 0
fi

RUNTIME_DIR="$ROOT_DIR/.runtime"
PORTABLE_NODE_DIR="$RUNTIME_DIR/node"
PORTABLE_NODE_BIN="$PORTABLE_NODE_DIR/bin/node"

check_node_20_plus() {
  local bin="$1"
  [ -x "$bin" ] || return 1
  local major
  major=$("$bin" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
  [ "${major:-0}" -ge 20 ] 2>/dev/null
}

NODE_BIN_DIR=""

if check_node_20_plus "$PORTABLE_NODE_BIN"; then
  NODE_BIN_DIR="$PORTABLE_NODE_DIR/bin"
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  SYS_NODE="$(command -v node)"
  if check_node_20_plus "$SYS_NODE"; then
    NODE_BIN_DIR="$(dirname "$SYS_NODE")"
  fi
fi

download_url_to_file() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --retry 3 --connect-timeout 20 -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --timeout=25 -O "$dest" "$url"
  else
    echo "[ERRO] Nem 'curl' nem 'wget' foram encontrados para baixar o motor portatil."
    exit 1
  fi
}

fetch_text_url() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 15 "$url" 2>/dev/null || true
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=15 "$url" 2>/dev/null || true
  fi
}

install_portable_node_linux() {
  echo ""
  echo "=============================================================="
  echo "  IENVIA -- PREPARANDO MOTOR PORTATIL LINUX (1a VEZ)"
  echo "  Zero sudo / Zero instalacao global no seu sistema!"
  echo "=============================================================="
  echo ""

  mkdir -p "$RUNTIME_DIR"

  local raw_arch
  raw_arch="$(uname -m)"
  local node_arch="linux-x64"
  case "$raw_arch" in
    x86_64|amd64)   node_arch="linux-x64" ;;
    aarch64|arm64)  node_arch="linux-arm64" ;;
    armv7l|armv7*)  node_arch="linux-armv7l" ;;
    *)
      echo "[ERRO] Arquitetura de processador nao suportada automaticamente: $raw_arch"
      exit 1
      ;;
  esac

  if [ "$node_arch" = "linux-x64" ]; then
    if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then
      node_arch="linux-x64-musl"
    fi
  fi

  local base_url="https://nodejs.org/dist/latest-v22.x"
  local shasums
  shasums="$(fetch_text_url "$base_url/SHASUMS256.txt")"

  local tar_name=""
  local expected_sha=""
  if [ -n "$shasums" ]; then
    local matched
    matched="$(printf '%s\n' "$shasums" | grep -E "^[0-9a-fA-F]{64}[[:space:]]+node-v22\.[0-9]+\.[0-9]+-${node_arch}\.tar\.gz$" | head -n 1 || true)"
    if [ -n "$matched" ]; then
      expected_sha="$(printf '%s' "$matched" | awk '{print tolower($1)}')"
      tar_name="$(printf '%s' "$matched" | awk '{print $2}')"
    fi
  fi

  if [ -z "$tar_name" ]; then
    base_url="https://nodejs.org/dist/v22.23.4"
    tar_name="node-v22.23.4-${node_arch}.tar.gz"
    case "$node_arch" in
      linux-x64)      expected_sha="b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406" ;;
      linux-arm64)    expected_sha="f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9" ;;
      linux-armv7l)   expected_sha="4318e0c68f62e18583dae85eb645f55c7f2b8a2e8d1fffe91a2e8abd046880ab" ;;
      linux-x64-musl) expected_sha="63189402eaa222aabf51b4983e512592131cd2d4a9efc3ad9bf291fe74e3e4de" ;;
    esac
  fi

  local tmp_tar="$RUNTIME_DIR/node-portable.tar.gz"
  rm -f "$tmp_tar"

  echo "[1/2] Baixando Node.js v22 LTS Portatil Oficial ($tar_name)..."
  download_url_to_file "$base_url/$tar_name" "$tmp_tar"

  if [ -n "$expected_sha" ]; then
    local actual_sha=""
    if command -v sha256sum >/dev/null 2>&1; then
      actual_sha="$(sha256sum "$tmp_tar" | awk '{print tolower($1)}')"
    elif command -v shasum >/dev/null 2>&1; then
      actual_sha="$(shasum -a 256 "$tmp_tar" | awk '{print tolower($1)}')"
    fi
    if [ -n "$actual_sha" ] && [ "$actual_sha" != "$expected_sha" ]; then
      rm -f "$tmp_tar"
      echo "[ERRO] Falha de integridade SHA-256 no pacote baixado ($actual_sha != $expected_sha)."
      exit 1
    fi
  fi

  echo "      Extraindo motor em sistema/.runtime/node..."
  rm -rf "$PORTABLE_NODE_DIR"
  mkdir -p "$PORTABLE_NODE_DIR"
  tar -xzf "$tmp_tar" -C "$PORTABLE_NODE_DIR" --strip-components=1
  rm -f "$tmp_tar"

  if ! check_node_20_plus "$PORTABLE_NODE_BIN"; then
    echo "[ERRO] Motor Node portatil extraido mas nao iniciou corretamente."
    exit 1
  fi

  NODE_BIN_DIR="$PORTABLE_NODE_DIR/bin"
  echo "      [OK] Node.js Portatil $($PORTABLE_NODE_BIN -v) pronto!"
}

if [ -z "$NODE_BIN_DIR" ]; then
  install_portable_node_linux
fi

export PATH="$NODE_BIN_DIR:$PATH"
# Blindagem contra ERR_SOCKET_TIMEOUT no Node 20/22 em redes Dual-Stack (IPv6 instavel + Happy Eyeballs do undici/npm)
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

# Auto-Update Universal ANTES do npm install (usa apenas Node puro, garantindo .npmrc e scripts sempre na ultima versao!)
JUST_UPDATED=0
if [ -f "$ROOT_DIR/scripts/auto_update_boot.mjs" ] && [ "${ZAPIA_REEXEC:-0}" != "1" ]; then
  set +e
  (cd "$ROOT_DIR" && ZAPIA_DEFER_NPM=1 node scripts/auto_update_boot.mjs --signal-updated-exit-20)
  AU_CODE=$?
  set -e
  if [ "$AU_CODE" -eq 20 ]; then
    export ZAPIA_REEXEC=1
    exec bash "$ROOT_DIR/scripts/setup_linux_portable.sh" "$@"
  fi
fi
if [ "${ZAPIA_REEXEC:-0}" = "1" ]; then
  JUST_UPDATED=1
fi

check_node_modules_integrity() {
  (
    cd "$ROOT_DIR" && node -e "Promise.all([import('express'),import('@supabase/supabase-js'),import('@whiskeysockets/baileys'),import('@google/genai')]).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1
  )
}

NEEDS_NPM=0
if [ "$MODE" = "install" ] || [ ! -d "$ROOT_DIR/node_modules" ] || ! check_node_modules_integrity; then
  NEEDS_NPM=1
fi

if [ "$NEEDS_NPM" -eq 1 ]; then
  if [ -d "$ROOT_DIR/node_modules" ] && [ "$MODE" != "install" ]; then
    echo ""
    echo "[Auto-Reparo] Detectada pasta node_modules incompleta de instalacao interrompida anterior."
    echo "              Limpando arquivos corrompidos e restaurando do cache local..."
    rm -rf "$ROOT_DIR/node_modules"
  fi
  echo ""
  echo "[2/2] Configurando bibliotecas do Ienvia (modo anti-timeout IPv4 ativado)..."
  EXTRA_OPT_FLAG=""
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "      [Info] FFmpeg nativo do Linux detectado -- pulando download extra de 80MB!"
    EXTRA_OPT_FLAG="--omit=optional"
  fi
  (
    cd "$ROOT_DIR"
    set +e
    npm install --legacy-peer-deps --no-audit --no-fund --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --prefer-offline $EXTRA_OPT_FLAG
    NPM_EXIT=$?
    if [ "$NPM_EXIT" -ne 0 ] || ! node -e "Promise.all([import('express'),import('@supabase/supabase-js'),import('@whiskeysockets/baileys'),import('@google/genai')]).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo ""
      echo "      [Auto-Recuperacao] Reinstalando de forma limpa via espelho CDN de alta velocidade..."
      rm -rf "$ROOT_DIR/node_modules"
      npm install --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --omit=optional
      NPM_EXIT=$?
    fi
    if [ "$NPM_EXIT" -ne 0 ]; then
      echo "      [Auto-Recuperacao Final] Tentando modo ultra-conservador (2 conexoes simultaneas)..."
      rm -rf "$ROOT_DIR/node_modules"
      npm install --legacy-peer-deps --no-audit --no-fund --maxsockets=2 --fetch-timeout=300000 --fetch-retries=8 --omit=optional
      NPM_EXIT=$?
    fi
    set -e
    exit "$NPM_EXIT"
  )
  if [ -f "$ROOT_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
    chmod +x "$ROOT_DIR/node_modules/ffmpeg-static/ffmpeg" 2>/dev/null || true
  fi
  echo "      [OK] Todas as bibliotecas verificadas e prontas!"
fi

if [ ! -f "$ROOT_DIR/.env" ] && [ -f "$ROOT_DIR/.env.example" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

if [ "$MODE" = "install" ]; then
  echo ""
  echo "=============================================================="
  echo "  PREPARACAO CONCLUIDA COM SUCESSO!"
  echo "  Agora execute: bash INICIAR_NO_LINUX.sh"
  echo "=============================================================="
  exit 0
fi

# Verifica se a porta 3000 ja esta ativa
PORT_BUSY=0
if node -e "const n=require('net');const s=n.connect(3000,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),250);" 2>/dev/null; then
  PORT_BUSY=1
fi

if [ "$JUST_UPDATED" -eq 1 ] && [ "$PORT_BUSY" -eq 1 ]; then
  echo "[Auto-Update] Reiniciando motor local para ativar a nova versao..."
  node -e '
  const fs = require("fs");
  for (const d of (fs.existsSync("/proc") ? fs.readdirSync("/proc") : [])) {
    const pid = Number(d);
    if (!pid || pid === process.pid || pid === process.ppid) continue;
    try {
      const cmd = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\0/g, " ");
      if ((cmd.startsWith("node ") || cmd.includes("/node ")) && cmd.includes("src/server.js")) {
        process.kill(pid, "SIGKILL");
      }
    } catch {}
  }
  ' 2>/dev/null || true
  sleep 1
  PORT_BUSY=0
fi

open_linux_browser() {
  local url="http://localhost:3000"
  if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    return 0
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    (google-chrome --app="$url" >/dev/null 2>&1 &)
  elif command -v chromium-browser >/dev/null 2>&1; then
    (chromium-browser --app="$url" >/dev/null 2>&1 &)
  elif command -v chromium >/dev/null 2>&1; then
    (chromium --app="$url" >/dev/null 2>&1 &)
  elif command -v xdg-open >/dev/null 2>&1; then
    (xdg-open "$url" >/dev/null 2>&1 &)
  fi
}

if [ "$PORT_BUSY" -eq 1 ]; then
  echo "[OK] Motor Ienvia ja esta ativo na porta 3000. Abrindo painel..."
  open_linux_browser
  exit 0
fi

echo ""
echo "=============================================================="
echo "  IENVIA -- MOTOR ATIVO NO LINUX"
echo "  Painel Local:  http://localhost:3000"
echo "  Painel Nuvem:  https://zap-ia-studio.vercel.app"
echo "  (Mantenha este terminal aberto enquanto usar o WhatsApp)"
echo "=============================================================="
echo ""

# Se tiver ambiente grafico Desktop e a sessao ja estiver salva, abre o navegador automaticamente
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  (
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if node -e "const n=require('net');const s=n.connect(3000,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));" 2>/dev/null; then
        open_linux_browser
        break
      fi
      sleep 0.4
    done
  ) &
fi

cd "$ROOT_DIR"
while true; do
  set +e
  node --dns-result-order=ipv4first scripts/auto_update_boot.mjs
  node --dns-result-order=ipv4first src/server.js
  EXIT_CODE=$?
  set -e
  if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 130 ]; then
    break
  fi
  echo "[AUTO-RECUPERACAO] Motor reiniciando em 3 segundos (codigo $EXIT_CODE | Ctrl+C para parar)..."
  sleep 3
done

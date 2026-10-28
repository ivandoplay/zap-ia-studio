#!/data/data/com.termux/files/usr/bin/bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Se o usuario abriu dentro da memoria compartilhada (/storage ou Downloads),
#    copia automaticamente para $HOME/ZAP-IA-Studio (sistema nativo do Termux)!
case "$BASE_DIR" in
  */storage/*|/sdcard/*|/storage/*)
    echo "[!] Detectado que voce abriu pela pasta Downloads do Android."
    if [ -d "$HOME/ZAP-IA-Studio/sistema" ]; then
      SAFE_DIR="$HOME/ZAP-IA-Studio" # Instalacao anterior: manter sessoes no lugar.
    else
      SAFE_DIR="$HOME/Ienvia"
    fi
    echo "    Instalando copia segura na memoria interna do Termux..."
    mkdir -p "$SAFE_DIR"
    cp -rf "$BASE_DIR"/. "$SAFE_DIR/"
    BASE_DIR="$SAFE_DIR"
    cd "$BASE_DIR"
    echo "[OK] Pasta ativa: $BASE_DIR"
    echo ""
    ;;
esac

APP_DIR="$BASE_DIR/sistema"
if [ ! -f "$APP_DIR/package.json" ]; then
  echo "[ERRO] Estrutura incompleta em $APP_DIR. Extraia o .ZIP novamente."
  exit 1
fi

# 2. Migracao automatica inteligente: se o usuario ja tinha uma versao anterior em ~/atendente-ia-whatsapp ou ~/zap-ia-studio,
#    preserva automaticamente a sessao de login, treinamentos, midias e o pareamento do WhatsApp!
NEW_DATA="$APP_DIR/data"
mkdir -p "$NEW_DATA"
for OLD_DATA in "$HOME/atendente-ia-whatsapp/data" "$HOME/zap-ia-studio/data"; do
  if [ -d "$OLD_DATA" ]; then
    if [ -f "$OLD_DATA/cloud_session.json" ] && [ ! -f "$NEW_DATA/cloud_session.json" ]; then
      cp -f "$OLD_DATA/cloud_session.json" "$NEW_DATA/cloud_session.json"
      echo "[OK] Sessao da sua conta migrada automaticamente da versao anterior!"
    fi
    if [ -f "$OLD_DATA/database.json" ] && [ ! -f "$NEW_DATA/database.json" ]; then
      cp -f "$OLD_DATA/database.json" "$NEW_DATA/database.json"
    fi
    if [ -d "$OLD_DATA/wa_auth" ] && [ ! -d "$NEW_DATA/wa_auth" ]; then
      cp -rf "$OLD_DATA/wa_auth" "$NEW_DATA/wa_auth"
      echo "[OK] Conexao do WhatsApp (wa_auth) preservada automaticamente!"
    fi
    if [ -d "$OLD_DATA/uploads" ] && [ ! -d "$NEW_DATA/uploads" ]; then
      cp -rf "$OLD_DATA/uploads" "$NEW_DATA/uploads"
    fi
    if [ -d "$OLD_DATA/training_packs" ] && [ ! -d "$NEW_DATA/training_packs" ]; then
      cp -rf "$OLD_DATA/training_packs" "$NEW_DATA/training_packs"
    fi
  fi
done

# 3. Na 1a vez no Termux (caso falte node ou ffmpeg), instala tudo sozinho!
if ! command -v node >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  echo "=============================================================="
  echo "  PREPARANDO AMBIENTE TERMUX PELA 1a VEZ (NODE LTS + FFMPEG)"
  echo "=============================================================="
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get full-upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
  apt-get install -y libc++ openssl zlib nodejs-lts ffmpeg
fi

cd "$APP_DIR"
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

# Auto-Update antes do npm install (garante .npmrc e scripts sempre na versao mais recente!)
if [ -f "scripts/auto_update_boot.mjs" ]; then
  ZAPIA_DEFER_NPM=1 node scripts/auto_update_boot.mjs || true
fi

if [ ! -d "node_modules" ] || ! node -e "Promise.all([import('express'),import('@supabase/supabase-js'),import('@whiskeysockets/baileys'),import('@google/genai')]).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  if [ -d "node_modules" ]; then
    echo "[Auto-Reparo] Limpando instalacao incompleta anterior..."
    rm -rf node_modules
  fi
  echo ""
  echo "Instalando bibliotecas do Ienvia (modo anti-timeout IPv4)..."
  npm install --legacy-peer-deps --no-bin-links --no-audit --no-fund --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --prefer-offline --omit=optional || \
    (rm -rf node_modules && npm install --legacy-peer-deps --no-bin-links --no-audit --no-fund --registry=https://registry.npmmirror.com --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --omit=optional)
fi

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
fi

# Registra atalho pratico "zapia" no Termux para abrir já atualizando com 1 palavra!
if [ -d "/data/data/com.termux/files/usr" ]; then
  touch "$HOME/.bashrc"
  if ! grep -q "alias ienvia=" "$HOME/.bashrc" 2>/dev/null; then
    printf "alias ienvia='bash \"%s/INICIAR_NO_TERMUX.sh\"'\n" "$BASE_DIR" >> "$HOME/.bashrc"
  fi
fi

APP_VER=$(node -p "try{JSON.parse(require('fs').readFileSync('./package.json','utf8')).version}catch(e){'5.5'}" 2>/dev/null || echo "5.5")
echo "=============================================================="
echo "  IENVIA v${APP_VER} -- MOTOR 24H ATIVO NO ANDROID (TERMUX)"
echo "=============================================================="

# Garante instancia unica REAL: encerra qualquer loop anterior de outra aba do Termux + qualquer node antigo (sem usar pkill -f!)
trap '' HUP
mkdir -p data
if [ -f "data/.wrapper.pid" ]; then
  OLD_WPID=$(cat "data/.wrapper.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_WPID" ] && [ "$OLD_WPID" != "$$" ] && [ "$OLD_WPID" != "$PPID" ]; then
    kill -9 "$OLD_WPID" 2>/dev/null || true
  fi
fi
echo "$$" > "data/.wrapper.pid"
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

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "[OK] Wake-Lock ativado (continua atendendo com a tela desligada)."
fi

WIFI_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n 1)
echo ""
echo "Painel Nuvem 24h: https://zap-ia-studio.vercel.app"
echo "Painel Local:     http://localhost:3000"
if [ -n "$WIFI_IP" ]; then
  echo "Na rede Wi-Fi:    http://$WIFI_IP:3000"
fi
echo "=============================================================="
echo ""

while true; do
  # Se outra aba mais nova assumiu o .wrapper.pid, encerra esta aba antiga silenciosamente
  CUR_WPID=$(cat "data/.wrapper.pid" 2>/dev/null || echo "$$")
  if [ "$CUR_WPID" != "$$" ]; then
    echo "[OK] Nova janela do Motor assumiu a execucao. Encerrando aba antiga."
    break
  fi

  set +e
  if [ -f "scripts/auto_update_boot.mjs" ]; then
    node --dns-result-order=ipv4first scripts/auto_update_boot.mjs || true
  fi
  node --dns-result-order=ipv4first src/server.js
  EXIT_CODE=$?
  set -e

  CUR_WPID=$(cat "data/.wrapper.pid" 2>/dev/null || echo "$$")
  if [ "$CUR_WPID" != "$$" ]; then
    break
  fi

  # Somente Ctrl+C manual (130) ou porta ja ocupada (0) encerram o loop; qualquer queda ou sinal do Android reinicia sozinho!
  if [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 0 ]; then
    break
  fi
  echo "[AUTO-RECUPERACAO] Motor reiniciando automaticamente em 3 segundos (codigo $EXIT_CODE | Ctrl+C para parar)..."
  sleep 3
done

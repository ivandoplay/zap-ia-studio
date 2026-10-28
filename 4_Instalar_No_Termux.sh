#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=============================================================="
echo "  IENVIA — INSTALACAO AUTOMATICA NO ANDROID (TERMUX)"
echo "=============================================================="
echo ""

# 1. Se o usuario estiver rodando dentro da memoria compartilhada (/storage ou downloads),
#    copia automaticamente para $HOME/ZAP-IA-Studio (sistema Linux nativo do Termux),
#    pois o Android bloqueia symlinks do npm dentro da pasta Downloads!
CURRENT_DIR="$(pwd -P)"
case "$CURRENT_DIR" in
  */storage/*|/sdcard/*|/storage/*)
    echo "[!] Detectado que voce abriu pela pasta Downloads do Android."
    echo "    Copiando automaticamente para a memoria interna do Termux (~/ZAP-IA-Studio)..."
    mkdir -p "$HOME/ZAP-IA-Studio"
    cp -rf "$CURRENT_DIR"/. "$HOME/ZAP-IA-Studio/"
    cd "$HOME/ZAP-IA-Studio"
    echo "[OK] Agora rodando em: $(pwd)"
    echo ""
    ;;
esac

echo "[1/3] Atualizando bibliotecas base do Termux (libc++ / NDK) e Node.js LTS..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get full-upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y libc++ openssl zlib nodejs-lts ffmpeg

echo ""
echo "[2/3] Verificando versao do Node.js..."
node -v
npm -v

echo ""
echo "[3/3] Instalando bibliotecas puras JS/WASM (sem compilacao pesada)..."
npm install --legacy-peer-deps --no-bin-links --no-audit --no-fund

if [ ! -f ".env" ]; then
  cp .env.example .env
fi

echo ""
echo "=============================================================="
echo "  INSTALACAO CONCLUIDA COM SUCESSO NO TERMUX!"
echo "  Para ligar o sistema 24h, rode:"
echo "  cd ~/ZAP-IA-Studio && bash 5_Iniciar_No_Termux.sh"
echo "=============================================================="

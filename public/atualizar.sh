#!/usr/bin/env bash
set -e

BASE_URL="${ZAPIA_BASE_URL:-https://zap-ia-studio.vercel.app}"
TARGET_ROOT="$HOME/ZAP-IA-Studio"
TARGET_APP="$TARGET_ROOT/sistema"
TMP_ZIP="${TMPDIR:-/tmp}/zapia_motor_update_$$.zip"

echo "=============================================================="
echo "  ZAP-IA STUDIO -- ATUALIZADOR & INSTALADOR OFICIAL (1 COMANDO)"
echo "=============================================================="

# 1. Se estiver no Termux pela 1a vez sem Node.js ou FFmpeg, instala automaticamente
if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  if [ -d "/data/data/com.termux/files/usr" ]; then
    echo "[1/4] Instalando Node.js LTS, FFmpeg e utilitarios no Termux..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y libc++ openssl zlib nodejs-lts ffmpeg curl
  else
    echo "[ERRO] Node.js e curl sao necessarios para continuar."
    exit 1
  fi
fi

# 2. Preserva dados existentes (WhatsApp conectado, login da conta, uploads e treinamentos)
mkdir -p "$TARGET_APP/data"
for OLD_DIR in "$HOME/atendente-ia-whatsapp" "$HOME/zap-ia-studio"; do
  if [ -d "$OLD_DIR/data" ]; then
    if [ -f "$OLD_DIR/data/cloud_session.json" ] && [ ! -f "$TARGET_APP/data/cloud_session.json" ]; then
      cp -f "$OLD_DIR/data/cloud_session.json" "$TARGET_APP/data/cloud_session.json"
      echo "[OK] Login da conta preservado de $OLD_DIR!"
    fi
    if [ -f "$OLD_DIR/data/database.json" ] && [ ! -f "$TARGET_APP/data/database.json" ]; then
      cp -f "$OLD_DIR/data/database.json" "$TARGET_APP/data/database.json"
    fi
    if [ -d "$OLD_DIR/data/wa_auth" ] && [ ! -d "$TARGET_APP/data/wa_auth" ]; then
      cp -rf "$OLD_DIR/data/wa_auth" "$TARGET_APP/data/wa_auth"
      echo "[OK] Sessao do WhatsApp (wa_auth) preservada sem precisar ler QR Code!"
    fi
    if [ -d "$OLD_DIR/data/uploads" ] && [ ! -d "$TARGET_APP/data/uploads" ]; then
      cp -rf "$OLD_DIR/data/uploads" "$TARGET_APP/data/uploads"
    fi
    if [ -d "$OLD_DIR/data/training_packs" ] && [ ! -d "$TARGET_APP/data/training_packs" ]; then
      cp -rf "$OLD_DIR/data/training_packs" "$TARGET_APP/data/training_packs"
    fi
  fi
  if [ -d "$OLD_DIR/node_modules" ] && [ ! -d "$TARGET_APP/node_modules" ]; then
    echo "[OK] Reaproveitando bibliotecas ja instaladas (atualizacao ultra-rapida)..."
    cp -rf "$OLD_DIR/node_modules" "$TARGET_APP/node_modules" 2>/dev/null || true
  fi
done

echo "[1/3] Baixando versao mais recente do Motor em $BASE_URL..."
curl -fsSL "$BASE_URL/api/public/motor-update.zip" -o "$TMP_ZIP"

echo "[2/3] Atualizando arquivos do sistema (preservando seu WhatsApp e sua conta)..."
node - "$TMP_ZIP" "$HOME" << 'EOF_NODE'
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const zipPath = process.argv[2];
const destRoot = process.argv[3];
const buf = fs.readFileSync(zipPath);

if (buf.length < 22) throw new Error('Pacote ZIP invalido.');
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd === -1) throw new Error('Central Directory do ZIP nao encontrado.');

const total = buf.readUInt16LE(eocd + 10);
const cdSize = buf.readUInt32LE(eocd + 12);
const cdOffset = buf.readUInt32LE(eocd + 16);
let ptr = cdOffset;
let extracted = 0;

for (let i = 0; i < total && ptr < cdOffset + cdSize; i++) {
  if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Cabecalho ZIP invalido.');
  const method = buf.readUInt16LE(ptr + 10);
  const compSize = buf.readUInt32LE(ptr + 20);
  const nameLen = buf.readUInt16LE(ptr + 28);
  const extraLen = buf.readUInt16LE(ptr + 30);
  const commentLen = buf.readUInt16LE(ptr + 32);
  const localOff = buf.readUInt32LE(ptr + 42);
  const rawName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
  ptr += 46 + nameLen + extraLen + commentLen;

  const cleanRel = rawName.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
  if (!cleanRel || rawName.endsWith('/')) continue;

  const lNameLen = buf.readUInt16LE(localOff + 26);
  const lExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  const slice = buf.subarray(dataStart, dataStart + compSize);
  const content = method === 0 ? slice : zlib.inflateRawSync(slice);

  const outFile = path.join(destRoot, cleanRel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content);
  if (outFile.endsWith('.sh')) {
    try { fs.chmodSync(outFile, 0o755); } catch {}
  }
  extracted += 1;
}

const pkg = JSON.parse(fs.readFileSync(path.join(destRoot, 'ZAP-IA-Studio/sistema/package.json'), 'utf8'));
console.log(`[OK] ${extracted} arquivos atualizados com sucesso para a versao v${pkg.version}!`);
EOF_NODE

rm -f "$TMP_ZIP"

if [ "${ZAPIA_NO_START:-0}" = "1" ]; then
  echo "[3/3] Atualizacao concluida com sucesso (modo teste sem iniciar servidor)."
  exit 0
fi

echo "[3/3] Iniciando Motor ZAP-IA Studio atualizado..."
if [ -d "/data/data/com.termux/files/usr" ]; then
  exec bash "$TARGET_ROOT/INICIAR_NO_TERMUX.sh"
else
  exec bash "$TARGET_ROOT/INICIAR_NO_LINUX.sh"
fi

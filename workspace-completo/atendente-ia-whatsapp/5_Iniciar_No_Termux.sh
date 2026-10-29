#!/data/data/com.termux/files/usr/bin/bash

# Garante que rode da copia instalada no HOME caso exista e o usuario esteja em Downloads
CURRENT_DIR="$(pwd -P)"
case "$CURRENT_DIR" in
  */storage/*|/sdcard/*|/storage/*)
    if [ -d "$HOME/ZAP-IA-Studio/node_modules" ]; then
      cd "$HOME/ZAP-IA-Studio"
    fi
    ;;
esac

echo "=============================================================="
echo "  IENVIA — RODANDO 24H NO ANDROID (TERMUX)"
echo "=============================================================="

# Ativa o Wake-Lock para o Android nao derrubar o robo com a tela apagada!
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "[OK] Wake-Lock ativado! O robo continuara rodando com a tela desligada."
fi

if [ ! -d "node_modules" ]; then
  echo "Instalando pacotes na primeira execucao..."
  npm install --legacy-peer-deps --no-bin-links --no-audit --no-fund
fi

# Descobre IP na rede Wi-Fi caso queira abrir o painel pelo PC!
WIFI_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n 1)

echo ""
echo "👉 No proprio celular, abra o Chrome em: http://localhost:3000"
if [ -n "$WIFI_IP" ]; then
  echo "👉 Ou pelo PC no mesmo Wi-Fi, acesse:   http://$WIFI_IP:3000"
fi
echo ""
echo "DICA: Para conectar o WhatsApp neste mesmo celular sem outro aparelho,"
echo "use a opcao 'Codigo de 8 digitos' na aba Conexao & Painel!"
echo "=============================================================="
echo ""

# Garante instancia unica REAL (encerra qualquer loop antigo de outra aba + node antigo sem pkill -f)
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

# Loop de auto-recuperacao blindado 24/7 + Auto-Update automatico na abertura
while true; do
  CUR_WPID=$(cat "data/.wrapper.pid" 2>/dev/null || echo "$$")
  if [ "$CUR_WPID" != "$$" ]; then
    break
  fi
  if [ -f "scripts/auto_update_boot.mjs" ]; then
    node --dns-result-order=ipv4first scripts/auto_update_boot.mjs || true
  fi
  node --dns-result-order=ipv4first src/server.js
  EXIT_CODE=$?
  CUR_WPID=$(cat "data/.wrapper.pid" 2>/dev/null || echo "$$")
  if [ "$CUR_WPID" != "$$" ]; then
    break
  fi
  if [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 0 ]; then
    break
  fi
  echo "[AUTO-RECUPERACAO] Reiniciando motor em 3 segundos (codigo $EXIT_CODE | Ctrl+C para parar)..."
  sleep 3
done

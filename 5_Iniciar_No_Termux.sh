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
echo "  ZAP-IA STUDIO — RODANDO 24H NO ANDROID (TERMUX)"
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

# Abre o painel automaticamente no navegador do Android APENAS se a conta ja estiver vinculada
# (Na 1a execucao, mantem o foco aqui no Termux para o assistente guiado de Usuario/Senha + Codigo de 8 digitos!)
if [ -f "data/cloud_session.json" ] && command -v termux-open-url >/dev/null 2>&1; then
  (sleep 3 && termux-open-url "http://localhost:3000") &
fi

# Garante instancia unica (evita conflito 440 caso outra aba antiga estivesse aberta)
pkill -f "src/server.js" 2>/dev/null || true
sleep 1

# Loop de auto-recuperacao caso o processo reinicie
while true; do
  node src/server.js
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 130 ] || [ "$EXIT_CODE" -eq 143 ]; then
    break
  fi
  echo "[AVISO] Processo encerrado (codigo $EXIT_CODE). Reiniciando em 4 segundos (Ctrl+C para parar)..."
  sleep 4
done

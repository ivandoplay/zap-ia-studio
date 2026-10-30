#!/usr/bin/env bash
# Script de teste Evolution Go — envio e recebimento entre 2 números

BASE_URL="https://pool-evolution-go-025.cloud2.pageup.dev.br"

# Função: listar instâncias
list_instances() {
  echo "=== Instâncias ==="
  curl -s -X GET "$BASE_URL/instance/all" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for i in doc.get('data', []):
    print(f\"  {i['name']:25} | {i['jid']:35} | connected={i['connected']}\")
"
}

# Função: enviar mensagem de texto
send_text() {
  local INSTANCE_NAME="$1"
  local DEST_NUMBER="$2"
  local MESSAGE="$3"
  local TOKEN
  
  # Pegar token da instância
  TOKEN=$(curl -s -X GET "$BASE_URL/instance/all" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for i in doc.get('data', []):
    if i['name'] == '$INSTANCE_NAME':
        print(i['token'])
        break
")
  
  echo "=== Enviando mensagem de $INSTANCE_NAME para $DEST_NUMBER ==="
  curl -s -X POST "$BASE_URL/send/text" \
    -H "apikey: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
    \"number\": \"$DEST_NUMBER\",
    \"text\": \"$MESSAGE\"
  }" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
if 'error' in doc:
    print('  ❌ ERRO:', doc['error'])
else:
    print('  ✅ Mensagem enviada!')
    print('  Chat:', doc['data']['Info']['Chat'])
    print('  Sender:', doc['data']['Info']['Sender'])
    print('  MessageID:', doc['data']['Info']['ID'])
"
}

# Função: enviar mensagem de mídia (imagem)
send_media() {
  local INSTANCE_NAME="$1"
  local DEST_NUMBER="$2"
  local MEDIA_URL="$3"
  local CAPTION="$4"
  local TOKEN
  
  TOKEN=$(curl -s -X GET "$BASE_URL/instance/all" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for i in doc.get('data', []):
    if i['name'] == '$INSTANCE_NAME':
        print(i['token'])
        break
")
  
  echo "=== Enviando mídia de $INSTANCE_NAME para $DEST_NUMBER ==="
  curl -s -X POST "$BASE_URL/send/media" \
    -H "apikey: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
    \"number\": \"$DEST_NUMBER\",
    \"type\": \"image\",
    \"url\": \"$MEDIA_URL\",
    \"caption\": \"$CAPTION\"
  }" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
if 'error' in doc:
    print('  ❌ ERRO:', doc['error'])
else:
    print('  ✅ Mídia enviada!')
"
}

# Função: ver logs da instância
get_logs() {
  local INSTANCE_NAME="$1"
  local INSTANCE_ID
  
  INSTANCE_ID=$(curl -s -X GET "$BASE_URL/instance/all" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for i in doc.get('data', []):
    if i['name'] == '$INSTANCE_NAME':
        print(i['id'])
        break
")
  
  echo "=== Logs de $INSTANCE_NAME ==="
  curl -s -X GET "$BASE_URL/instance/logs/$INSTANCE_ID" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -m json.tool 2>&1 | head -20
}

# Função: status da instância
get_status() {
  local INSTANCE_NAME="$1"
  local TOKEN
  
  TOKEN=$(curl -s -X GET "$BASE_URL/instance/all" \
    -H "apikey: de641771b68731fb4340696241bd2cd6" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for i in doc.get('data', []):
    if i['name'] == '$INSTANCE_NAME':
        print(i['token'])
        break
")
  
  echo "=== Status de $INSTANCE_NAME ==="
  curl -s -X GET "$BASE_URL/instance/status" \
    -H "apikey: $TOKEN" | python3 -m json.tool 2>&1 | head -20
}

# Menu
echo "🔄 Teste Evolution Go"
echo "====================="
echo ""
echo "Instâncias conectadas:"
list_instances
echo ""
echo "Opções:"
echo "1. Enviar mensagem de texto"
echo "2. Enviar mídia (imagem)"
echo "3. Ver logs da instância"
echo "4. Ver status da instância"
echo "5. Sair"
echo ""
read -p "Escolha uma opção (1-5): " OPTION

if [ "$OPTION" = "1" ]; then
  read -p "Nome da instância (ex: ienvia-teste-06a36777): " INSTANCE
  read -p "Número de destino (ex: 558681303979): " DEST
  read -p "Mensagem: " MSG
  send_text "$INSTANCE" "$DEST" "$MSG"
elif [ "$OPTION" = "2" ]; then
  read -p "Nome da instância: " INSTANCE
  read -p "Número de destino: " DEST
  read -p "URL da mídia: " MEDIA
  read -p "Caption (opcional): " CAP
  send_media "$INSTANCE" "$DEST" "$MEDIA" "$CAP"
elif [ "$OPTION" = "3" ]; then
  read -p "Nome da instância: " INSTANCE
  get_logs "$INSTANCE"
elif [ "$OPTION" = "4" ]; then
  read -p "Nome da instância: " INSTANCE
  get_status "$INSTANCE"
fi

echo ""
echo "✅ Teste concluído!"

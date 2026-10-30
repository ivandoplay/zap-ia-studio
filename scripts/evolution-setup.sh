#!/usr/bin/env bash
# Setup Evolution Go + Ienvia Motor
# Configurar webhookUrl nas instâncias conectadas + teste de envio/recebimento
#
# Uso:
#   ./evolution-setup.sh [WEBHOOK_URL]
# Exemplo:
#   ./evolution-setup.sh http://177.54.160.1:3001/webhook
#
# O webhook URL deve ser a URL PÚBLICA onde o servidor webhook está rodando
# (no VPS do cliente, após deploy com docker compose).

set -u

BASE_URL="${EVOLUTION_GO_URL:-https://pool-evolution-go-025.cloud2.pageup.dev.br}"
API_KEY="${EVOLUTION_GO_API_KEY:-de641771b68731fb4340696241bd2cd6}"

echo "🔧 Setup Evolution Go + Ienvia Motor"
echo "=============================================="

# 1. Obter webhook URL (argv > env > pergunta)
if [ -n "${1:-}" ]; then
  WEBHOOK_URL="$1"
elif [ -n "${WEBHOOK_URL:-}" ]; then
  WEBHOOK_URL="${WEBHOOK_URL}"
else
  read -r -p "URL pública do webhook (ex: http://vps-ip:3001/webhook): " WEBHOOK_URL
fi

if [ -z "${WEBHOOK_URL:-}" ]; then
  echo "❌ URL do webhook não informada"
  exit 1
fi

echo "Webhook URL: $WEBHOOK_URL"
echo ""

# 2. Verificar webhook server local (health)
echo "🔍 Verificando webhook server (localhost:3001)..."
if curl -sf --max-time 5 http://localhost:3001/health >/dev/null 2>&1; then
  echo "  ✅ Servidor respondendo"
else
  echo "  ⚠️  Servidor não responde em localhost:3001"
  echo "     Rode: docker compose up -d (na máquina onde o projeto está)"
fi
echo ""

# 3. Listar instâncias conectadas
echo "🔍 Instâncias conectadas:"
INSTANCES=$(curl -s -X GET "$BASE_URL/instance/all" \
  -H "apikey: $API_KEY" | python3 -c "
import json, sys
try:
    doc = json.load(sys.stdin)
    for i in doc.get('data', []):
        if i.get('connected'):
            print(f\"{i['name']}|{i['jid']}|{i['token']}\")
except Exception as e:
    print('ERR:' + str(e), file=sys.stderr)
")

if [ -z "$INSTANCES" ]; then
  echo "  ❌ Nenhuma instância conectada no Evolution Go"
  exit 1
fi

echo "$INSTANCES" | while IFS='|' read -r name jid token; do
  echo "  ✅ $name ($jid)"
done
echo ""

# 4. Configurar webhookUrl em cada instância
#    Endpoint /instance/connect usa o TOKEN DA INSTÂNCIA no header apikey
echo "🔧 Configurando webhookUrl nas instâncias..."
COUNT=0
while IFS='|' read -r name jid token; do
  RESP=$(curl -s -X POST "$BASE_URL/instance/connect" \
    -H "apikey: $token" \
    -H "Content-Type: application/json" \
    -d "{
      \"phone\": \"$jid\",
      \"immediate\": true,
      \"subscribe\": [\"MESSAGE\"],
      \"webhookUrl\": \"$WEBHOOK_URL\"
    }")

  if echo "$RESP" | grep -q '"success"'; then
    echo "  ✅ $name — webhook configurado (eventos MESSAGE)"
    COUNT=$((COUNT + 1))
  else
    echo "  ❌ $name — resposta: $RESP"
  fi
done <<< "$INSTANCES"
echo ""

if [ "$COUNT" -eq 0 ]; then
  echo "❌ Nenhuma instância foi configurada"
  exit 1
fi

# 5. Testar envio de mensagem (instância 1 → número da instância 2)
echo "📨 Teste de envio entre instâncias..."
FIRST=$(echo "$INSTANCES" | head -1)
FIRST_NAME=$(echo "$FIRST" | cut -d'|' -f1)
FIRST_TOKEN=$(echo "$FIRST" | cut -d'|' -f3)
SECOND=$(echo "$INSTANCES" | sed -n '2p')

if [ -n "$SECOND" ]; then
  SECOND_NUMBER=$(echo "$SECOND" | cut -d'|' -f2 | cut -d':' -f1)
  RESP=$(curl -s -X POST "$BASE_URL/send/text" \
    -H "apikey: $FIRST_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"number\": \"$SECOND_NUMBER\",
      \"text\": \"✅ Setup concluído — Evolution Go + Ienvia Motor! Webhook configurado em $WEBHOOK_URL\"
    }")
  echo "$RESP" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
if doc.get('message') == 'success':
    print('  ✅ Mensagem enviada da instância ' + '$FIRST_NAME' + ' para ' + '$SECOND_NUMBER')
else:
    print('  ❌ Erro:', doc.get('error', 'unknown'))
"
else
  echo "  ⚠️  Apenas 1 instância conectada — envie manualmente:"
  echo "     curl -X POST $BASE_URL/send/text -H \"apikey: <token>\" -d '{\"number\":\"<numero>\",\"text\":\"teste\"}'"
fi
echo ""

# 6. Resumo
echo "✅ Setup concluído!"
echo "   Webhook URL: $WEBHOOK_URL"
echo "   Instâncias configuradas: $COUNT"
echo ""
echo "Próximo passo:"
echo "  1. No WhatsApp, mande uma mensagem para qualquer número da instância"
echo "  2. A IA do Ienvia Motor responderá automaticamente (via webhook)"
echo "  3. Caso não responda, veja os logs: docker logs ienvia-evolution-webhook"

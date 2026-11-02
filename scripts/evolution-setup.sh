#!/usr/bin/env bash
# Configura o webhook das instâncias Evolution API v2 existentes.
# Requer EVOLUTION_API_URL, EVOLUTION_API_KEY e uma URL pública para o webhook.
set -euo pipefail

BASE_URL="${EVOLUTION_API_URL:-https://pool-evolution-api-067.cloud2.pageup.dev.br}"
API_KEY="${EVOLUTION_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "Defina EVOLUTION_API_KEY no ambiente; não coloque a chave em arquivos do repositório."
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  WEBHOOK_URL="$1"
elif [[ -n "${WEBHOOK_URL:-}" ]]; then
  WEBHOOK_URL="$WEBHOOK_URL"
else
  read -r -p "URL pública completa do webhook: " WEBHOOK_URL
fi
if [[ -z "$WEBHOOK_URL" ]]; then echo "URL do webhook não informada."; exit 1; fi

export BASE_URL API_KEY WEBHOOK_URL
python3 <<'PY'
import json, os, urllib.request, urllib.error, urllib.parse
base = os.environ['BASE_URL'].rstrip('/')
key = os.environ['API_KEY']
hook = os.environ['WEBHOOK_URL']
events = ['APPLICATION_STARTUP','QRCODE_UPDATED','CONNECTION_UPDATE','MESSAGES_UPSERT','MESSAGES_UPDATE','SEND_MESSAGE','CONTACTS_UPDATE','CHATS_UPDATE']
req = urllib.request.Request(base + '/instance/fetchInstances', headers={'apikey': key})
try:
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode())
except Exception as exc:
    raise SystemExit(f'Falha ao consultar Evolution API: {exc}')
rows = payload if isinstance(payload, list) else payload.get('instances') or payload.get('data') or payload.get('response') or []
instances = []
for row in rows:
    obj = row.get('instance') if isinstance(row.get('instance'), dict) else row
    name = obj.get('instanceName') or obj.get('name')
    if name and name.startswith('zap-ia-slot_'):
        instances.append(name)
if not instances:
    raise SystemExit('Nenhuma instância zap-ia-slot_* encontrada. Crie/pareie os slots pelo painel primeiro.')
for name in instances:
    body = {'webhook': {'enabled': True, 'url': hook, 'byEvents': False, 'base64': True, 'events': events}}
    data = json.dumps(body).encode()
    req = urllib.request.Request(base + '/webhook/set/' + urllib.parse.quote(name, safe=''), data=data, method='POST', headers={'apikey': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            response.read()
        print(f'Webhook configurado para {name}.')
    except urllib.error.HTTPError as exc:
        print(f'Falha ao configurar {name}: HTTP {exc.code}')
PY

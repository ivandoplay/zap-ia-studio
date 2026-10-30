#!/usr/bin/env bash
# ============================================================================
# Ienvia Motor — Provisionamento Automático Oracle Cloud Always Free
# Uso: ./oracle-provision.sh [NOME_DA_INSTANCIA]
# Requer: Oracle CLI (oci) autenticado, SSH key pré-criada
# ============================================================================
set -euo pipefail

INSTANCE_NAME="${1:-ienvia-motor-$(date +%s)}"
OCI_CONFIG="${OCI_CONFIG:-~/.oci/config}"
IMAGE_OCID="ocid1.image.oc1.iad.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
# Substituir com a OCID da imagem Node.js ou Ubuntu 22.04 da Oracle
# Buscar: oci compute images list --compartment-id <compartment> --query "data[?contains(@.displayName, 'Node')].ocid"

SSH_KEY_PATH="${SSH_KEY_PATH:-~/.ssh/id_rsa.pub}"
SSH_KEY_FINGERPRINT="${SSH_KEY_FINGERPRINT:-}"

# Dados Supabase (centralizados — não mudam por instância)
SUPABASE_URL="${SUPABASE_URL:-https://iuysmojhaxplnhfrxqkv.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"

echo "============================================"
echo "  Ienvia Motor — Oracle Cloud Always Free"
echo "============================================"
echo ""
echo "Instância: $INSTANCE_NAME"
echo "Região:    ${OCI_REGION:-us-ashburn-1}"
echo ""

# 1. Gerar chave SSH se não existir
if [ ! -f "$SSH_KEY_PATH" ]; then
  echo "[1/6] Gerando chave SSH..."
  ssh-keygen -t rsa -b 4096 -f "$SSH_KEY_PATH" -N "" -q
  SSH_KEY_FINGERPRINT=$(ssh-keygen -lf "$SSH_KEY_PATH" | awk '{print $2}')
else
  echo "[1/6] Chave SSH já existe: $SSH_KEY_PATH"
  SSH_KEY_FINGERPRINT=$(ssh-keygen -lf "$SSH_KEY_PATH" | awk '{print $2}')
fi
echo "      Fingerprint: $SSH_KEY_FINGERPRINT"

# 2. Criar instância Always Free (Ampere A1, 4 OCPU, 24GB RAM)
echo ""
echo "[2/6] Criando instância Always Free (Ampere A1)..."
INSTANCE_OCID=$(oci compute instance launch \
  --config "$OCI_CONFIG" \
  --name "$INSTANCE_NAME" \
  --image-id "$IMAGE_OCID" \
  --shape "VM.Standard.A2.Flex" \
  --availability-domain "${OCI_AD:-KxGv:US-ASHBURN-1-AD1}" \
  --compartment-id "${OCI_COMPARTMENT:-}" \
  --ssh-authorized-keys-file "$SSH_KEY_PATH" \
  --display-name "$INSTANCE_NAME" \
  --query 'data.id' --raw-output 2>/dev/null || true)

if [ -z "$INSTANCE_OCID" ]; then
  echo "      Erro: não foi possível criar a instância."
  echo "      Verifique: oci compute instance launch --help"
  exit 1
fi
echo "      OCID: $INSTANCE_OCID"

# 3. Aguardar a instância ficar RUNNING
echo ""
echo "[3/6] Aguardando instância ficar RUNNING..."
oci compute instance wait --config "$OCI_CONFIG" \
  --instance-id "$INSTANCE_OCID" \
  --timeout 600 2>/dev/null || true

# 4. Pegar IP público
echo ""
echo "[4/6] Obtendo IP público..."
PUBLIC_IP=$(oci compute instance list \
  --config "$OCI_CONFIG" \
  --compartment-id "${OCI_COMPARTMENT:-}" \
  --query "data[?displayName=='$INSTANCE_NAME'].network[0].publicIp" \
  --raw-output 2>/dev/null | head -1 || true)

if [ -z "$PUBLIC_IP" ]; then
  # Tentar obter via SSH (pode demorar)
  echo "      IP não encontrado via API. Aguardando DNS..."
  sleep 30
  PUBLIC_IP=$(dig +short "$INSTANCE_NAME" @oracle-dns.us-ashburn-1.oraclecloud.com 2>/dev/null || true)
fi
echo "      IP público: $PUBLIC_IP"

# 5. Instalar Docker e clonar o motor
echo ""
echo "[5/6] Configurando Docker na instância..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$PUBLIC_IP" <<'REMOTE'
  set -euo pipefail

  # Atualizar pacotes
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git

  # Instalar Docker
  if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
  fi

  # Clonar repositório (ou copiar via scp)
  if [ ! -d /opt/ienvia-motor ]; then
    mkdir -p /opt/ienvia-motor
    cd /opt/ienvia-motor
    git clone --depth 1 https://github.com/ivandoplay/zap-ia-studio.git .
    npm ci --omit=dev
  fi

  # Criar .env com credenciais
  cat > /opt/ienvia-motor/.env <<EOF
PORT=3000
VERCEL=
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
GEMINI_API_KEY=${GEMINI_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
EOF

  # Criar volume para dados
  mkdir -p /opt/ienvia-motor/data

  # Iniciar motor
  cd /opt/ienvia-motor
  docker compose up -d --build
REMOTE

echo "      Docker configurado e motor iniciado."

# 6. Verificar saúde
echo ""
echo "[6/6] Verificando saúde do motor..."
sleep 10
HEALTH=$(curl -sf "http://$PUBLIC_IP:3000/health" 2>/dev/null || true)
if [ -n "$HEALTH" ]; then
  echo "      ✅ Motor online: $HEALTH"
  echo ""
  echo "============================================"
  echo "  Deploy concluído!"
  echo "============================================"
  echo ""
  echo "  Painel:      http://$PUBLIC_IP:3000"
  echo "  Healthcheck: http://$PUBLIC_IP:3000/health"
  echo ""
  echo "  Para acessar: abra http://$PUBLIC_IP:3000 no navegador"
  echo "  e faça login com seu usuário (ex: jeffersonivan)"
  echo ""
  echo "  Para conectar WhatsApp: abra o painel e siga o fluxo QR Code"
  echo "  (o motor local rodará o Baileys com WebSocket na mesma VM)"
  echo ""
else
  echo "      ⚠️ Motor ainda inicializando. Aguarde 30s e tente novamente:"
  echo "      curl http://$PUBLIC_IP:3000/health"
  echo ""
  echo "  SSH: ssh -i $SSH_KEY_PATH root@$PUBLIC_IP"
  echo "  Logs: docker compose logs -f (via SSH)"
fi

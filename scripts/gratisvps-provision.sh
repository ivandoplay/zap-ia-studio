#!/usr/bin/env bash
# ============================================================
# Ienvia Motor — Provisionamento em GratisVPS (Free, sem cartão)
# ============================================================
#
# Uso:
#   ./scripts/gratisvps-provision.sh <nome-instancia>
#
# Ex:
#   ./scripts/gratisvps-provision.sh ienvia-motor-cliente1
#
# O script:
#   1. Pede o IP da VPS (ou detecta se já está na VPS)
#   2. Conecta via SSH
#   3. Instala Docker
#   4. Clona o repositório
#   5. Configurar .env
#   6. Inicia o motor via docker compose
#
# Pré-requisitos:
#   - Chave SSH (~/.ssh/id_rsa)
#   - Conta GratisVPS criada (IP da VPS disponível)
#   - Credenciais Supabase e IA (para .env)
# ============================================================

set -euo pipefail

INSTANCE_NAME="${1:-ienvia-motor}"
REPO_URL="${REPO_URL:-https://github.com/ivandoplay/atendente-ia-whatsapp.git}"
INSTALL_DIR="/opt/${INSTANCE_NAME}"
PORT=3000

echo "=========================================="
echo "  Ienvia Motor — Provisionamento GratisVPS"
echo "=========================================="
echo ""

# --- 1. Detectar IP ---
echo "==> Passo 1: Detectar IP da VPS"

# Se já está na VPS (root), usar o IP local
if [ "$(id -u)" -eq 0 ]; then
    VPS_IP=$(hostname -I | awk '{print $1}')
    echo "   Detectado IP local: $VPS_IP (já está na VPS)"
    SSH_CONNECT=""
else
    echo ""
    echo "   Digite o IP da VPS do GratisVPS:"
    read -rp "   IP: " VPS_IP
    SSH_CONNECT="ssh -i ~/.ssh/id_rsa root@${VPS_IP}"
fi

if [ -z "${VPS_IP}" ]; then
    echo "   Erro: IP não informado."
    exit 1
fi

echo "   IP: $VPS_IP"
echo ""

# --- 2. Testar conexão SSH ---
echo "==> Passo 2: Testar conexão SSH"

if [ -n "${SSH_CONNECT}" ]; then
    ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -i ~/.ssh/id_rsa root@"${VPS_IP}" "echo OK" 2>/dev/null || {
        echo "   Erro: não foi possível conectar via SSH."
        echo "   Verifique:"
        echo "     - Chave SSH pública adicionada no GratisVPS"
        echo "     - VPS ativa e com IP correto"
        echo "     - Firewall/porta 22 aberta"
        exit 1
    }
    echo "   Conexão OK"
else
    echo "   Conexão local (já na VPS)"
fi

echo ""

# --- 3. Instalar Docker ---
echo "==> Passo 3: Instalar Docker na VPS"

if [ -n "${SSH_CONNECT}" ]; then
    ${SSH_CONNECT} '
        set -e
        if command -v docker &> /dev/null; then
            echo "   Docker já instalado: $(docker --version)"
        else
            echo "   Instalando Docker..."
            curl -fsSL https://get.docker.com | sudo sh
            echo "   Docker instalado: $(docker --version)"
        fi

        if ! sudo usermod -aG docker "$(whoami)" 2>/dev/null; then
            echo "   Usuário já no grupo docker"
        fi
    '
else
    if command -v docker &> /dev/null; then
        echo "   Docker já instalado: $(docker --version)"
    else
        echo "   Instalando Docker..."
        curl -fsSL https://get.docker.com | sudo sh
        echo "   Docker instalado: $(docker --version)"
    fi
fi

echo ""

# --- 4. Clonar repositório ---
echo "==> Passo 4: Clonar repositório"

if [ -n "${SSH_CONNECT}" ]; then
    ${SSH_CONNECT} '
        set -e
        if [ -d "'"${INSTALL_DIR}"'" ]; then
            echo "   Diretório já existe, atualizando..."
            cd "'"${INSTALL_DIR}"'"
            git pull
        else
            mkdir -p "'"$(dirname "${INSTALL_DIR}")'"
            git clone "'"${REPO_URL}"'" "'"${INSTALL_DIR}"'"
            cd "'"${INSTALL_DIR}"'"
        fi
        echo "   Repositório em: $(pwd)"
    '
else
    if [ -d "${INSTALL_DIR}" ]; then
        echo "   Diretório já existe, atualizando..."
        cd "${INSTALL_DIR}"
        git pull
    else
        mkdir -p "$(dirname "${INSTALL_DIR}")"
        git clone "${REPO_URL}" "${INSTALL_DIR}"
        cd "${INSTALL_DIR}"
    fi
    echo "   Repositório em: $(pwd)"
fi

echo ""

# --- 5. Configurar .env ---
echo "==> Passo 5: Configurar .env"

echo ""
echo "   Preencha as credenciais abaixo:"
echo "   (As credenciais Supabase e IA são as mesmas usadas no Vercel)"
echo ""

read -rp "   Supabase URL (https://xxx.supabase.co): " SUPABASE_URL
read -rp "   Supabase Service Role Key: " SUPABASE_SR_KEY
read -rp "   Gemini API Key: " GEMINI_KEY
read -rp "   OpenRouter API Key: " OPENROUTER_KEY

ENV_CONTENT="# Ienvia Motor — ambiente deploy GratisVPS
NODE_ENV=production
PORT=3000
IS_VERCEL=false

# Supabase
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SR_KEY}

# IA
GEMINI_API_KEY=${GEMINI_KEY}
OPENROUTER_API_KEY=${OPENROUTER_KEY}

# Slots WhatsApp
WA_SLOT_IDS=slot_1,slot_2,slot_3
"

if [ -n "${SSH_CONNECT}" ]; then
    # Escrever .env via SSH
    echo "${ENV_CONTENT}" | ${SSH_CONNECT} "cat > ${INSTALL_DIR}/.env"
    echo "   .env criado em ${INSTALL_DIR}/.env"
else
    echo "${ENV_CONTENT}" > .env
    echo "   .env criado em $(pwd)/.env"
fi

echo ""

# --- 6. Iniciar motor ---
echo "==> Passo 6: Iniciar motor via Docker Compose"

if [ -n "${SSH_CONNECT}" ]; then
    ${SSH_CONNECT} '
        set -e
        cd "'"${INSTALL_DIR}"'"
        mkdir -p data
        docker compose build
        docker compose up -d
        echo ""
        echo "   Status:"
        docker compose ps
        echo ""
        echo "   Logs (últimos 10):"
        docker compose logs --tail=10
    '
else
    mkdir -p data
    docker compose build
    docker compose up -d
    echo ""
    echo "   Status:"
    docker compose ps
    echo ""
    echo "   Logs (últimos 10):"
    docker compose logs --tail=10
fi

echo ""
echo "=========================================="
echo "  ✅ Provisionamento concluído!"
echo "=========================================="
echo ""
echo "  Painel:      http://${VPS_IP}:${PORT}"
echo "  Healthcheck: http://${VPS_IP}:${PORT}/health"
echo ""
echo "  Para conectar WhatsApp:"
echo "    1. Abra o painel no navegador"
echo "    2. Faça login"
echo "    3. Na aba Início & Conexão, escaneie o QR Code"
echo ""
echo "  ⚠️  Atenção: plano gratuito tem IPv4 COMPARTILHADO"
echo "     Se o WhatsApp não conectar, compra IPv4 dedicado (~$1-2/mês)"
echo ""
echo "  Atualizações futuras:"
echo "    cd ${INSTALL_DIR} && git pull && docker compose build && docker compose up -d"
echo ""

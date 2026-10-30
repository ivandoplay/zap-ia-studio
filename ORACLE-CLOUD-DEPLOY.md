# Ienvia Motor — Deploy em Oracle Cloud Always Free

Oracle Cloud Always Free oferece **4 OCPU ARM (Ampere A1), 24GB RAM, 200GB armazenamento** — suficiente para rodar o motor do WhatsApp de um cliente.

## Arquitetura

```
┌─────────────────────────────────────────────┐
│  Oracle Cloud Always Free (VM Ampere A1)    │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Docker Container (Ienvia Motor)      │   │
│  │  - Node.js 20 (server.js)            │   │
│  │  - Baileys (WhatsApp WebSocket)      │   │
│  │  - WebSocket /ws                      │   │
│  │  - ffmpeg (áudio OGG/Opus)           │   │
│  └──────────────────────────────────────┘   │
│  Volume: ./data (SQLite + auth + uploads)   │
└─────────────────────────────────────────────┘
          │ HTTP/WebSocket
          ▼
┌─────────────────────────────────────────────┐
│  Supabase (centralizado)                     │
│  - RLS multi-tenant (dados por cliente)      │
│  - Auth (login painel)                       │
│  - Mídia de campanhas (bucket privado)       │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  IA: Gemini (áudio) + OpenRouter (texto)     │
└─────────────────────────────────────────────┘
```

## Pré-requisitos

1. **Conta Oracle Cloud** (gratuita — [oci.com](https://www.oracle.com/cloud/free/))
   - Requer cartão de crédito para verificação (não cobra)
   - Email e telefone válidos
2. **CLI Oracle (OCI)** instalado e autenticado
3. **Chave SSH** (gerada automaticamente pelo script)
4. **Repositório público** (ou acesso via SSH)

## Passo 1: Criar conta Oracle Cloud

1. Acesse [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
2. Clique em "Start for free"
3. Preencha dados pessoais, email, telefone
4. Confirme via SMS/email
5. **Adicione método de pagamento** (cartão de crédito — verificação apenas, não cobra)
6. Escolha a região mais próxima (para Brasil: `us-ashburn-1` ou `sa-vinaupp-1`)
7. Ative a Always Free instance

## Passo 2: Instalar CLI Oracle

```bash
# Linux (Ubuntu/Debian)
sudo apt-get update && sudo apt-get install -y apt-transport-https
curl -fsSL https://yum.oracle.com/oracle-cli.rpm | sudo rpm -ivh --nodeps

# Ou via pip
pip install oci

# Autenticar
oci setup config
# Seguir o wizard: escolher região, compartment, gerar chave API
```

## Passo 3: Preparar credenciais

```bash
cd atendente-ia-whatsapp

# Copiar template de env
cp .env.oracle.example .env

# Preencher Supabase e IA (mesmas credenciais usadas no Vercel)
nano .env
```

## Passo 4: Provisionar via script (recomendado)

```bash
# Garantir que o script é executável
chmod +x scripts/oracle-provision.sh

# Rodar o script (cria instância + instala Docker + clona repo + inicia motor)
./scripts/oracle-provision.sh ienvia-motor-cliente1

# Script faz tudo:
# 1. Gera chave SSH
# 2. Cria instância Always Free (Ampere A1, 4 OCPU, 24GB RAM)
# 3. Aguarda instância ficar RUNNING
# 4. Obtém IP público
# 5. Instala Docker na VM
# 6. Clona repositório, configura .env, inicia motor via docker compose
```

## Passo 5: Acessar o painel

Após o script terminar:

```
Painel:      http://<IP_PUBLICO>:3000
Healthcheck: http://<IP_PUBLICO>:3000/health
```

Abra no navegador, faça login com seu usuário (ex: `jeffersonivan`) e conecte o WhatsApp pelo QR Code.

## Passo 6: Conectar WhatsApp

1. Abra o painel no navegador
2. Faça login
3. Na aba **Início & Conexão**, clique em "Conectar WhatsApp"
4. Escanei o QR Code com o WhatsApp do cliente
5. O motor Baileys conectará via WebSocket na mesma VM

## Configuração por cliente (multi-instância)

Para cada cliente, repita o processo:

```bash
./scripts/oracle-provision.sh ienvia-motor-luciana
./scripts/oracle-provision.sh ienvia-motor-joao
```

Cada instância tem:
- IP próprio (subdomínio ou IP direto)
- Dados isolados (volume `./data` próprio)
- WhatsApp conectado via QR Code próprio
- Login no Supabase central (RLS isola por conta)

## Atualizações

```bash
# SSH na instância
ssh -i ~/.ssh/id_rsa root@<IP_PUBLICO>

# Atualizar motor
cd /opt/ienvia-motor
git pull
docker compose build
docker compose up -d

# Ver logs
docker compose logs -f
```

## Monitoramento

- **Healthcheck**: `http://<IP>:3000/health` (Docker monitora automaticamente)
- **Logs**: `docker compose logs -f`
- **Status**: painel em `/api/auth/status`

## Custos

Oracle Cloud Always Free:
- **Instância**: 4 OCPU ARM, 24GB RAM — grátis
- **Armazenamento**: 200GB — grátis
- **Network**: 10TB/mes — grátis
- **Sem expiração**: enquanto a conta estiver ativa

## Notas

- O motor roda em **modo local** (`IS_VERCEL=false`), com servidor Node completo (HTTP + WebSocket + Baileys)
- O **Supabase** continua centralizado — dados dos clientes não ficam na VM
- A VM precisa de **DNS público** ou **IP público** para o WhatsApp conectar (o Baileys usa WebSocket ao servidor)
- Para **domínio自定义**: adicione um record A/CNAME na OCI DNS指向IP da VM

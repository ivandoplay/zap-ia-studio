# ⚠️ AVISSO IMPORTANTE — GratisVPS É UM ESQUEMA (SCAM)

**GratisVPS.net não é uma opção legítima.** Revisamos a reputação em 2026-10-30:

- **Trustpilot: 1.9/5** (17 avaliações, maioria "Complete Scam")
- **WOT: 0.9/5** (classificado como fraude/ad-fraude)
- **ScamAdviser: "Very Likely Unsafe"** (trust score 0)
- Reddit/r/VPS: "data-harvesting scam" — VPS nunca ativa, exigiria clicar em anúncios

**Mesmo padrão do FreeVPS.edu.pl que já foi rejeitado.** Não use, não cadastre, não clique.

Este arquivo foi mantido apenas como registro histórico. Para deploy grátis/sem cartão, veja:
- **Oracle Cloud Always Free** (VPS grátis, 4 cores ARM/24GB — mas cadastro exige cartão de crédito para verificação)
- **Vercel** (serverless grátis — webhook como função, sem servidor, sem cartão)

---

# Ienvia Motor — Deploy em GratisVPS (ARQUIVADO — ACESSO EXTINTO POR SCAM)

<details>
<summary>Conteúdo original mantido apenas para registro (Não siga estes passos)</summary>

GratisVPS oferece **2 vCPU, 2GB RAM, NVMe, root SSH** — grátis, sem cartão de crédito, sem expiração fixa.

## ⚠️ Atenção: IPv4 compartilhado

O plano gratuito do GratisVPS usa **IPv4 compartilhado** (shared IPv4) + IPv6 dedicado. Isso pode afetar o WhatsApp:

- **WhatsApp pode bloquear IPs compartilhados** com reputação baixa ou histórico de spam
- O **Baileys (WhatsApp WebSocket)** precisa de um IP que não esteja em listas negras
- Se o WhatsApp não conectar, será necessário **comprar IPv4 dedicado** ($1-2/mês no GratisVPS) ou migrar para outro provedor

**Teste antes de provisionar:** se possível, conecte um número teste primeiro.

## Arquitetura

```
┌─────────────────────────────────────────────┐
│  GratisVPS Free (KVM, 2 vCPU, 2GB RAM)       │
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

1. **Conta GratisVPS** (gratuita — [gratisvps.net](https://gratisvps.net/))
   - Sem cartão de crédito, sem PayPal
   - Apenas email para cadastro
2. **SSH** do seu computador local (Linux/macOS/Windows com WSL)
3. **Repositório público** (GitHub) ou clonado manualmente
4. **Credenciais Supabase e IA** (já usadas no Vercel)

## Passo 1: Criar conta no GratisVPS

1. Acesse [gratisvps.net](https://gratisvps.net/)
2. Clique em **"Get Started"** ou **"Create Account"**
3. Preencha:
   - Email (usado para login)
   - Senha
   - Username
4. **Confirme via email** (clique no link de ativação)
5. Login no painel

## Passo 2: Criar VPS gratuito

1. No painel, clique em **"Create VPS"** ou **"New Server"**
2. Escolha:
   - **Plano**: Free (2 vCPU, 2GB RAM, NVMe)
   - **OS**: Ubuntu 22.04 LTS (recomendado) ou Debian 12
   - **Localização**: United States (mais próximo do Brasil) ou Germany
   - **SSH Key**: Cole sua chave pública SSH (veja Passo 3)
3. Clique em **"Create"** ou **"Deploy"**
4. Aguarde ~1 minuto até a VPS ficar **ACTIVE**
5. Copie o **IP address** (você receberá um IPv4 compartilhado + IPv6)

## Passo 3: Preparar chave SSH local

```bash
# Se já tem chave SSH (~/.ssh/id_rsa), use-a
# Caso contrário, gere uma:
ssh-keygen -t rsa -b 4096 -C "iemvia-motor-gratisvps" -f ~/.ssh/id_rsa -N ""

# Mostrar chave pública (copie esta para o GratisVPS no Passo 2):
cat ~/.ssh/id_rsa.pub
```

## Passo 4: Conectar via SSH

```bash
# Substitua <IP_VPS> pelo IP recebido do GratisVPS
ssh -i ~/.ssh/id_rsa root@<IP_VPS>
```

Se o IP for IPv6, use:
```bash
ssh -i ~/.ssh/id_rsa root@[<IPv6>]
```

## Passo 5: Instalar Docker na VPS

```bash
# Atualizar pacotes
apt-get update && apt-get upgrade -y

# Instalar Docker oficial
curl -fsSL https://get.docker.com | sudo sh

# Adicionar usuário ao grupo docker (opcional, para não usar sudo)
sudo usermod -aG docker $USER

# Ativar grupo docker (relogue)
exec bash

# Verificar Docker
docker --version
docker compose version
```

## Passo 6: Clonar repositório e configurar

```bash
# Dentro da VPS (se ainda não estiver conectado via SSH)
cd /opt

# Clonar repositório (substitua com seu repositório)
git clone https://github.com/<USUARIO>/atendente-ia-whatsapp.git ienvia-motor

cd ienvia-motor

# Copiar template de env
cp .env.oracle.example .env

# Editar .env com suas credenciais
nano .env
```

### Arquivo `.env` — preencher:

```env
# === Ienvia Motor — ambiente deploy VPS ===
NODE_ENV=production
PORT=3000
IS_VERCEL=false

# === Supabase (centralizado — usar credenciais do projeto) ===
SUPABASE_URL=https://<SUPABASE>.supabase.co
SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY>

# === IA — Gemini (áudio) ===
GEMINI_API_KEY=<GEMINI_API_KEY>

# === IA — OpenRouter (texto) ===
OPENROUTER_API_KEY=<OPENROUTER_API_KEY>

# === Opcional ===
WA_SLOT_IDS=slot_1,slot_2,slot_3
```

## Passo 7: Iniciar motor via Docker Compose

```bash
# Criar volume de dados (SQLite + auth + uploads)
mkdir -p data

# Build e start
docker compose build
docker compose up -d

# Verificar status
docker compose ps
docker compose logs -f
```

## Passo 8: Acessar o painel

```
Painel:      http://<IP_VPS>:3000
Healthcheck: http://<IP_VPS>:3000/health
```

Abra no navegador, faça login com seu usuário (ex: `jeffersonivan`) e conecte o WhatsApp pelo QR Code.

## Passo 9: Conectar WhatsApp

1. Abra o painel no navegador
2. Faça login
3. Na aba **Início & Conexão**, clique em **"Conectar WhatsApp"**
4. Escanei o **QR Code** com o WhatsApp do cliente
5. O motor Baileys conectará via WebSocket na mesma VM

## ⚠️ Problemas comuns — IPv4 compartilhado

Se o WhatsApp **não conectar** ou der erro de "phone unauthorized":

### Opção A: Comprar IPv4 dedicado no GratisVPS

1. No painel, vá em **"Add IPv4"** ou **"Upgrade"**
2. Adicione um IPv4 dedicado (~$1-2/mês)
3. Reinicie a VPS
4. Atualize o `.env` se necessário
5. Teste novamente o QR Code

### Opção B: Testar com IPv6

O Baileys pode funcionar com IPv6 se o WhatsApp não bloquear o IPv6 da VPS:
```bash
# Verificar IPv6
ip a | grep inet6

# Testar conexão WebSocket via IPv6
curl -I http://[<IPv6>]:3000/health
```

### Opção C: Migrar para outro provedor

Se o IPv4 compartilhado estiver bloqueado e não quiser pagar:
- Testar Oracle Cloud (24GB RAM, mas requer cartão real)
- Testar VPSServer.com (30 dias grátis, aceita cartão virtual)
- Testar VPSWala (2GB RAM, ARM64, sem cartão)

## Atualizações

```bash
# SSH na VPS
ssh -i ~/.ssh/id_rsa root@<IP_VPS>

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

GratisVPS Free:
- **VPS**: 2 vCPU, 2GB RAM, NVMe — grátis
- **IPv4**: compartilhado (grátis)
- **IPv4 dedicado**: ~$1-2/mês (se necessário para WhatsApp)
- **Backups**: não inclusos no plano free
- **Sem expiração**: enquanto seguir as regras de fair-use

## Recursos do GratisVPS Free

| Recurso | Valor |
|---------|-------|
| CPU | 2 vCPU |
| RAM | 2 GB |
| Storage | NVMe |
| Porta | 100 Mbps compartilhada |
| IPv4 | Compartilhado |
| IPv6 | Dedicado |
| Acesso | Root SSH |
| Virtualização | KVM |
| Regiões | US, Germany, Singapore |

## Notas

- O motor roda em **modo local** (`IS_VERCEL=false`), com servidor Node completo (HTTP + WebSocket + Baileys)
- O **Supabase** continua centralizado — dados dos clientes não ficam na VPS
- A VPS precisa de **IP público** para o WhatsApp conectar (o Baileys usa WebSocket ao servidor)
- **IPv4 compartilhado é o maior risco** — o WhatsApp pode bloquear IPs com reputação baixa
- Para **dominio próprio**: adicione um record A/CNAME na DNS do seu domínio apontando para o IP da VPS

</details>

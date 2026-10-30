# Ienvia Motor — Guia do Evolution Go

Análise completa do **Evolution Go** — a versão em Go do Evolution API, com comparação com o Evolution API (Node.js) e o Ienvia Motor atual.

## O que é o Evolution Go?

**Evolution Go** é uma **API REST para WhatsApp escrita em Go**, mantida pela **Evolution Foundation**. Ele é a versão "alta performance" do Evolution API, usando o **whatsmeow** (lib em Go) em vez do Baileys (lib em Node.js).

- **GitHub**: https://github.com/evolution-foundation/evolution-go
- **Stars**: ~935 (em crescimento)
- **Licença**: Apache 2.0
- **Documentação**: https://docs.evolutionfoundation.com.br
- **Docker Hub**: evoapicloud/evolution-go

## Diferenças: Evolution Go vs Evolution API (Node.js)

| Característica | **Evolution API** (Node.js) | **Evolution Go** (Go) |
|----------------|----------------------------|----------------------|
| **Linguagem** | Node.js 20+ | **Go 1.24+** ✅ |
| **WhatsApp library** | Baileys (TypeScript) | **whatsmeow** (Go) ✅ |
| **HTTP framework** | Express.js | **Gin** ✅ |
| **ORM** | Prisma | **GORM** ✅ |
| **MQ** | RabbitMQ, Kafka, SQS, NATS | **RabbitMQ, NATS** |
| **Storage** | PostgreSQL, MySQL | **PostgreSQL** |
| **Object storage** | S3, MinIO | **S3, MinIO** |
| **RAM por instância** | ~200-500MB | **~50-150MB** ✅✅ |
| **Início** | ~5-10s | **< 1s** ✅✅ |
| **Imagem Docker** | ~1GB (Node + deps) | **~50-100MB** ✅✅ |
| **Concorrência** | Event loop (single-thread) | **Goroutines** ✅✅ |
| **Licensing** | A partir da v2.4.0 | **Built-in** (integrado) |
| **API compatível** | — | **Compatível com Evolution API** ✅ |

## Comparação: Ienvia Motor vs Evolution Go

| Característica | **Ienvia Motor** (atual) | **Evolution Go** |
|----------------|-------------------------|------------------|
| **Base** | Baileys direto (customizado) | whatsmeow + REST API |
| **Linguagem** | Node.js 20 | **Go** (mais leve) ✅ |
| **RAM por conta** | ~100-150MB | **~50MB** ✅✅ |
| **Multi-instância** | Manual (1 processo/conta) | **Nativo** ✅ |
| **Webhooks** | WebSocket próprio | **HTTP** ✅ |
| **Storage** | SQLite + Supabase | **PostgreSQL** ✅ |
| **Mídia** | Local (volume) | **MinIO/S3** ✅ |
| **Integrações** | Gemini + OpenRouter (custom) | Typebot, Chatwoot, Dify, n8n ✅ |
| **UI** | Painel próprio | **Manager UI** ✅ |
| **Deploy** | Docker (1 container) | **Docker Compose** (Go + Postgres) |
| **Imagem Docker** | ~1GB | **~50-100MB** ✅✅ |
| **Início** | ~5-10s | **< 1s** ✅✅ |
| **Reputação** | Projeto próprio | **~935 stars** (Evolution Foundation) |
| **IA integrada** | ✅ Gemini + OpenRouter | ❌ (via webhook) |
| **Supabase** | ✅ Centralizado | ❌ (Postgres local) |

## 🎯 A grande vantagem do Evolution Go: RECURSOS

O **Evolution Go usa 50-150MB de RAM por instância** vs **200-500MB do Evolution API (Node.js)**.

### Por que isso importa?

| Cenário | Evolution API (Node.js) | Evolution Go (Go) |
|---------|------------------------|-------------------|
| 1 conta WhatsApp | 200-500MB | **50-150MB** |
| 5 contas WhatsApp | 1-2.5GB | **250-750MB** |
| 10 contas WhatsApp | 2-5GB | **500MB-1.5GB** |

### VPS necessários:

| Número de contas | Evolution API | Evolution Go |
|-----------------|--------------|--------------|
| 1 conta | 1GB RAM (mínimo) | **512MB RAM** ✅ |
| 5 contas | 2GB RAM | **1GB RAM** ✅✅ |
| 10 contas | 4GB RAM | **2GB RAM** ✅✅ |

**Isso significa que um VPS de R$ 17/mês (InterServer, 2GB RAM) pode rodar 5-10 contas no Evolution Go!**

## Vantagens do Evolution Go

### ✅ 1. Consumo de RAM muito menor
- **50-150MB por instância** vs 200-500MB do Node.js
- Roda mais contas no mesmo VPS
- VPS mais barato serve

### ✅ 2. Início instantâneo
- Binário compilado, sem Node runtime
- **< 1s** para subir
- Restarts rápidos

### ✅ 3. Imagem Docker pequena
- **50-100MB** vs ~1GB do Node.js
- Deploy mais rápido
- Menos espaço em disco

### ✅ 4. Goroutines (concorrência nativa)
- Lida com milhares de conexões simultâneas
- Low latency (20ms WebSocket)
- 1k mensagens/segundo

### ✅ 5. API compatível com Evolution API
- Mesmos endpoints
- Migração fácil de Evolution API para Evolution Go
- Documentação igual

### ✅ 6. Built-in licensing
- Licença integrada (sem depender de servidor externo)
- Ativação offline possível

### ✅ 7. Multi-transport events
- WebSocket (20ms)
- RabbitMQ (durable queues)
- NATS
- Webhook

### ✅ 8. PostgreSQL + MinIO
- Persistência robusta
- Mídia em MinIO/S3

## Desvantagens do Evolution Go

### ❌ 1. Comunidade menor
- ~935 stars vs ~10k do Evolution API
- Documentação menos extensa
- Menos tutoriais

### ❌ 2. IA não integrada
- Não tem Gemini/OpenRouter integrado
- Precisa conectar via webhook/API externa
- O Ienvia Motor já tem isso

### ❌ 3. Supabase não usado
- PostgreSQL local (na VM)
- Perde o RLS multi-tenant do Supabase
- Dados dos clientes na VM, não no Supabase central

### ❌ 4. Limitações do whatsmeow
- Sem stories
- Áudios maiores que 16MB podem ter problemas
- Menos recursos que Baileys (em alguns casos)

### ❌ 5. Curva de aprendizado
- Arquitetura diferente (REST + Go)
- Go não é tão popular no Brasil
- Menos desenvolvedores Go disponíveis

### ❌ 6. Atualizações menos frequentes
- 19 commits no main (vs 2,629 do Evolution API)
- Versão atual: v0.7.2
- Mais novo, menos testado em produção

## Opção mista (RECOMENDADA)

**Use Evolution Go para o motor do WhatsApp, mas mantenha o Supabase para dados/CRM/IA:**

```
┌─────────────────────────────────────────────┐
│  VPS (1 por cliente, ou 1 para vários)       │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Docker Compose                       │   │
│  │  - Evolution Go (port 8080)          │   │
│  │  - PostgreSQL (port 5432)           │   │
│  │  - Redis (port 6379)                │   │
│  │  - MinIO (port 9000) [opcional]      │   │
│  └──────────────────────────────────────┘   │
│  Volume: /evolution/instances                │
└─────────────────────────────────────────────┘
          │ HTTP/Webhook
          ▼
┌─────────────────────────────────────────────┐
│  Supabase (centralizado)                     │
│  - RLS multi-tenant (dados por cliente)      │
│  - Auth (login painel)                       │
│  - Mídia de campanhas (bucket privado)       │
└─────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────┐
│  IA: Gemini (áudio) + OpenRouter (texto)      │
└──────────────────────────────────────────────┘
```

## Como fazer o deploy do Evolution Go

### Passo 1: Criar docker-compose.yml

```yaml
version: '3.8'

services:
  evolution-go:
    container_name: evolution_go
    image: evoapicloud/evolution-go:latest
    restart: always
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - evolution_data:/app/dbdata
      - evolution_logs:/app/logs
    networks:
      - evolution-net

  postgres:
    container_name: evolution_postgres
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql
    networks:
      - evolution-net

  redis:
    container_name: evolution_redis
    image: redis:7-alpine
    restart: always
    command: redis-server --port 6379 --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - evolution-net

  minio:
    container_name: evolution_minio
    image: minio/minio:latest
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    networks:
      - evolution-net

volumes:
  evolution_data:
  evolution_logs:
  postgres_data:
  redis_data:
  minio_data:

networks:
  evolution-net:
    driver: bridge
```

### Passo 2: Criar .env

```env
# Server
SERVER_PORT=8080
CLIENT_NAME=evolution-go

# Security
GLOBAL_API_KEY=sua-chave-api-uuid-forte

# Database
POSTGRES_AUTH_DB=postgresql://postgres:senha@postgres:5432/evogo_auth?sslmode=disable
POSTGRES_USERS_DB=postgresql://postgres:senha@postgres:5432/evogo_users?sslmode=disable
DATABASE_SAVE_MESSAGES=true

# Logging
WADEBUG=INFO
LOGTYPE=console

# Optional
AMQP_URL=
NATS_URL=
WEBHOOK_URL=

# MinIO
MINIO_ENABLED=true
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=evolution-media
MINIO_USE_SSL=false
```

### Passo 3: Subir o ambiente

```bash
docker compose up -d

# Verificar status
docker compose ps

# Ver logs
docker compose logs -f evolution-go
```

### Passo 4: Criar instância do WhatsApp

```bash
# Criar instância
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: sua-chave-api-uuid-forte" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": {
      "name": "cliente1",
      "credit": "premium",
      "whatsapp": {
        "connection": "baileys"
      }
    }
  }'

# Gerar QR Code
curl -X POST http://localhost:8080/instance/{name}/qrcode \
  -H "apikey: sua-chave-api-uuid-forte"

# Ver status
curl -X GET http://localhost:8080/instance/{name}/status \
  -H "apikey: sua-chave-api-uuid-forte"

# Enviar mensagem
curl -X POST http://localhost:8080/message/sendText \
  -H "apikey: sua-chave-api-uuid-forte" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": {
      "name": "cliente1"
    },
    "message": {
      "textual": {
        "text": "Olá, mensagem de teste!"
      },
      "destination": "5511999999999"
    }
  }'
```

## Conclusão

### Migre para Evolution Go se:
- Você quer **mais contas WhatsApp no mesmo VPS** (5-10 em 2GB RAM)
- Quer **imagem Docker pequena** (50-100MB vs 1GB)
- Quer **início instantâneo** (< 1s)
- Quer **concorrência nativa** (Goroutines)
- Quer **custo de infraestrutura menor**

### Mantenha o Ienvia Motor se:
- Você já tem o **painel funcionando** com Gemini + OpenRouter
- Quer **Supabase centralizado** (RLS multi-tenant)
- Quer **menos containers** para gerenciar
- Não precisa de **multi-instância no mesmo servidor**

### Opção mista (RECOMENDADA)

**Evolution Go para o motor + Supabase para dados/CRM/IA:**

- **Evolution Go** roda o WhatsApp (lightweight, 50MB/instância)
- **Supabase** mantém dados centralizados (RLS multi-tenant)
- **IA (Gemini/OpenRouter)** continua como serviço externo
- **Docker Compose** no VPS com: Evolution Go + Postgres + Redis + MinIO

**Essa arquitetura permite:**
- 1 VPS de 2GB RAM para **5-10 contas WhatsApp**
- Dados centralizados no Supabase
- IA centralizada (Gemini/OpenRouter)
- Deploy simples (Docker Compose)

## Recursos

- **Evolution Go GitHub**: https://github.com/evolution-foundation/evolution-go
- **Documentação**: https://docs.evolutionfoundation.com.br
- **Docker Hub**: https://hub.docker.com/r/evoapicloud/evolution-go
- **whatsmeow**: https://github.com/tulir/whatsmeow
- **Comunidade**: https://evolutionfoundation.com.br/community
- **API Reference**: https://docs.evolutionfoundation.com.br/api-reference/introduction

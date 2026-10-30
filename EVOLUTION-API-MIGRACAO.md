# Ienvia Motor — Guia de Migração para Evolution API

Análise comparativa entre o **Ienvia Motor atual** (Baileys direto) e o **Evolution API**, e guia de migração.

## O que é o Evolution API?

Evolution API é uma **API REST open-source para WhatsApp**, mantida pela **Evolution Foundation** (brasileira, ~10k stars no GitHub). Ela encapsula o Baileys e adiciona:

- **API REST completa** (enviar/receber mensagens, contatos, grupos, webhooks)
- **Multi-instance management** (várias contas WhatsApp no mesmo servidor)
- **Webhook system** (notificações em tempo real)
- **QR code generation** (ativação via QR Code)
- **Integrações nativas**: Typebot, Chatwoot, Dify, OpenAI, n8n, RabbitMQ, Kafka, SQS, Socket.io, S3/MinIO
- **UI de gerenciamento** (Evolution Manager)
- **PostgreSQL + Redis** (armazenamento e cache)
- **Docker deployment** (pronto para produção)

## Comparação: Ienvia Motor vs Evolution API

| Característica | **Ienvia Motor** (atual) | **Evolution API** |
|----------------|-------------------------|------------------|
| **Base** | Baileys direto (customizado) | Baileys + REST API |
| **Arquitetura** | Node.js server + WebSocket + Supabase | API REST + PostgreSQL + Redis |
| **Multi-instância** | Manual (1 processo por conta) | **Nativo** (manager UI) |
| **Webhooks** | WebSocket próprio | **HTTP webhooks** (padrão) |
| **QR Code** | Painel próprio | **Endpoint específico** |
| **Storage** | SQLite local + Supabase | **PostgreSQL + Redis** (local) |
| **Mídia** | Local (volume) | **Local ou S3/MinIO** |
| **Integrações** | Gemini + OpenRouter (custom) | **Typebot, Chatwoot, Dify, OpenAI, n8n** |
| **UI** | Painel próprio (Início & Conexão) | **Evolution Manager** (UI pronta) |
| **Deploy** | Docker (1 container) | **Docker Compose** (API + Postgres + Redis) |
| **RAM mínima** | ~200MB (server) + 100-150MB/conta | ~300MB (API) + 50MB/instância |
| **Custo** | Grátis (software) | Grátis (software) |
| **Reputação** | Projeto próprio | **~10k stars, comunidade brasileira grande** |
| **Documentação** | LEIA-ME + guias próprios | **docs.evolutionfoundation.com.br** |

## Vantagens da migração

### ✅ 1. Multi-instância nativo
- Gerencie múltiplas contas WhatsApp no mesmo servidor
- Cada conta tem sua própria API key e sessão
- Sem precisar rodar múltiplos processos

### ✅ 2. Webhooks HTTP padrão
- Endpoints HTTP para mensagens recebidas
- Mais fácil de integrar com qualquer backend
- Suporte a RabbitMQ, Kafka, SQS para alto volume

### ✅ 3. UI de gerenciamento pronta
- Evolution Manager: painel para criar/excluir instâncias
- Ver QR Code, status, logs
- Sem precisar construir UI do zero

### ✅ 4. Integrações nativas
- **Typebot**: chatbot visual
- **Chatwoot**: inbox compartilhado
- **Dify**: agentes IA
- **n8n**: automação
- **OpenAI**: IA integrada
- **RabbitMQ/Kafka/SQS**: filas de mensagens

### ✅ 5. PostgreSQL + Redis
- Persistência robusta (vs SQLite local)
- Cache de sessões
- Suporte a múltiplas instâncias

### ✅ 6. Comunidade grande
- ~10k stars no GitHub
- Comunidade brasileira ativo
- Documentação em português
- Atualizações frequentes

### ✅ 7. Deploy mais simples
- Docker Compose com tudo incluso
- Imagem oficial no Docker Hub
- Configuração padronizada

## Desvantagens da migração

### ❌ 1. Requer PostgreSQL + Redis
- Mais recursos de infraestrutura
- Mais containers para gerenciar
- ~300MB RAM a mais (API + Postgres + Redis)

### ❌ 2. Perda do painel atual (Ienvia Motor)
- O painel de Início & Conexão do Ienvia Motor é customizado
- Evolution Manager é diferente
- Precisaria adaptar a UI para clients

### ❌ 3. IA não está integrada
- Evolution API não tem Gemini/OpenRouter integrado
- Você precisa conectar a IA via webhook/API externa
- O Ienvia Motor já tem isso no lugar

### ❌ 4. Supabase não é usado
- Evolution API usa PostgreSQL local
- Você perde o RLS multi-tenant do Supabase
- Dados dos clientes ficariam na VM, não no Supabase central

### ❌ 5. Curva de aprendizado
- Arquitetura diferente (REST vs WebSocket)
- Configuração de webhooks
- Gestão de instâncias via API

### ❌ 6. Licença
- Evolution API é Apache 2.0
- Mas a partir da v2.4.0, requer **ativação de licença** via servidor da Evolution Foundation
- Pode ser um problema se o servidor da licença estiver offline

## Compatibilidade com o projeto atual

### O que pode ser mantido:
- **Supabase**: continua centralizado (CRM, auth, dados)
- **Gemini + OpenRouter**: continua como serviço externo
- **Docker**: continua o método de deploy
- **Architecture**: cada cliente = 1 VM (pode continuar assim)

### O que muda:
- **WhatsApp engine**: Baileys direto → Evolution API
- **Storage**: SQLite local → PostgreSQL + Redis (na VM)
- **Webhook**: WebSocket → HTTP webhooks
- **Multi-instância**: processos separados → API de instâncias

## Recomendação

### Migre se:
- Você quer **multi-instância nativo** (várias contas no mesmo servidor)
- Quer **UI de gerenciamento pronta** (Evolution Manager)
- Quer **integrações nativas** (Typebot, Chatwoot, Dify, n8n)
- Quer **webhooks HTTP padrão**
- Quer **comunidade grande** e documentação em português

### Mantenha o Ienvia Motor se:
- Você já tem o **painel funcionando** com Gemini + OpenRouter
- Quer **Supabase centralizado** (RLS multi-tenant)
- Quer **menos containers** para gerenciar
- Não precisa de **multi-instância no mesmo servidor** (1 VM por cliente já basta)
- Quer **controle total** sobre o código

## Opção mista (recomendada)

**Use Evolution API para o motor do WhatsApp, mas mantenha o Supabase para dados/CRM:**

```
┌─────────────────────────────────────────────┐
│  VPS (1 por cliente)                         │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Docker Compose                       │   │
│  │  - Evolution API (port 8080)         │   │
│  │  - PostgreSQL (port 5432)           │   │
│  │  - Redis (port 6379)                │   │
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
┌─────────────────────────────────────────────┐
│  IA: Gemini (áudio) + OpenRouter (texto)     │
└─────────────────────────────────────────────┘
```

## Como fazer a migração (opção mista)

### Passo 1: Criar docker-compose.yml para Evolution API

```yaml
version: '3.8'

services:
  evolution-api:
    container_name: evolution_api
    image: evoapicloud/evolution-api:latest
    restart: always
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - evolution_instances:/evolution/instances
    networks:
      - evolution-net

  postgres:
    container_name: evolution_postgres
    image: postgres:15
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - evolution-net

  redis:
    container_name: evolution_redis
    image: redis:latest
    restart: always
    command: redis-server --port 6379 --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - evolution-net

volumes:
  evolution_instances:
  postgres_data:
  redis_data:

networks:
  evolution-net:
    driver: bridge
```

### Passo 2: Criar .env

```env
# Evolution API
SERVER_PORT=8080
SERVER_URL=http://localhost:8080
AUTHENTICATION_API_KEY=sua-chave-api-uuid

# PostgreSQL
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:senha@postgres:5432/evolution
POSTGRES_USER=postgres
POSTGRES_PASSWORD=senha_forte
POSTGRES_DB=evolution

# Redis
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_REDIS_PREFIX_KEY=evolution

# Webhook
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=https://webhook.seudominio.com
```

### Passo 3: Subir o ambiente

```bash
docker compose up -d

# Verificar status
docker compose ps

# Ver logs
docker compose logs -f evolution-api
```

### Passo 4: Criar instância do WhatsApp

```bash
# Criar instância
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: sua-chave-api-uuid" \
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
curl -X POST http://localhost:8080/instance/qrcode/tmp \
  -H "apikey: sua-chave-api-uuid" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": {
      "name": "cliente1"
    }
  }'
```

### Passo 5: Configurar webhook

```bash
curl -X POST http://localhost:8080/webhook/set \
  -H "apikey: sua-chave-api-uuid" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "url": "https://webhook.seudominio.com",
      "webhook": {
        "messages.upsert": true,
        "messages.update": true,
        "connection.update": true
      }
    }
  }'
```

### Passo 6: Conectar com o Supabase

- O webhook do Evolution API envia mensagens recebidas
- O Supabase processa a mensagem e chama a IA
- A IA (Gemini/OpenRouter) responde
- O client envia a resposta via API Evolution API

## Conclusão

**Evolution API é uma excelente opção** se você quer:
- Multi-instância nativo
- UI de gerenciamento pronta
- Integrações nativas
- Webhooks HTTP padrão
- Comunidade grande

**Mantenha o Ienvia Motor se:**
- Você já tem o painel funcionando
- Quer Supabase centralizado
- Quer menos containers
- Quer controle total

**A opção mista é a melhor:** Evolution API para o motor + Supabase para dados/CRM/IA.

## Recursos

- **Evolution API GitHub**: https://github.com/evolution-foundation/evolution-api
- **Documentação**: https://docs.evolutionfoundation.com.br
- **Docker Hub**: https://hub.docker.com/r/evoapicloud/evolution-api
- **Comunidade**: https://evolutionfoundation.com.br/community
- **Documentação da API**: https://docs.evolutionfoundation.com.br/api-reference/introduction

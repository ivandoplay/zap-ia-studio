# Ienvia Motor — Arquitetura Final (Ienvia Motor + Evolution Go)

Esta documentação descreve a arquitetura final do sistema, combinando o **Ienvia Motor (Baileys)** para disparo em massa e o **Evolution Go** para atendimento com IA.

## Visão Geral

```
┌─────────────────────────────────────────────────────────────┐
│                    PAINEL ADMINISTRADOR                     │
│  - Controle de acesso aos motores                          │
│  - Configuração por cliente                                 │
│  - Supabase centralizado (RLS multi-tenant)                │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌──────────────────┐               ┌──────────────────────┐
│  IENVIA MOTOR    │               │  EVOLUTION GO        │
│  (Baileys)       │               │  (whatsmeow / Go)    │
│                  │               │                      │
│  • Disparo em    │               │  • Atendimento com  │
│    massa         │               │    IA               │
│  • Todos os      │               │  • Apenas clientes   │
│    clientes      │               │    autorizados     │
│  • Roda local    │               │  • Centralizado na  │
│    (VM do cliente)│               │    VPS admin        │
└──────────────────┘               └──────────────────────┘
           │                               │
           │ WebSocket/HTTP                │ HTTP/Webhook
           ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     SUPABASE (centralizado)                   │
│  - RLS multi-tenant (dados por cliente)                      │
│  - Auth (login painel)                                      │
│  - Mídia de campanhas (bucket privado)                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  IA: Gemini (áudio) + OpenRouter (texto)                    │
│  - Cada cliente coloca suas próprias chaves                 │
│  - Atendimento com IA funciona em ambos os motores          │
└─────────────────────────────────────────────────────────────┘
```

## 1. Ienvia Motor (Baileys) — Disparo em Massa

**Função:** Envio em massa de mensagens WhatsApp.

**Acesso:** Todos os clientes.

**Infraestrutura:** Roda local em cada cliente (VM do cliente).

**Mecanismo:** Baileys direto (WebSocket WhatsApp Web).

**Vantagens:**
- Controle total sobre o código
- Disparo em massa otimizado
- Integração direta com Supabase

**Uso:**
- Campanhas de marketing
- Disparo em massa de notificações
- Envio automático de mensagens

## 2. Evolution Go — Atendimento com IA

**Função:** Atendimento automático com IA.

**Acesso:** Apenas clientes autorizados pelo administrador.

**Infraestrutura:** Centralizado na VPS do administrador.

**Mecanismo:** whatsmeow (Go) + REST API + Webhooks.

**Vantagens:**
- Consumo de RAM baixo (~50-150MB por instância)
- Multi-instância nativo
- Webhooks HTTP padrão
- Deploy centralizado

**Uso:**
- Chatbot com IA para atendimento
- Resposta automática a mensagens
- Atendimento 24/7

## 3. Painel Administrador

**Função:** Controle centralizado.

**Recursos:**
- Selecionar quais clientes podem usar Evolution Go
- Todos os clientes podem usar Ienvia Motor
- Configuração de IA por cliente
- Visualização de status dos motores

**Implementação:** Supabase (RLS multi-tenant).

## 4. Supabase (Centralizado)

**Função:** Dados, CRM, auth.

**Recursos:**
- RLS multi-tenant (isolamento por cliente)
- Auth (login no painel)
- Mídia de campanhas (bucket privado)
- Dados de conversas
- Histórico de interações

**Acesso:** Todos os clientes (com permissões controladas).

## 5. IA (Gemini + OpenRouter)

**Função:** Atendimento com IA.

**Recursos:**
- Gemini para áudio (transcrição, respostas por voz)
- OpenRouter para texto (respostas por texto)
- Cada cliente coloca suas próprias chaves

**Integração:** Ambos os motores (Ienvia Motor e Evolution Go) usam a mesma IA.

## 6. Hosting

### Evolution Go:
- Roda na VPS do administrador
- Hospedado em serviço (Pageup: pool-evolution-go-025.cloud2.pageup.dev.br)
- Centralizado para todos os clientes autorizados

### Ienvia Motor:
- Roda local em cada cliente
- Cada cliente tem sua própria VM
- Não centralizado

## 7. Segurança

### Isolamento por cliente:
- **Supabase:** RLS multi-tenant (isolamento de dados)
- **Evolution Go:** Cada instância tem sua própria API key
- **Ienvia Motor:** Cada VM tem seu próprio banco

### Controle de acesso:
- Administrador define quais clientes podem usar Evolution Go
- Todos os clientes podem usar Ienvia Motor
- Chaves de IA por cliente (não compartilhadas)

## 8. Deploy

### Evolution Go (centralizado):
- Docker Compose na VPS do administrador
- Serviços: Evolution Go + PostgreSQL + Redis + MinIO
- Instâncias criadas via API

### Ienvia Motor (por cliente):
- Docker no VM do cliente
- Serviço: Ienvia Motor (Baileys)
- Volume: ./data (SQLite + auth + uploads)

## 9. Custos

### Evolution Go:
- VPS do administrador (Pageup ou outro)
- ~R$ 20-50/mês (depende do número de instâncias)
- Cada cliente não paga separadamente

### Ienvia Motor:
- VM do cliente (VPS separado)
- ~R$ 10-30/mês por cliente
- O cliente paga o seu próprio VPS

### IA:
- Gemini: grátis (tier gratuito) ou pago
- OpenRouter: pago (pay-per-use)
- Cada cliente usa suas próprias chaves

### Supabase:
- Free tier: 500MB banco + 5GB storage
- Pro: ~R$ 70/mês (se necessário)

## 10. Fluxo de Trabalho

### Administrador cria cliente:
1. Criar cliente no Supabase
2. Atribuir VM para Ienvia Motor
3. Atribuir instância Evolution Go (se autorizado)
4. Configurar chaves de IA

### Cliente usa Ienvia Motor:
1. Login no painel
2. Conectar WhatsApp (QR Code)
3. Usar para disparo em massa

### Cliente usa Evolution Go:
1. Login no painel
2. Conectar WhatsApp (QR Code via Evolution Go)
3. Atendimento com IA automaticamente

## Resumo

| Aspecto | Ienvia Motor | Evolution Go |
|---------|-------------|--------------|
| **Função** | Disparo em massa | Atendimento com IA |
| **Acesso** | Todos os clientes | Apenas autorizados |
| **Infraestrutura** | VM do cliente | VPS administrador |
| **WhatsApp library** | Baileys (Node.js) | whatsmeow (Go) |
| **RAM por conta** | ~100-150MB | ~50-150MB |
| **Deploy** | Docker (VM cliente) | Docker Compose (VPS admin) |
| **Supabase** | Sim (centralizado) | Sim (centralizado) |
| **IA** | Sim | Sim |

## Próximos Passos

1. **Configurar Evolution Go na VPS do administrador** (se ainda não está)
2. **Integrar Ienvia Motor com Evolution Go** (via Supabase)
3. **Criar painel administrador** (controle de acesso)
4. **Documentar para clientes** (como usar cada motor)

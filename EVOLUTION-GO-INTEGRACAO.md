# Ienvia Motor — Integração do Evolution Go

Guia para integrar o **Evolution Go** ao **Ienvia Motor atual** (que já tem IA integrada e funciona para atendimento).

## O que já funciona no Ienvia Motor (atual)

O Ienvia Motor atual já tem **IA integrada**:

### 1. IA (Gemini + OpenRouter)
- **Gemini** (Google): áudio (transcrição, respostas por voz)
- **OpenRouter** (DeepSeek, etc.): texto (respostas por texto)
- **Gerni key pool**: múltiplas chaves Gemini
- **Modo auto**: áudio → Gemini, texto/imagem → OpenRouter

### 2. Atendimento com IA
- **generateSmartReply()**: resposta inteligente baseada no histórico
- **buildSystemPrompt()**: prompt do sistema com skills
- **analyzeLeadSentiment()**: análise de sentimento
- **detectPromptInjection()**: proteção anti-injection
- **polishHumanWhatsappReply()**: humanização da resposta
- **TranscribeVoiceBufferWithAi()**: transcrição de áudio
- **Campanha IA**: geração de variações para campanhas

### 3. Multi-Tenant (Supabase)
- RLS multi-tenant (isolamento por cliente)
- Auth (login no painel)
- Dados de conversas
- Histórico de interações

### 4. Painel Administrador
- Controle de acesso
- Configuração de IA por cliente
- Visão geral dos clientes

## O que vai mudar com a integração do Evolution Go

### Evolution Go será um **motor adicional** para:

1. **Atendimento com IA** (mais eficiente, menos RAM)
2. **Multi-instância** (várias contas no mesmo servidor)
3. **Webhooks HTTP** (padrão, mais fácil integrar)

### O Ienvia Motor atual **continua funcionando** para:

1. **Disparo em massa** (campanhas)
2. **Atendimento com IA** (via Baileys direto)

## Arquitetura da Integração

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
│  • IA integrada  │               │  • Multi-instância  │
│  • WebSocket     │               │  • Webhooks HTTP    │
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

## Integração: Como fazemos

### 1. Evolution Go rodando na VPS do administrador
- **Hosting**: Pageup (pool-evolution-go-025.cloud2.pageup.dev.br)
- **API URL**: https://pool-evolution-go-025.cloud2.pageup.dev.br
- **API Key**: (você fornece)

### 2. Ienvia Motor configurado para usar Evolution Go
- O Ienvia Motor (no VM do cliente) pode **enviar mensagens** via Evolution Go
- O Evolution Go **envia webhooks** para o Ienvia Motor (ou Supabase)
- O Ienvia Motor processa o webhook e usa a IA para responder

### 3. Fluxo de atendimento

**Quando um cliente envia uma mensagem:**

```
1. Cliente → WhatsApp → Evolution Go (na VPS admin)
2. Evolution Go → Webhook → Supabase (centralizado)
3. Supabase → Ienvia Motor (no VM do cliente) [se usar Ienvia Motor]
4. Ienvia Motor → IA (Gemini/OpenRouter) → Resposta
5. Resposta → Evolution Go → WhatsApp → Cliente
```

**Ou, se o cliente usa só o Evolution Go:**

```
1. Cliente → WhatsApp → Evolution Go (na VPS admin)
2. Evolution Go → Webhook → Supabase (centralizado)
3. Supabase → IA (Gemini/OpenRouter) → Resposta
4. Resposta → Evolution Go → WhatsApp → Cliente
```

## Implementação

### Passo 1: Configurar o Evolution Go na VPS do administrador

O Evolution Go já está rodando em:
- **URL**: https://pool-evolution-go-025.cloud2.pageup.dev.br
- **Swagger**: https://pool-evolution-go-025.cloud2.pageup.dev.br/swagger/index.html

### Passo 2: Criar instâncias do WhatsApp no Evolution Go

```bash
# Criar instância
curl -X POST https://pool-evolution-go-025.cloud2.pageup.dev.br/instance/create \
  -H "apikey: SUA_API_KEY" \
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
curl -X GET https://pool-evolution-go-025.cloud2.pageup.dev.br/instance/qr \
  -H "apikey: SUA_API_KEY"

# Conectar instância
curl -X POST https://pool-evolution-go-025.cloud2.pageup.dev.br/instance/connect \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": {
      "name": "cliente1"
    }
  }'
```

### Passo 3: Configurar webhook no Evolution Go

```bash
# Configurar webhook
curl -X POST https://pool-evolution-go-025.cloud2.pageup.dev.br/webhook/set \
  -H "apikey: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "url": "https://seu-webhook.vercel.app/webhook",
      "webhook": {
        "messages.upsert": true,
        "messages.update": true,
        "connection.update": true
      }
    }
  }'
```

### Passo 4: Integrar o Ienvia Motor com o Evolution Go

O Ienvia Motor (no VM do cliente) pode ser configurado para:

**Opção A: Ienvia Motor envia via Evolution Go**
- O Ienvia Motor usa a API do Evolution Go para enviar mensagens
- Isso unifica o envio de mensagens

**Opção B: Evolution Go webhook → Supabase → Ienvia Motor**
- O Evolution Go envia webhooks para o Supabase
- O Ienvia Motor processa os webhooks e usa a IA

**Opção C: Evolution Go webhook → Supabase → IA direta**
- O Evolution Go envia webhooks para o Supabase
- O Supabase chama a IA diretamente (sem Ienvia Motor)

### Passo 5: Configurar IA por cliente

Cada cliente configura suas chaves de IA:

```env
# .env do cliente (no VM do cliente ou no Supabase)
GEMINI_API_KEY=chave_gemini_do_cliente
OPENROUTER_API_KEY=chave_openrouter_do_cliente

# Ou via Supabase (armazenado no perfil do cliente)
ai_settings = {
  "geminiApiKey": "chave_gemini_do_cliente",
  "openrouterApiKey": "chave_openrouter_do_cliente",
  "providerMode": "auto"  # áudio → Gemini, texto → OpenRouter
}
```

## Painel Administrador

O painel administrador vai controlar:

### 1. Controle de acesso
- Quais clientes podem usar Evolution Go
- Todos os clientes podem usar Ienvia Motor

### 2. Configuração por cliente
- Chaves de IA por cliente
- Configuração do motor (Evolution Go ou Ienvia Motor)

### 3. Visão geral
- Status dos motores
- Métricas de uso
- Logs de erros

## Resumo

| Aspecto | Ienvia Motor | Evolution Go |
|---------|-------------|--------------|
| **Função** | Disparo em massa + Atendimento | Atendimento com IA |
| **Acesso** | Todos os clientes | Apenas autorizados |
| **Infraestrutura** | VM do cliente | VPS administrador |
| **IA** | ✅ Integrada | ✅ (via webhook) |
| **Multi-instância** | Manual | **Nativo** |
| **RAM por conta** | ~100-150MB | ~50-150MB |
| **Webhooks** | WebSocket | **HTTP** |
| **Deploy** | Docker (VM cliente) | Docker Compose (VPS admin) |

## Próximos passos

1. **Você me fornece a API Key do Evolution Go**
2. **Criar instâncias de teste no Evolution Go**
3. **Configurar webhook no Supabase**
4. **Integrar o Ienvia Motor com o Evolution Go**
5. **Testar o atendimento com IA via Evolution Go**

**O que você quer fazer agora?**

1. **Fornecer a API Key do Evolution Go** (para eu testar)
2. **Criar instâncias de teste** (1 cliente)
3. **Configurar webhook no Supabase**
4. **Integrar o Ienvia Motor com o Evolution Go**
5. **Outro**

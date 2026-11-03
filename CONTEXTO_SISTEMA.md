# Contexto do Sistema — Atendente IA WhatsApp (Zap IA Studio)

Este arquivo fornece o contexto da arquitetura, decisões e pontos importantes para a IA entender o sistema rapidamente.

---

## 1. Arquitetura Geral

### Duas fontes de status WhatsApp

1. **Worker local** (Ienvia Motor no Termux/PC) — `whatsappManager.getPublicState()`
   - Conecta WhatsApp via motor local (Baileys).
   - Quando offline, mostra `disconnected`.

2. **Evolution Go na nuvem** (pool de API WhatsApp)
   - Conecta WhatsApp via API Evolution Go.
   - Instâncias: `slot_1`, `slot_2`, `slot_3`.
   - Status via `/instance/all` (campo `connected`, `jid`, `webhook`).

### Como o painel obtém o status
- `/api/cloud/poll` → `getEffectiveWaState(req)` → estado do worker local.
- `mergeEvolutionGoStatus()` — mergeia o status da Evolution Go (connected) no waState.
- **Importante:** sem esse merge, o painel mostra "disconnected" mesmo com WhatsApp conectado na nuvem.

### Como o painel obtém conversas (CRM)
- `/api/cloud/poll` → `contacts` → `storage.data.contacts` (do Supabase).
- `getEvolutionGoContacts()` — sincroniza contatos via `/user/contacts` da Evolution Go.
- Mensagens novas: via **webhook** → `saveHistory()` → Supabase (`zapia_contacts`).

---

## 2. Endpoints Principais

### Servidor local (porta 3000)
- `/api/auth/login` — login (Supabase)
- `/api/cloud/poll` — estado + conversas (com auth)
- `/api/evolution-cloud/status` — status das instâncias Evolution Go (público)
- `/api/evolution-cloud/connect` — conecta/gera código de pareamento
- `/api/evolution-cloud/sync-history` — pede sync de histórico de um chat
- `/api/evolution-webhook/webhook` — recebe mensagens da Evolution Go (público)

### Evolution Go (nuvem)
- `/instance/all` — lista instâncias (token, connected, jid, webhook)
- `/instance/connect` — conecta (webhookUrl, subscribe)
- `/instance/pair` — gera código de pareamento
- `/instance/qr` — QR code
- `/instance/status` — status
- `/instance/delete/{id}` — deleta
- `/user/contacts` — lista contatos
- `/send/text` — envia mensagem
- `/chat/history-sync` — sync de histórico (só com sessão)

---

## 3. Abordagem para Histórico de Conversas

**O Evolution Go NÃO tem endpoint para histórico completo.** O histórico entra por dois caminhos, ambos via webhook:

### CAMINHO 1 — Histórico do pareamento (o principal)
Quando o celular aceita o pareamento, empurra o histórico em VÁRIOS LOTES. Cada lote dispara um webhook `HistorySync`.
- Payload: `data.syncType`, `chunkOrder`, `progress`, `conversations[]`.
- Cada conversa: `id` (JID), `name`, `lastMsgTimestamp`, `messages[]`.
- Cada mensagem: envelope `{"message": <WebMessageInfo>}` com `key.remoteJID`, `key.fromMe`, `key.ID`, `messageTimestamp` (segundos), `pushName`, `message` (conteúdo).
- **Dedupe por `key.ID`** e ordene por `messageTimestamp`.

### CAMINHO 2 — Backfill sob demanda
Endpoint `POST /chat/history-sync` com `messageInfo` (âncora: ID, Timestamp, IsFromMe, Chat).
- Retorna recibo; o conteúdo chega depois via webhook `HistorySync` (syncType ON_DEMAND).
- Só funciona ancorado em uma mensagem que o dispositivo já conhece.
- Laço de 50 em 50, usando a mensagem mais antiga como nova âncora.

### CONFIGURAÇÃO NECESSÁRIA
- Webhook com `subscribe` incluindo **HISTORY_SYNC** (juntamente com MESSAGE, SEND_MESSAGE, CONNECTION).
- **`HISTORY_SYNC` é obrigatório** — sem essa categoria os lotes não são entregues.
- O histórico só é enviado em **pareamento novo** (QR/código de dispositivo novo).
- Numa instância já conectada, é preciso desconectar/logout e parear de novo.

### Sequência esperada após pareamento
`PairSuccess` → `Connected` → vários `HistorySync` → `OfflineSyncCompleted`.

### Observação — conversas aparecendo no início
Quando o Evolution Go foi adicionado ao sistema pela primeira vez, as conversas já apareceram no painel sem configuração adicional de histórico. Isso ocorreu porque o pareamento inicial já empurrou o histórico via `HistorySync`. O fato de as conversas aparecerem logo após o pareamento é o comportamento esperado.

---

## 4. Bugs Resolvidos (commits no main)

| # | Problema | Correção | Commit |
|---|----------|----------|--------|
| 1 | Parsing quebrado do `PairingCode` | Lê `data.data.PairingCode` capitalizado | `a3f6cf0` |
| 2 | Status sempre "disconnected" | Mapeia `connected` e `phone` do `jid` | `dfcf461` |
| 3 | Mensagem de erro confusa (429) | Detecta rate limit | `7a817d1` |
| 4 | Painel mostrava desconectado | Merge do status da Evolution Go no poll | `c6ce558` |
| 5 | Webhook vazio | Configurar webhook no connect | `cfe21d2` |
| 6 | Conversas não carregavam | Sincronizar contatos via `/user/contacts` | `31b7115` |
| 7 | Webhook URL errado | Usar `/api/evolution-webhook/webhook` | `ef7fbc7` |
| 8 | Sync de histórico | Endpoint `/sync-history` | `67af058` |
| 9 | Documentação | `DOCUMENTACAO_CORRECOES.md` | `1c4a73a` |

---

## 5. Pontos Críticos

### Webhook URL
- O handler está em `/api/evolution-webhook/webhook`.
- O webhook URL configurado na instância deve ser `https://zap-ia-studio.vercel.app/api/evolution-webhook/webhook` (com `/webhook`).
- **Se o URL estiver sem `/webhook`, o POST cai no middleware de auth e retorna `authRequired` — mensagens não chegam.**

### Subscribe
- Usar `subscribe: ["ALL"]` ou `["MESSAGE", "SEND_MESSAGE", "CONNECTION", "HISTORY_SYNC"]`.
- **HISTORY_SYNC é obrigatório para receber histórico.**

### Auth
- `/api/evolution-webhook/webhook` é público (a Evolution Go não autentica).
- `/api/evolution-cloud/*` é público (movido antes do middleware de auth).
- `/api/cloud/poll` requer login (Bearer token do Supabase).

### Deploy
- Push no `main` → Vercel deploy automático.
- Aguardar ~15 segundos para o deploy concluir.

### Números
- Número conectado (slot_1): `5586981303979` (novo pareamento)
- Número antigo (slot_1 anterior): `558681638438`
- Rate limit (429) dura 15-40 minutos.

---

## 6. Files Principais

- `src/server.js` — servidor Express, endpoints, `getEffectiveWaState`, `mergeEvolutionGoStatus`
- `src/evolutionGoCloud.js` — router Evolution Go (status, connect, sync-history), `getEvolutionGoSlotStatus`, `getEvolutionGoContacts`
- `src/evolutionGoWebhook.js` — handler webhook (processa mensagens, salva no Supabase)
- `src/supabaseCloud.js` — client Supabase, `buildCloudMultiSlotWaState`, tenantStore
- `public/app.js` — frontend do painel (CRM, status, connect)
- `public/painel.html` — HTML do painel
- `DOCUMENTACAO_CORRECOES.md` — documentação das correções
- `GUIA_PARA_IA.md` — guia com credenciais e segurança

---

## 7. Como Testar Rapidamente

```bash
# Status Evolution Go (local ou produção)
curl http://localhost:3000/api/evolution-cloud/status

# Conversas no CRM (com login)
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"jeffersonivan","password":"Davi32ivan@#"}'
# Pegar accessToken e usar no /api/cloud/poll

# Webhook (sem auth)
curl -X POST http://localhost:3000/api/evolution-webhook/webhook -H 'Content-Type: application/json' -d '{"event":"MESSAGE","instance":"zap-ia-slot_1","data":{"key":{"remoteJid":"559988293143@s.whatsapp.net","fromMe":false,"id":"test"},"message":{"conversation":"Olá"},"messageType":"text"}}'
```

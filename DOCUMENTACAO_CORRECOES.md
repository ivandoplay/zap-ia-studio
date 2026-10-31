# Documentação — Correções Bug Pareamento / Conversas CRM

## Situação Atual (2026-10-31)

- **Número conectado:** `558681638438` na instância `slot_1` (Evolution Go na nuvem)
- **Status:** Conectado ✅
- **CRM:** 2307 contatos sincronizados via `/user/contacts`
- **Produção:** `https://zap-ia-studio.vercel.app`

---

## Bugs Encontrados e Correções

### 1. Parsing quebrado do PairingCode
**Problema:** A API Evolution Go retorna o campo `PairingCode` capitalizado em `data.data`, mas o código só verificava `data.code` (minúsculo). Resultado: `null`, e a interface caía para o QR code.

**Correção:** `src/evolutionGoCloud.js` — adicionar `data.data.PairingCode` no parsing.
```js
const code = pairResult.data?.data?.PairingCode || pairResult.data?.data?.code || pairResult.data?.PairingCode || pairResult.data?.code || null;
```
**Commit:** `a3f6cf0`

### 2. Status sempre "disconnected"
**Problema:** O endpoint `/api/evolution-cloud/status` usava `inst.status` (que não existe no `/instance/all`). O campo real é `inst.connected` (booleano). Sempre caía para `'disconnected'`.

**Correção:** mapear `inst.connected` e extrair o número do `jid`.
```js
status: inst.connected ? 'connected' : 'disconnected',
phone: inst.jid ? inst.jid.split(':')[0] : null,
```
**Commit:** `dfcf461`

### 3. Mensagem de erro confusa (429)
**Problema:** Quando o WhatsApp retornava 429 (rate limit), a mensagem era `"Falha ao gerar código: pairing failed: info query returned status 429: rate-overlimit"` — confusa.

**Correção:** detectar 429 e mostrar mensagem clara.
```js
if (errMsg.includes('429') || errMsg.includes('rate-overlimit')) {
  return res.status(429).json({ ok: false, error: 'Número temporariamente limitado pelo WhatsApp (429). Aguarde 15-40 minutos e tente novamente.' });
}
```
**Commit:** `7a817d1`

### 4. Painel mostrava desconectado mesmo conectado
**Problema:** O `/api/cloud/poll` usava `getEffectiveWaState(req)` que retorna o estado do **worker local** (desconectado). A Evolution Go na nuvem estava conectada, mas o poll não sabia.

**Correção:** adicionar `mergeEvolutionGoStatus()` que mergeia o status da Evolution Go (via `getEvolutionGoSlotStatus()`) no `waState`.
**Commit:** `c6ce558`

### 5. Webhook vazio (conversas não chegavam)
**Problema:** A instância tinha `webhook: ""` — mensagens da Evolution Go não chegavam ao painel, então conversas não eram salvas.

**Correção:** configurar o webhook no `connectInstance()` via `webhookUrl` e `subscribe: ['MESSAGE']`.
```js
const body = { immediate: false };
if (webhookUrl) {
  body.webhookUrl = webhookUrl;
  body.subscribe = ['MESSAGE'];
}
```
**Commit:** `cfe21d2`

### 6. Conversas não carregavam no CRM
**Problema:** O CRM mostrava 0 contatos porque o painel não sincronizava os contatos do WhatsApp.

**Correção:** adicionar `getEvolutionGoContacts()` que chama `/user/contacts` e mergeia no `contacts` do poll.
```js
const evoContacts = await getEvolutionGoContacts();
for (const c of evoContacts) {
  if (!contactsMap[c.chatId]) contactsMap[c.chatId] = c;
}
```
**Commit:** `31b7115`

### 7. Webhook URL errado (mensagens não chegavam)
**Problema:** O handler do webhook está em `/api/evolution-webhook/webhook`, mas o webhook URL configurado era `/api/evolution-webhook` (sem `/webhook`). O POST caía no middleware de auth e retornava `authRequired` — mensagens nunca chegavam ao painel.

**Correção:** usar o caminho `/webhook` no `webhookUrl` do `connectInstance`.
```js
const webhookUrl = `${baseUrl}/api/evolution-webhook/webhook`;
```
**Commit:** `ef7fbc7`

### 8. Endpoint de sync de histórico
**Implementação:** adicionar `POST /api/evolution-cloud/sync-history` que pede à Evolution Go para sincronizar o histórico de um chat específico (`/chat/history-sync`). As mensagens syncronizadas chegam via webhook.

**Commit:** `67af058`

---

## Endpoints da Evolution Go usados (via Swagger)

Documentação: `https://pool-evolution-go-025.cloud2.pageup.dev.br/swagger/idoc.json`

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/instance/all` | GET | Lista instâncias (token, connected, jid, webhook) |
| `/instance/connect` | POST | Conecta instância (webhookUrl, subscribe) |
| `/instance/pair` | POST | Gera código de pareamento |
| `/instance/status` | GET | Status da instância |
| `/instance/qr` | GET | Obtém QR code |
| `/instance/delete/{id}` | DELETE | Deleta instância |
| `/user/contacts` | GET | Lista contatos do WhatsApp |
| `/send/text` | POST | Envia mensagem de texto |
| `/chat/history-sync` | POST | Sincroniza histórico de um chat (apenas com sessão) |

---

## Abordagem para Histórico de Conversas

**Não é possível extrair o histórico completo de todas as conversas via API da Evolution Go.**

A abordagem correta (concordada com o usuário):
1. **Webhook** — recebe mensagens novas e salva no Supabase (`zapia_contacts`).
2. **History-sync** — puxa o que faltou de chats específicos (quando há sessão).
3. **Banco (Supabase)** — armazena o histórico.

### O que funciona
- **Contatos (2307)** — sincronizados via `/user/contacts`, aparecem no CRM.
- **Mensagens novas** — capturadas via webhook (`/api/evolution-webhook/webhook`), salvas no Supabase.
- **Sync-history** — endpoint `POST /api/evolution-cloud/sync-history` pede à Evolution Go para sincronizar o histórico de um chat. As mensagens chegam via webhook.

### Limitações
- **Histórico completo de todos os chats** — não é possível via API. O `history-sync` só funciona para chats com sessão de sinal estabelecida.
- **Mensagens passadas** — não são recuperadas via API; só mensagens novas (webhook) e sync de chats com sessão.

### Fluxo recomendado
1. O webhook recebe mensagens novas e salva automaticamente.
2. Quando o usuário abre uma conversa, o painel pode chamar `/sync-history` para puxar mensagens novas que não chegaram.
3. O histórico é acumulado no Supabase.

---

## Números

- Número conectado: `558681638438` (slot_1)
- Número que estava sendo pareado: `5586981303979` (em rate limit 429, dura 15-40 min)
- Usuário painel: `jeffersonivan`
- Senha: `Davi32ivan@#`

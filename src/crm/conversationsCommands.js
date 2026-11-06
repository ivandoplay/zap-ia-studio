// Conversas — comandos reais sobre o CRM vivo (zapia_contacts).
//
// A caixa nova nasceu somente leitura. Este módulo liga os comandos que já existem no
// painel antigo ao mesmo armazenamento que /api/conversations-v3 lê, sem inventar estado:
//
//  - cada rota recebe a instância (chip) e o contato exatamente como a lista os expõe;
//  - o contato é resolvido dentro do chip informado, nunca por atalho para o Chip 1;
//  - envio usa a mesma ponte Evolution do painel antigo (chip conectado da conta),
//    e o texto é persistido na conversa com o provedor e o id da mensagem;
//  - erro de origem sobe como erro; nada é marcado como enviado sem confirmação.
import {Router, json} from 'express';
import {sendEvolutionApiText, markEvolutionApiRead} from '../evolutionApiCloud.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^slot_[0-9]+$/;
const MAX_TEXT = 4000;

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Mesma derivação usada pela leitura: o UUID da instância é determinístico por chip.
function slotFromInstance(instanceId) {
  if (!UUID.test(String(instanceId || ''))) return null;
  const n = Number(String(instanceId).slice(-12));
  return Number.isSafeInteger(n) && n >= 1 && n <= 9 ? `slot_${n}` : null;
}

function splitChatId(rawChatId) {
  const raw = String(rawChatId || '');
  const prefixed = /^(slot_[0-9]+)::(.+)$/.exec(raw);
  return prefixed ? {slotId: prefixed[1], chatId: prefixed[2]} : {slotId: null, chatId: raw};
}

const fail = (status, code, message) => Object.assign(new Error(message), {status, code});

// `transport` permite injetar a ponte de envio nos testes sem tocar no WhatsApp.
export function createConversationsCommandsRouter({getLocalContext, allowSend = false, transport = null} = {}) {
  const bridge = transport || {sendText: sendEvolutionApiText, markRead: markEvolutionApiRead};
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); next(); });
  router.use(json({limit: '16kb', strict: true}));

  const sendError = (res, error) => res.status(error?.status || 503).json({
    ok: false,
    code: error?.code || 'CONVERSATION_COMMAND_FAILED',
    error: error?.status ? error.message : 'Não foi possível confirmar o comando. Nada foi alterado.'
  });

  async function context(req, write = false) {
    const ctx = req.dashboardContext || await getLocalContext?.(req);
    if (!ctx) throw fail(401, 'AUTH_REQUIRED', 'Entre na sua conta para usar as conversas.');
    if (write && ctx.viewer?.id !== ctx.tenant?.id) throw fail(403, 'CONVERSATIONS_SUPPORT_READ_ONLY', 'Suporte permanece somente leitura.');
    const data = ctx.data || ctx.store?.data;
    if (!data || typeof data !== 'object') throw fail(503, 'CONVERSATIONS_UNAVAILABLE', 'Este ambiente não expõe conversas.');
    if (typeof data.contacts !== 'object' || Array.isArray(data.contacts)) throw fail(503, 'CONTACTS_INVALID', 'Os contatos desta conta não puderam ser lidos.');
    return {...ctx, data};
  }

  // Resolve a conversa dentro do chip informado. Sem fallback silencioso.
  function resolve(ctx, instanceId, threadKey) {
    const slotId = slotFromInstance(instanceId);
    if (!slotId) throw fail(400, 'INVALID_INSTANCE_ID', 'Instância inválida.');
    const key = decodeURIComponent(String(threadKey || ''));
    if (!key) throw fail(400, 'INVALID_CONVERSATION', 'Conversa inválida.');
    const contacts = ctx.data.contacts || {};
    const candidates = [key, `${slotId}::${key}`];
    for (const candidate of candidates) {
      const contact = contacts[candidate];
      if (!contact || typeof contact !== 'object') continue;
      const split = splitChatId(candidate);
      const owner = SLOT.test(split.slotId || '') ? split.slotId : (SLOT.test(str(contact.slotId, 20)) ? str(contact.slotId, 20) : 'slot_1');
      if (owner !== slotId) continue;
      return {slotId, storageKey: candidate, chatId: split.chatId || candidate, contact};
    }
    // O contato pode estar gravado sem prefixo de chip; nesse caso o chip vem do campo slotId.
    const loose = Object.entries(contacts).find(([storedKey, contact]) => {
      if (!contact || typeof contact !== 'object') return false;
      const split = splitChatId(storedKey);
      if (split.slotId) return false;
      const owner = SLOT.test(str(contact.slotId, 20)) ? str(contact.slotId, 20) : 'slot_1';
      return owner === slotId && (storedKey === key || split.chatId === key);
    });
    if (loose) {
      const split = splitChatId(loose[0]);
      return {slotId, storageKey: loose[0], chatId: split.chatId || loose[0], contact: loose[1]};
    }
    throw fail(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada nesta conta e nesta instância.');
  }

  const storageOf = ctx => ctx.storage || ctx.store;
  function guarded(ctx) {
    const storage = storageOf(ctx);
    if (!storage || typeof storage.upsertContact !== 'function') {
      throw fail(503, 'CONVERSATIONS_STORAGE_UNAVAILABLE', 'O armazenamento desta conta não aceita alterações.');
    }
    return storage;
  }

  function reply(res, payload) {
    return res.json({ok: true, ...payload});
  }

  // ── Envio de mensagem de WhatsApp ───────────────────────────────────────────
  router.post('/instances/:instanceId/threads/:threadKey/messages', async (req, res) => {
    try {
      const ctx = await context(req, true);
      if (!allowSend) throw fail(503, 'CONVERSATION_SEND_DISABLED', 'Envio ainda não homologado nesta implantação.');
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const text = str(req.body?.text, MAX_TEXT);
      if (!text) throw fail(400, 'MESSAGE_EMPTY', 'Escreva a mensagem antes de enviar.');
      if (Object.keys(req.body || {}).some(key => !['text', 'requestId'].includes(key))) {
        throw fail(400, 'MESSAGE_INVALID', 'Esta rota aceita apenas o texto da mensagem.');
      }
      const storage = guarded(ctx);
      // Envio real pelo chip conectado da conta; a conversa alvo é o contato desta thread.
      const result = await bridge.sendText(ctx.tenant.id, target.chatId, text);
      const providerId = str(result?.key?.id || result?.id || '', 120) || null;
      storage.appendContactMessage(target.storageKey, {
        role: 'owner',
        text,
        deliveryStatus: 'accepted',
        ...(providerId ? {waMsgId: providerId} : {})
      });
      storage.markContactRead(target.storageKey);
      return reply(res, {
        sent: true,
        provider: 'evolution_api',
        providerMessageId: providerId,
        conversationId: encodeURIComponent(target.storageKey),
        text,
        at: new Date().toISOString(),
        delivery: 'accepted'
      });
    } catch (error) {
      const mapped = error?.statusCode && !error.status
        ? fail(error.statusCode === 503 ? 503 : 502, 'WHATSAPP_SEND_FAILED', error.message)
        : error;
      return sendError(res, mapped);
    }
  });

  // ── Marcar lida / não lida ──────────────────────────────────────────────────
  router.post('/instances/:instanceId/threads/:threadKey/read', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const unread = req.body?.unread === true;
      const storage = guarded(ctx);
      if (!unread) {
        const ids = (Array.isArray(target.contact.messages) ? target.contact.messages : [])
          .filter(message => message?.role === 'user' && message?.waMsgId)
          .map(message => message.waMsgId);
        try { if (typeof bridge.markRead === 'function') await bridge.markRead(ctx.tenant.id, target.chatId, ids); }
        catch (error) { if (error?.statusCode && error.statusCode >= 500) return sendError(res, fail(503, 'WHATSAPP_READ_FAILED', error.message)); }
        storage.markContactRead(target.storageKey);
      } else {
        storage.markContactUnread(target.storageKey);
      }
      return reply(res, {unread, conversationId: encodeURIComponent(target.storageKey)});
    } catch (error) { return sendError(res, error); }
  });

  // ── Fixar / arquivar ────────────────────────────────────────────────────────
  router.patch('/instances/:instanceId/threads/:threadKey', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const body = req.body || {};
      const keys = Object.keys(body);
      if (!keys.length || keys.some(key => !['pinned', 'archived', 'aiEnabled'].includes(key))) {
        throw fail(400, 'CONVERSATION_PATCH_INVALID', 'Alteração não permitida nesta conversa.');
      }
      for (const key of keys) if (typeof body[key] !== 'boolean') throw fail(400, 'CONVERSATION_PATCH_INVALID', 'Use verdadeiro ou falso.');
      const patch = {};
      if (Object.hasOwn(body, 'pinned')) patch.pinned = body.pinned;
      if (Object.hasOwn(body, 'archived')) patch.archived = body.archived;
      if (Object.hasOwn(body, 'aiEnabled')) patch.aiIgnored = !body.aiEnabled;
      const storage = guarded(ctx);
      if (patch.archived === true) patch.unreadCount = 0;
      const contact = storage.upsertContact(target.storageKey, patch);
      return reply(res, {
        conversationId: encodeURIComponent(target.storageKey),
        pinned: contact?.pinned === true,
        archived: contact?.archived === true,
        aiEnabled: contact?.aiIgnored !== true
      });
    } catch (error) { return sendError(res, error); }
  });

  // ── Nota interna (não vai para o WhatsApp) ──────────────────────────────────
  router.post('/instances/:instanceId/threads/:threadKey/notes', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const text = str(req.body?.text, 4000);
      if (!text) throw fail(400, 'NOTE_EMPTY', 'Escreva o conteúdo da nota interna.');
      const author = str(ctx.viewer?.displayName, 80) || 'Equipe';
      const storage = guarded(ctx);
      if (typeof storage.addInternalNote !== 'function') throw fail(503, 'CONVERSATIONS_STORAGE_UNAVAILABLE', 'Notas internas indisponíveis nesta conta.');
      const contact = storage.addInternalNote(target.storageKey, {text, author});
      const note = (contact?.internalNotesList || []).at(-1) || null;
      return reply(res, {note, conversationId: encodeURIComponent(target.storageKey)});
    } catch (error) { return sendError(res, error); }
  });

  // ── Pausar / retomar a IA nesta conversa ────────────────────────────────────
  router.post('/instances/:instanceId/threads/:threadKey/pause', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const minutes = req.body?.minutes === 'forever' ? 'forever' : Math.min(10080, Math.max(1, Number.parseInt(req.body?.minutes, 10) || 60));
      const reason = str(req.body?.reason, 200) || 'Pausado pela caixa nova';
      const storage = guarded(ctx);
      const contact = storage.pauseContact(target.storageKey, minutes, reason);
      return reply(res, {paused: contact?.pausedUntil === 'forever' ? 'forever' : contact?.pausedUntil || null, conversationId: encodeURIComponent(target.storageKey)});
    } catch (error) { return sendError(res, error); }
  });

  router.post('/instances/:instanceId/threads/:threadKey/resume', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const storage = guarded(ctx);
      const contact = storage.resumeContact(target.storageKey);
      return reply(res, {paused: null, conversationId: encodeURIComponent(target.storageKey), aiEnabled: contact?.aiIgnored !== true});
    } catch (error) { return sendError(res, error); }
  });

  // ── Ficha do contato (campos do CRM legado desta conta) ─────────────────────
  router.patch('/instances/:instanceId/threads/:threadKey/profile', async (req, res) => {
    try {
      const ctx = await context(req, true);
      const target = resolve(ctx, req.params.instanceId, req.params.threadKey);
      const body = req.body || {};
      const allowed = {name: 80, company: 120, city: 80, email: 120, leadSource: 60, stage: 24};
      const keys = Object.keys(body);
      if (!keys.length || keys.some(key => !Object.hasOwn(allowed, key))) {
        throw fail(400, 'PROFILE_PATCH_INVALID', 'Alteração de ficha não permitida.');
      }
      const patch = {};
      for (const key of keys) {
        if (typeof body[key] !== 'string') throw fail(400, 'PROFILE_PATCH_INVALID', 'Use texto nos campos da ficha.');
        const value = str(body[key], allowed[key]);
        if (key === 'name' && !value) throw fail(400, 'PROFILE_PATCH_INVALID', 'O nome não pode ficar vazio.');
        patch[key] = value;
      }
      const storage = guarded(ctx);
      const contact = storage.upsertContact(target.storageKey, patch);
      return reply(res, {
        conversationId: encodeURIComponent(target.storageKey),
        profile: {name: contact?.name || '', company: contact?.company || '', city: contact?.city || '', email: contact?.email || '', leadSource: contact?.leadSource || '', stage: contact?.stage || null}
      });
    } catch (error) { return sendError(res, error); }
  });

  router.use((error, _req, res, _next) => sendError(res, error?.type === 'entity.too.large'
    ? fail(413, 'CONVERSATION_INPUT_TOO_LARGE', 'Requisição acima do limite.')
    : fail(400, 'CONVERSATION_INPUT_INVALID', 'JSON inválido.')));

  return router;
}

export {slotFromInstance};

// Módulo de conversas (etapa 1 da migração do CRM para a navegação nova).
// Leitura enxuta: a lista não carrega mensagens nem mídia. Autenticação e escopo de conta
// ficam no middleware de /api; aqui só se compõe o contrato público.
import {Router} from 'express';

const STAGES = ['novo', 'qualificando', 'em_atendimento', 'aguardando_humano', 'concluido'];
const MAX_MESSAGE_TEXT = 4000;

const str = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Telefone/chat pode identificar pessoas: a lista entrega apenas o suficiente para exibir e ligar.
function publicChatId(chatId = '') {
  const clean = String(chatId).replace(/^slot_[123]::/i, '');
  return clean;
}

function displayPhone(chatId = '') {
  const digits = publicChatId(chatId).replace(/@.*$/, '').replace(/\D/g, '');
  return digits || '';
}

function messageMedia(message = {}) {
  const files = Array.isArray(message.mediaFiles) ? message.mediaFiles.filter(Boolean) : [];
  const first = files[0] || message.mediaFile || null;
  if (!first) return null;
  return {
    name: str(first.name || first.fileName, 120) || null,
    mime: str(first.mime || first.mimeType || message.mediaMime, 80) || null,
    url: str(first.url, 800) || null
  };
}

function publicMessage(message = {}) {
  const role = message.role === 'owner' ? 'owner' : message.role === 'user' ? 'user' : 'system';
  return {
    id: String(message.id || ''),
    role,
    text: typeof message.text === 'string' ? message.text.slice(0, MAX_MESSAGE_TEXT) : '',
    at: message.timestamp || null,
    type: str(message.waMessageType, 40) || null,
    ack: Number.isInteger(message.ack) ? message.ack : null,
    delivery: str(message.deliveryStatus, 40) || null,
    media: messageMedia(message),
    campaignId: str(message.campaignId, 64) || null,
    historyUnavailable: message.historyMediaUnavailable === true
  };
}

// Resumo por conversa: nada de mensagens, nada de mídia, nada de nota interna.
function conversationSummary(chatId, contact = {}) {
  const messages = Array.isArray(contact.messages) ? contact.messages : [];
  const last = messages[messages.length - 1] || null;
  const stage = STAGES.includes(contact.stage) ? contact.stage : 'novo';
  const paused = contact.pausedUntil === 'forever'
    ? 'forever'
    : contact.pausedUntil && Date.parse(contact.pausedUntil) > Date.now() ? 'temporario' : null;
  return {
    chatId: String(chatId),
    channelKey: String(chatId),
    name: readableName(contact.name, chatId),
    phone: displayPhone(chatId),
    slotId: str(contact.slotId, 20) || null,
    stage,
    tags: Array.isArray(contact.tags) ? contact.tags.filter(t => typeof t === 'string').slice(0, 12).map(t => str(t, 24)) : [],
    pinned: contact.pinned === true,
    archived: contact.archived === true,
    aiIgnored: contact.aiIgnored === true,
    paused,
    unread: num(contact.unreadCount),
    unreadAlert: contact.unreadAlert === true,
    lastMessageAt: contact.lastMessageAt || null,
    lastMessage: last ? { role: last.role === 'owner' ? 'owner' : 'user', preview: previewText(last), type: str(last.waMessageType, 40) || null } : null,
    dealStatus: str(contact.dealStatus, 20) || null,
    dealValue: num(contact.dealValue)
  };
}

// Nomes como "...", "-" ou vazios não identificam ninguém: mostra o telefone.
function readableName(rawName, chatId) {
  const name = str(rawName, 80);
  if (name && /[\p{L}\p{N}]/u.test(name)) return name;
  const phone = displayPhone(chatId);
  return phone ? `+${phone}` : 'Contato WhatsApp';
}

function previewText(message = {}) {
  const text = typeof message.text === 'string' ? message.text.replace(/\s+/g, ' ').trim() : '';
  if (text) return text.slice(0, 120);
  const media = messageMedia(message);
  if (media) return media.mime?.startsWith('audio') ? 'Mensagem de voz' : media.name || 'Arquivo';
  return '';
}

function matchesQuery(contact, chatId, query) {
  if (!query) return true;
  const q = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const haystack = [
    contact.name,
    displayPhone(chatId),
    ...(Array.isArray(contact.tags) ? contact.tags : []),
    contact.company,
    contact.city
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return haystack.includes(q);
}

export function createConversationsRouter({getLocalContext, requireWrite} = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); next(); });

  async function context(req) {
    const ctx = req.dashboardContext || await getLocalContext?.(req);
    if (!ctx) throw Object.assign(new Error('Entre na sua conta para ver as conversas.'), { status: 401 });
    const store = ctx.store;
    if (!store || typeof store.data !== 'object') throw Object.assign(new Error('Este ambiente não expõe conversas.'), { status: 503, code: 'CONVERSATIONS_UNAVAILABLE' });
    return { ...ctx, store, contacts: store.data.contacts || {} };
  }

  const fail = (res, error) => res.status(error.status || 503).json({
    ok: false,
    code: error.code || 'CONVERSATIONS_UNAVAILABLE',
    error: error.status ? error.message : 'Não foi possível consultar as conversas. Nada foi alterado.'
  });

  // Leitura somente. Filtros são aplicados no servidor; a contagem global não depende da página.
  router.get('/', async (req, res) => {
    try {
      const ctx = await context(req);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const visibility = ['inbox', 'archived', 'all'].includes(req.query.visibility) ? req.query.visibility : 'inbox';
      const stage = STAGES.includes(req.query.stage) ? req.query.stage : '';
      const slot = typeof req.query.slot === 'string' && req.query.slot ? req.query.slot : '';
      const pill = ['unread', 'pinned', 'human', 'paused'].includes(req.query.pill) ? req.query.pill : '';
      const query = str(req.query.q, 80);

      if (String(req.query.q || '').length > 80) throw Object.assign(new Error('Busca longa demais.'), { status: 400, code: 'CONVERSATIONS_BAD_FILTER' });

      let rows = Object.entries(ctx.contacts).map(([chatId, contact]) => conversationSummary(chatId, contact || {}));

      const counts = {
        total: rows.length,
        inbox: rows.filter(r => !r.archived).length,
        archived: rows.filter(r => r.archived).length,
        unread: rows.filter(r => !r.archived && r.unread > 0).length,
        pinned: rows.filter(r => !r.archived && r.pinned).length,
        human: rows.filter(r => !r.archived && r.stage === 'aguardando_humano').length,
        paused: rows.filter(r => !r.archived && r.paused).length,
        awaiting: rows.filter(r => !r.archived && r.stage === 'aguardando_humano').length
      };

      if (visibility === 'inbox') rows = rows.filter(r => !r.archived);
      if (visibility === 'archived') rows = rows.filter(r => r.archived);
      if (stage) rows = rows.filter(r => r.stage === stage);
      if (slot) rows = rows.filter(r => r.slotId === slot);
      if (pill === 'unread') rows = rows.filter(r => r.unread > 0);
      if (pill === 'pinned') rows = rows.filter(r => r.pinned);
      if (pill === 'human') rows = rows.filter(r => r.stage === 'aguardando_humano');
      if (pill === 'paused') rows = rows.filter(r => r.paused);
      if (query) rows = rows.filter(r => matchesQuery(ctx.contacts[r.chatId] || {}, r.chatId, query) || r.name.toLowerCase().includes(query.toLowerCase()));

      rows.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
      });

      const page = rows.slice(offset, offset + limit);
      return res.json({
        ok: true,
        schemaVersion: 1,
        viewer: ctx.viewer,
        tenant: ctx.tenant,
        permissions: { canWrite: ctx.mode !== 'local_worker' ? Boolean(ctx.permissions?.master) : true, viewerIsTenant: ctx.viewer?.id === ctx.tenant?.id },
        mode: ctx.mode,
        counts,
        stages: STAGES,
        filters: { visibility, stage, slot, pill, q: query, limit, offset },
        items: page,
        total: rows.length,
        hasMore: offset + page.length < rows.length
      });
    } catch (error) { return fail(res, error); }
  });

  // Mensagens de UMA conversa. Paginação por `before` (timestamp ISO) para histórico longo.
  router.get('/:chatId', async (req, res) => {
    try {
      const ctx = await context(req);
      const chatId = decodeURIComponent(req.params.chatId);
      const key = ctx.store.findSiblingContactKey?.(chatId) || chatId;
      const contact = ctx.contacts[key];
      if (!contact) return res.status(404).json({ ok: false, code: 'CONVERSATION_NOT_FOUND', error: 'Conversa não encontrada nesta conta.' });
      const all = Array.isArray(contact.messages) ? contact.messages : [];
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 60));
      const before = typeof req.query.before === 'string' && req.query.before ? Date.parse(req.query.before) : null;
      const filtered = before && Number.isFinite(before)
        ? all.filter(m => (Date.parse(m.timestamp || 0) || 0) < before)
        : all;
      const slice = filtered.slice(-limit);
      return res.json({
        ok: true,
        schemaVersion: 1,
        conversation: {
          ...conversationSummary(key, contact),
          summary: typeof contact.summary === 'string' ? contact.summary.slice(0, 2000) : '',
          notes: typeof contact.notes === 'string' ? contact.notes.slice(0, 4000) : '',
          email: str(contact.email, 120) || '',
          company: str(contact.company, 120) || '',
          city: str(contact.city, 80) || '',
          dealStatus: str(contact.dealStatus, 20) || 'open',
          dealValue: num(contact.dealValue),
          leadSource: str(contact.leadSource, 60) || '',
          createdAt: contact.createdAt || null,
          followUpAt: contact.followUpAt || null,
          aiPausedReason: str(contact.pauseReason, 200) || '',
          messageCount: all.length
        },
        messages: slice.map(publicMessage),
        total: all.length,
        hasMore: slice.length < filtered.length,
        nextBefore: slice.length ? slice[0].timestamp || null : null
      });
    } catch (error) { return fail(res, error); }
  });

  return router;
}

export {STAGES, publicMessage, conversationSummary};

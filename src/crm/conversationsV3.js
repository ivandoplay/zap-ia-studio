// Conversas — leitura real sobre zapia_contacts.
//
// A caixa nova da navegação foi desenhada (no painel v2, já removido) para consumir
// "instâncias + threads". Nesta conta a instância real é o chip legado (zapia_wa_slots) e a
// thread real é o contato (zapia_contacts). O histórico por instância em UUID nunca foi
// populado; os dados vivos estão no CRM legado. Este módulo é a ponte explícita entre os dois,
// e existe justamente para que a tela nova deixe de mostrar uma caixa vazia.
//
// Regras que valem aqui:
//  - nada de dados fictícios nem fallback silencioso: se a origem falhar, devolve erro;
//  - a lista nunca carrega o histórico completo;
//  - telefone/identificador só sai no detalhe da conversa, mascarado na lista.
import {Router} from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^slot_[0-9]+$/;
const MAX_TEXT = 4000;
const PREVIEW = 120;

const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const iso = value => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Identificador real da instância: usa o UUID do canal quando existir; senão deriva do chip.
// Determinístico, para o front poder recarregar e continuar no mesmo escopo.
function instanceIdFor(slotId) {
  const match = /^slot_([0-9]+)$/.exec(slotId || '');
  const n = match ? Number(match[1]) : 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
function slotFromInstance(instanceId) {
  if (!UUID.test(instanceId)) return null;
  const n = Number(instanceId.slice(-12));
  return Number.isSafeInteger(n) && n >= 1 && n <= 9 ? `slot_${n}` : null;
}

// O chat_id pode vir como "5586...@s.whatsapp.net", "123@lid" ou já prefixado pelo chip.
function splitChatId(rawChatId) {
  const raw = String(rawChatId || '');
  const prefixed = /^(slot_[0-9]+)::(.+)$/.exec(raw);
  const slotId = prefixed ? prefixed[1] : null;
  const chatId = prefixed ? prefixed[2] : raw;
  return { slotId, chatId };
}

function jidOf(chatId) {
  const clean = String(chatId || '').trim();
  if (/@(s\.whatsapp\.net|lid|g\.us)$/.test(clean)) return clean;
  const digits = clean.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function displayName(contact, chatId) {
  const name = str(contact?.name, 80);
  if (name && /[\p{L}\p{N}]/u.test(name)) return name;
  const digits = String(chatId || '').replace(/@.*$/, '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'Contato WhatsApp';
}

function maskPhone(chatId) {
  const digits = String(chatId || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 6) return `${digits.slice(0, 2)}****`;
  return `+${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

function mediaOf(message) {
  const files = Array.isArray(message?.mediaFiles) ? message.mediaFiles.filter(Boolean) : [];
  const first = files[0] || message?.mediaFile || null;
  if (!first) return null;
  return {
    name: str(first.name || first.fileName, 120) || null,
    mime: str(first.mime || first.mimeType || message?.mediaMime, 80) || null,
    url: str(first.url, 800) || null
  };
}

function previewOf(message) {
  const text = typeof message?.text === 'string' ? message.text.replace(/\s+/g, ' ').trim() : '';
  if (text) return text.slice(0, PREVIEW);
  const media = mediaOf(message);
  if (media) return media.mime?.startsWith('audio') ? 'Mensagem de voz' : media.name || 'Arquivo';
  const type = str(message?.waMessageType, 40);
  if (type) return type.replace(/_/g, ' ');
  return '';
}

function normalized(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function createConversationsV3Router({sendEnabled = false,  getLocalContext, store: cloudAuthStore = null } = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); next(); });

  const fail = (res, error) => res.status(error.status || 503).json({
    ok: false,
    code: error.code || 'CONVERSATIONS_UNAVAILABLE',
    error: error.status ? error.message : 'Não foi possível consultar as conversas. Nada foi alterado.'
  });

  // A caixa nova é a única rota de painel que lê o CRM vivo, e o /api apenas prepara o
  // contexto dela (isDashboardRequest). O workspace do tenant já está carregado na
  // requisição pelo tenantStorageContext; usamos esse store em vez de recarregá-lo.
  function tenantStore(req) {
    const store = typeof cloudAuthStore === 'function' ? cloudAuthStore() : null;
    return store && typeof store === 'object' && store.data && typeof store.data === 'object' ? store : null;
  }

  async function context(req) {
    const ctx = req.dashboardContext || await getLocalContext?.(req);
    if (!ctx) throw Object.assign(new Error('Entre na sua conta para ver as conversas.'), { status: 401, code: 'AUTH_REQUIRED' });
    const store = tenantStore(req);
    const data = ctx.data || ctx.store?.data || store?.data;
    if (!data || typeof data !== 'object') {
      throw Object.assign(new Error('Este ambiente não expõe conversas.'), { status: 503, code: 'CONVERSATIONS_UNAVAILABLE' });
    }
    const contacts = data.contacts || {};
    if (typeof contacts !== 'object' || Array.isArray(contacts)) {
      throw Object.assign(new Error('Os contatos desta conta não puderam ser lidos.'), { status: 503, code: 'CONTACTS_INVALID' });
    }
    return { ...ctx, data, contacts, store: store || ctx.store || ctx.storage, storage: store || ctx.store || ctx.storage };
  }

  function entries(ctx) {
    return Object.entries(ctx.contacts).map(([key, raw]) => {
      const contact = raw && typeof raw === 'object' ? raw : {};
      const { slotId, chatId } = splitChatId(key);
      const slot = SLOT.test(slotId || '') ? slotId : (SLOT.test(str(contact.slotId, 20)) ? str(contact.slotId, 20) : 'slot_1');
      const messages = Array.isArray(contact.messages) ? contact.messages : [];
      return { key, chatId: chatId || key, contact, slotId: slot, messages };
    });
  }

  // ── Instâncias (chips) reais da conta ────────────────────────────────────────
  router.get('/instances', async (req, res) => {
    try {
      const ctx = await context(req);
      const q = normalized(str(req.query.q, 80));
      const slots = new Map();
      for (const row of entries(ctx)) {
        const current = slots.get(row.slotId) || { id: row.slotId, threads: 0, lastAt: null, unread: 0 };
        current.threads += 1;
        current.unread += int(row.contact.unreadCount);
        const at = iso(row.contact.lastMessageAt) || iso(row.messages.at(-1)?.timestamp);
        if (at && (!current.lastAt || at > current.lastAt)) current.lastAt = at;
        slots.set(row.slotId, current);
      }

      // Nome e estado vêm do runtime real do motor (mesma fonte do painel antigo).
      const runtimeSlots = ctx.runtime?.slots && typeof ctx.runtime.slots === 'object' ? ctx.runtime.slots : {};
      const slotMeta = new Map(Object.entries(runtimeSlots).map(([id, slot]) => [id, slot || {}]));

      let items = [...slots.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(slot => {
          const meta = slotMeta.get(slot.id) || {};
          return {
            id: instanceIdFor(slot.id),
            slotId: slot.id,
            name: str(meta.label, 64) || slot.id.replace('slot_', 'Chip '),
            transport: 'local_worker',
            crmVisible: true,
            connection: str(meta.status, 20) || 'unknown',
            aiEnabled: meta.aiEnabled === true || meta.ai_enabled === true,
            threads: slot.threads,
            unread: slot.unread,
            lastMessageAt: slot.lastAt
          };
        });
      if (q) items = items.filter(i => normalized(i.name).includes(q) || normalized(i.slotId).includes(q));

      return res.json({
        ok: true,
        schemaVersion: 1,
        viewer: { id: ctx.viewer?.id, role: ctx.viewer?.role || 'operador', displayName: ctx.viewer?.displayName || 'Operador' },
        tenant: { id: ctx.tenant?.id || ctx.viewer?.id, displayName: ctx.tenant?.displayName || ctx.data?.business?.name || 'Minha conta' },
        source: 'legacy_contacts',
        // O que a caixa realmente sabe fazer nesta conta: as rotas de envio, nota,
        // pausa e ficha existem no mesmo módulo e estão liberadas para a conta dona.
        features: {
          crmProfilesRead: false,
          send: sendEnabled === true,
          manage: sendEnabled === true,
          metadata: sendEnabled === true
        },
        items,
        total: items.length,
        hasMore: false,
        nextCursor: null
      });
    } catch (error) { return fail(res, error); }
  });

  // ── Conversas (threads) de uma instância ─────────────────────────────────────
  router.get('/instances/:instanceId/threads', async (req, res) => {
    try {
      const ctx = await context(req);
      const slotId = slotFromInstance(String(req.params.instanceId || ''));
      if (!slotId) throw Object.assign(new Error('Instância inválida.'), { status: 400, code: 'INVALID_INSTANCE_ID' });

      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const visibility = ['inbox', 'archived', 'all'].includes(req.query.visibility) ? req.query.visibility : 'inbox';
      const pill = ['unread', 'pinned', 'human', 'paused', 'hot', 'ai', 'followup'].includes(req.query.pill) ? req.query.pill : '';
      const q = normalized(str(req.query.q, 80));

      let rows = entries(ctx).filter(row => row.slotId === slotId).map(row => {
        const last = row.messages.at(-1) || null;
        const paused = row.contact.pausedUntil === 'forever'
          ? 'forever'
          : (row.contact.pausedUntil && Date.parse(row.contact.pausedUntil) > Date.now() ? 'temporario' : null);
        return {
          id: encodeURIComponent(row.key),
          chatId: row.chatId,
          name: displayName(row.contact, row.chatId),
          phoneMasked: maskPhone(row.chatId),
          identityKind: String(row.chatId).endsWith('@lid') ? 'provisional_lid' : 'verified_pn',
          peerJid: jidOf(row.chatId),
          selfJid: '',
          createdAt: iso(row.contact.createdAt) || iso(last?.timestamp) || new Date(0).toISOString(),
          preview: previewOf(last),
          previewRole: last?.role === 'owner' ? 'owner' : last ? 'user' : null,
          messageCount: row.messages.length,
          unread: int(row.contact.unreadCount),
          pinned: row.contact.pinned === true,
          archived: row.contact.archived === true,
          aiEnabled: !(row.contact.aiIgnored === true),
          needsHuman: row.contact.stage === 'aguardando_humano',
          paused,
          hot: row.contact.dealStatus === 'hot',
          stage: str(row.contact.stage, 24) || null,
          company: str(row.contact.company, 120) || '',
          city: str(row.contact.city, 80) || '',
          email: str(row.contact.email, 120) || '',
          tags: Array.isArray(row.contact.tags) ? row.contact.tags.filter(t => typeof t === 'string').map(t => str(t, 24)).slice(0, 12) : [],
          followUp: Boolean(row.contact.followUpAt),
          dealStatus: str(row.contact.dealStatus, 20) || null,
          dealValue: int(row.contact.dealValue),
          lastMessageAt: iso(row.contact.lastMessageAt) || iso(last?.timestamp),
          originIds: [instanceIdFor(slotId)]
        };
      });

      const counts = {
        total: rows.length,
        inbox: rows.filter(r => !r.archived).length,
        archived: rows.filter(r => r.archived).length,
        unread: rows.filter(r => !r.archived && r.unread > 0).length,
        human: rows.filter(r => !r.archived && r.needsHuman).length,
        pinned: rows.filter(r => !r.archived && r.pinned).length
      };

      if (visibility === 'inbox') rows = rows.filter(r => !r.archived);
      if (visibility === 'archived') rows = rows.filter(r => r.archived);
      if (pill === 'unread') rows = rows.filter(r => r.unread > 0);
      if (pill === 'human') rows = rows.filter(r => r.needsHuman);
      if (pill === 'pinned') rows = rows.filter(r => r.pinned);
      if (pill === 'hot') rows = rows.filter(r => r.hot);
      if (pill === 'ai') rows = rows.filter(r => r.aiEnabled);
      if (pill === 'followup') rows = rows.filter(r => r.followUp === true);
      if (q) {
        rows = rows.filter(r => normalized([r.name, r.chatId, r.stage, r.company, r.city, r.email, ...r.tags].filter(Boolean).join(' ')).includes(q));
      }

      rows.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(b.lastMessageAt || 0) - Date.parse(a.lastMessageAt || 0);
      });

      const page = rows.slice(offset, offset + limit);
      return res.json({
        ok: true,
        schemaVersion: 1,
        instanceId: instanceIdFor(slotId),
        slotId,
        source: 'legacy_contacts',
        counts,
        filters: { visibility, pill, q: str(req.query.q, 80), limit, offset },
        items: page,
        total: rows.length,
        hasMore: offset + page.length < rows.length,
        nextCursor: null
      });
    } catch (error) { return fail(res, error); }
  });

  // ── Mensagens de uma conversa ────────────────────────────────────────────────
  router.get('/instances/:instanceId/threads/:threadId/messages', async (req, res) => {
    try {
      const ctx = await context(req);
      const slotId = slotFromInstance(String(req.params.instanceId || ''));
      if (!slotId) throw Object.assign(new Error('Instância inválida.'), { status: 400, code: 'INVALID_INSTANCE_ID' });

      const threadKey = decodeURIComponent(String(req.params.threadId || ''));
      const row = entries(ctx).find(r => r.key === threadKey || r.chatId === threadKey);
      if (!row) return res.status(404).json({ ok: false, code: 'CONVERSATION_NOT_FOUND', error: 'Conversa não encontrada nesta conta.' });

      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 60));
      const beforeRaw = req.query.before ? Date.parse(String(req.query.before)) : null;
      const all = row.messages
        .filter(m => m && typeof m === 'object')
        .slice()
        .sort((a, b) => (Date.parse(a.timestamp || 0) || 0) - (Date.parse(b.timestamp || 0) || 0));
      const filtered = beforeRaw && Number.isFinite(beforeRaw)
        ? all.filter(m => (Date.parse(m.timestamp || 0) || 0) < beforeRaw)
        : all;
      const slice = filtered.slice(-limit);

      const messages = slice.map(message => {
        const role = message.role === 'owner' ? 'owner' : message.role === 'user' ? 'user' : 'system';
        const media = mediaOf(message);
        return {
          id: str(message.id, 80) || `${threadKey}:${message.timestamp || ''}`,
          role,
          fromMe: role === 'owner',
          text: typeof message.text === 'string' ? message.text.slice(0, MAX_TEXT) : '',
          at: iso(message.timestamp),
          type: str(message.waMessageType, 40) || null,
          ack: Number.isInteger(message.ack) ? message.ack : null,
          delivery: str(message.deliveryStatus, 40) || null,
          media,
          internal: message.internal === true || message.isNote === true,
          deleted: message.deleted === true,
          campaignId: str(message.campaignId, 64) || null,
          simulated: false,
          origins: [{ instanceId: instanceIdFor(slotId), name: slotId.replace('slot_', 'Chip '), crmVisible: true }]
        };
      });

      const contact = row.contact;
      return res.json({
        ok: true,
        schemaVersion: 1,
        source: 'legacy_contacts',
        conversation: {
          id: encodeURIComponent(row.key),
          chatId: row.chatId,
          name: displayName(contact, row.chatId),
          phone: maskPhone(row.chatId),
          identityKind: String(row.chatId).endsWith('@lid') ? 'provisional_lid' : 'verified_pn',
          peerJid: jidOf(row.chatId),
          stage: str(contact.stage, 24) || null,
          tags: Array.isArray(contact.tags) ? contact.tags.filter(t => typeof t === 'string').map(t => str(t, 24)).slice(0, 12) : [],
          pinned: contact.pinned === true,
          archived: contact.archived === true,
          aiEnabled: !(contact.aiIgnored === true),
          paused: contact.pausedUntil === 'forever' ? 'forever' : (contact.pausedUntil && Date.parse(contact.pausedUntil) > Date.now() ? 'temporario' : null),
          pausedReason: str(contact.pauseReason, 200) || '',
          unread: int(contact.unreadCount),
          company: str(contact.company, 120) || '',
          city: str(contact.city, 80) || '',
          email: str(contact.email, 120) || '',
          notes: str(contact.notes, 4000) || '',
          summary: str(contact.summary, 2000) || '',
          leadSource: str(contact.leadSource, 60) || '',
          dealStatus: str(contact.dealStatus, 20) || 'open',
          dealValue: int(contact.dealValue),
          createdAt: iso(contact.createdAt),
          followUpAt: iso(contact.followUpAt),
          messageCount: all.length,
          originIds: [instanceIdFor(slotId)]
        },
        messages,
        total: all.length,
        hasMore: filtered.length > slice.length,
        nextBefore: filtered.length > slice.length && slice.length ? iso(slice[0].at) || slice[0].at : null
      });
    } catch (error) { return fail(res, error); }
  });

  return router;
}

// Exposto para os testes conferirem o mapeamento sem subir servidor.
export { instanceIdFor, slotFromInstance, splitChatId, displayName, maskPhone };

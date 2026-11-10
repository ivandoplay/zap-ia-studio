/** Ingresso Evolution: autenticação, isolamento, persistência antes de IA e envio sem retry. */
import express, { Router } from 'express';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { generateSmartReply } from './aiEngine.js';
import { getAdminClient } from './supabaseCloud.js';
import { buildContactChannelKey } from './storage.js';
import { trueNowIso } from './trueClock.js';
import { requireEvolutionMessageId } from './evolutionApiResponse.js';
import { createDraftSecrets } from './draftSecrets.js';
import { evolutionInstanceIdentity, evolutionBoolean, evolutionTimestamp, evolutionAck, unwrapEvolutionMessage } from './evolutionIdentity.js';
import { pedidoExplicitoParada } from './campanhaResposta.js';

function textOf(m) {
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || '';
}
function placeholder(m) {
  return m.audioMessage ? '[Áudio recebido]' : m.imageMessage ? '[Imagem recebida]' : m.videoMessage ? '[Vídeo recebido]' : m.documentMessage ? '[Documento recebido]' : m.stickerMessage ? '[Figurinha recebida]' : '';
}
function secureEquals(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// Factory permite testar o mesmo router com Supabase/IA/transporte sintéticos, sem abrir WhatsApp.
export function createEvolutionWebhookRouter({ env = process.env, adminClient = getAdminClient, replyGenerator = generateSmartReply, fetcher = globalThis.fetch } = {}) {
  const router = Router(), memory = new Map(), seen = new Set(), receipts = new Map();
  const cloud = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  router.use(express.json({ limit: '10mb' }));
  router.get('/health', (_req, res) => res.json({ ok: true }));
  router.get('/status', (_req, res) => res.json({ ok: true, evolutionApiConfigured: Boolean(env.EVOLUTION_API_KEY), webhookAuthenticated: Boolean(env.EVOLUTION_WEBHOOK_SECRET), supabase: cloud }));
  router.post(['/send', '/clear'], (_req, res) => res.status(404).json({ ok: false, error: 'Rota desativada.' }));


// Versão ATIVA das regras de Segurança (a que o dono ativou no painel novo).
// Lida do workspace da conta; documento de rascunho sem `active` é ignorado.
// Chaves de IA do painel novo. O dono salva a chave na aba IA (cofre cifrado); o atendimento
// precisa LER essa mesma chave, senão a aba não governa nada. Sem cofre, cai nas chaves vivas.
let secretsVault = null;
function vault() {
  if (secretsVault) return secretsVault;
  try { secretsVault = createDraftSecrets(); } catch { secretsVault = null; }
  return secretsVault;
}
async function aiSettingsDraft(userId) {
  try {
    const { data, error } = await adminClient().from('ienvia_workspace_drafts')
      .select('document').eq('owner_id', userId).eq('namespace', 'ai').maybeSingle();
    const doc = data?.document;
    if (error || !doc || doc.active !== true) return null;
    return doc;
  } catch { return null; }
}
// Aplica a IA ativa SOBRE as settings vivas. A chave aberta nunca é registrada em log.
function applyActiveAi(live, doc, userId) {
  const out = { ...live };
  const settingsAi = doc.settings?.ai;
  if (settingsAi && typeof settingsAi === 'object') {
    const merged = { ...(live.ai || {}), ...settingsAi };
    // Chaves vivas continuam valendo para campos que o rascunho não trata.
    const creds = doc.credentials || {};
    for (const field of ['gemini', 'openrouter']) {
      const entry = creds[field];
      if (!entry || entry.action === 'inherit') continue;
      const keyField = field === 'gemini' ? 'geminiApiKey' : `${field}ApiKey`;
      if (entry.action === 'clear') { merged[keyField] = ''; continue; }
      const v = vault();
      if (!v || entry.action !== 'replace') continue;
      try {
        const opened = v.vault.open(field, entry.envelope, userId);
        // `pool` aceita várias chaves (uma por linha); as demais são uma só.
        const value = typeof opened === 'string' ? opened : String(opened?.value || '');
        if (field === 'gemini' && entry.count > 1) merged.geminiKeyPool = value;
        merged[keyField] = value.split('\n')[0];
      } catch { /* cofre indisponível: mantém a chave viva, nunca quebra o atendimento */ }
    }
    out.ai = merged;
  }
  if (typeof doc.settings?.botEnabled === 'boolean') out.botEnabled = doc.settings.botEnabled;
  return out;
}
async function activeSecuritySettings(userId) {
  try {
    const { data, error } = await adminClient().from('ienvia_workspace_drafts')
      .select('document').eq('owner_id', userId).eq('namespace', 'security').maybeSingle();
    if (error || !data?.document || data.document.active !== true) return null;
    const s = data.document.settings;
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch { return null; }
}
// Só os campos que o atendimento consome entram; o resto do documento não vaza para as settings.
function applyActiveSecurity(live, active) {
  const out = { ...live };
  if (typeof active.botEnabled === 'boolean') out.botEnabled = active.botEnabled;
  if (Array.isArray(active.ignoredContacts)) out.ignoredContacts = active.ignoredContacts.filter(x => x && typeof x.phone === 'string').map(x => ({ phone: x.phone, name: String(x.name || '') }));
  for (const k of ['humanHandoff', 'antiBan', 'schedule']) {
    if (active[k] && typeof active[k] === 'object' && !Array.isArray(active[k])) out[k] = { ...(live[k] || {}), ...active[k] };
  }
  return out;
}
  async function tenantFor(identity) {
    if (!cloud) return { settings: { botEnabled: false }, profile: {}, slotEnabled: false };
    const admin = adminClient();
    const [u, w, slot] = await Promise.all([
      admin.from('zapia_users').select('is_active,max_wa_slots,role').eq('user_id', identity.userId).maybeSingle(),
      admin.from('zapia_workspaces').select('business,settings').eq('user_id', identity.userId).maybeSingle(),
      admin.from('zapia_wa_slots').select('ai_enabled').eq('user_id', identity.userId).eq('slot_id', identity.slotId).maybeSingle(),
    ]);
    if (u.error || w.error || slot.error) throw new Error('tenant_read_failed');
    if (!u.data?.is_active || !w.data || (u.data.role !== 'master' && Number(identity.slotId.slice(-1)) > Number(u.data.max_wa_slots || 1))) throw Object.assign(new Error('tenant_inactive'), { statusCode: 403 });
    // Regras de Segurança ATIVAS: a aba Segurança do painel novo grava em
    // ienvia_workspace_drafts (rascunho). Sem aplicar a versão aprovada, ligar/desligar IA,
    // horário e handoff ali não valeria nada — e desligar o painel antigo apagaria o ajuste.
    // Aqui a versão ativa é aplicada SOBRE as settings vivas; sem ativação, nada muda.
    const live = w.data.settings || {};
    const security = await activeSecuritySettings(identity.userId);
    const aiDoc = await aiSettingsDraft(identity.userId);
    let merged = security ? applyActiveSecurity(live, security) : live;
    if (aiDoc) merged = applyActiveAi(merged, aiDoc, identity.userId);
    return { settings: merged, profile: w.data.business || {}, slotEnabled: slot.data?.ai_enabled !== false && merged?.waSlots?.[identity.slotId]?.aiEnabled !== false };
  }
  async function merge(identity, chatId, messages = [], { name = '', event = '', ackId = '', ack = 0, patch = {} } = {}) {
    if (cloud) {
      const { data, error } = await adminClient().rpc('ienvia_merge_evolution_contact', { p_owner: identity.userId, p_chat: chatId, p_messages: messages, p_name: name, p_event: event, p_ack_id: ackId, p_ack: ack, p_patch: patch });
      if (error || !data?.contact || typeof data.inserted !== 'boolean') throw new Error('projection_failed');
      return data;
    }
    const scope = `${identity.userId || identity.instanceName}:${chatId}`, eventKey = `${scope}:${event}`;
    const inserted = !event || !seen.has(eventKey);
    if (event) seen.add(eventKey);
    const contact = memory.get(scope) || { messages: [] };
    if (ackId) receipts.set(`${scope}:${ackId}`, Math.max(receipts.get(`${scope}:${ackId}`) || 0, ack));
    for (const m of messages) {
      const old = contact.messages.find(x => (x.waMsgId || x.id) === (m.waMsgId || m.id) || x.id === m.id);
      if (old) Object.assign(old, m); else contact.messages.push({ ...m });
    }
    for (const m of contact.messages) { const level = receipts.get(`${scope}:${m.waMsgId || m.id}`); if (level) { m.ack = Math.max(m.ack || 0, level); delete m.deliveryStatus; } }
    Object.assign(contact, patch); memory.set(scope, contact);
    return { inserted, contact };
  }
  const evolutionBaseUrl = () => String(env.EVOLUTION_API_URL || 'https://pool-evolution-api-067.cloud2.pageup.dev.br').replace(/\/+$/, '');
  async function send(instanceName, number, text, settings = {}) {
    const antiBan = settings.antiBan || {};
    if (antiBan.simulateTyping !== false) {
      const minMs = Number(antiBan.minTypingMs) || 1500;
      const maxMs = Number(antiBan.maxTypingMs) || 5000;
      const delay = Math.min(maxMs, Math.max(minMs, String(text).length * 24));
      try {
        await fetcher(evolutionBaseUrl() + '/chat/sendPresence/' + encodeURIComponent(instanceName), {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
          headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number, delay, presence: 'composing' })
        });
      } catch { /* Presença é auxiliar; não bloquear o envio por falha no indicador. */ }
    }
    const response = await fetcher(evolutionBaseUrl() + '/message/sendText/' + encodeURIComponent(instanceName), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ number, text: String(text) })
    });
    if (!response.ok) throw new Error('provider_rejected');
    const result = requireEvolutionMessageId(JSON.parse(await response.text()));
    return result.key?.id || result.data?.key?.id || result.data?.id || result.id;
  }
  function splitReplyText(text, settings = {}) {
    const fullText = String(text || '').trim();
    if (settings.antiBan?.splitLongMessages === false || fullText.length <= 260 || !fullText.includes('\n\n')) return [fullText];
    const parts = fullText.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) return [fullText];
    if (parts.length <= 3) return parts;
    return [parts[0], parts.slice(1, -1).join('\n\n'), parts[parts.length - 1]];
  }
  function isWithinBusinessSchedule(schedule = {}, now = new Date()) {
    if (!schedule || schedule.mode === 'always') return { active: true, sendOffHoursNotice: false };
    let day, minutes;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone || 'America/Fortaleza', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
      const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
      day = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[map.weekday];
      minutes = Number(map.hour) * 60 + Number(map.minute);
    } catch { day = now.getDay(); minutes = now.getHours() * 60 + now.getMinutes(); }
    const [sh, sm] = String(schedule.startHour || '08:00').split(':').map(Number);
    const [eh, em] = String(schedule.endHour || '18:00').split(':').map(Number);
    const start = sh * 60 + (sm || 0), end = eh * 60 + (em || 0);
    const workDays = Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5, 6];
    const inside = workDays.includes(day) && minutes >= start && minutes <= end;
    if (schedule.mode === 'business_hours_only') return { active: inside, sendOffHoursNotice: !inside };
    if (schedule.mode === 'outside_hours_only') return { active: !inside, sendOffHoursNotice: false };
    return { active: true, sendOffHoursNotice: false };
  }
  async function processRecord(identity, tenant, data, eventKey, historical = false) {
    const info = data.Info || data.info || {}, key = data.key || info.Key || {};
    const jid = String(key.remoteJid || info.Chat || info.Sender || data._chat || data.remoteJid || '');
    // Broadcast, status, grupos e newsletters nunca entram no atendimento automático.
    if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) return { ignored: 'jid' };
    const chatId = buildContactChannelKey(identity.slotId, jid.replace(/:\d+@/, '@'));
    if (eventKey === 'MESSAGES_UPDATE') {
      const id = key.id || data.id;
      const ack = evolutionAck(data.update?.status ?? data.status ?? data.ack ?? data.data?.status);
      if (!id || !ack) return { updated: 0 };
      await merge(identity, chatId, [], { ackId: String(id), ack }); return { updated: cloud ? 1 : 0 };
    }
    const m = unwrapEvolutionMessage(data.message || data.Message || {}), text = textOf(m), fallback = placeholder(m);
    let media = null;
    const b64 = data.base64 || m.base64;
    const mimeType = m.audioMessage?.mimetype || m.imageMessage?.mimetype;
    if (typeof b64 === 'string' && b64.length <= 10 * 1024 * 1024 && /^(audio\/(ogg|mpeg|mp4|wav|webm)|image\/(jpeg|png|webp))(;.*)?$/.test(mimeType || '')) {
      const raw = b64.replace(/^data:[^;]+;base64,/, '');
      if (/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) { const buffer = Buffer.from(raw, 'base64'); if (buffer.length && buffer.length <= 7 * 1024 * 1024) media = { mimeType, buffer }; }
    }
    if (!text && !fallback && !media) return { ignored: 'no-text' };
    const id = String(key.id || info.ID || info.Id || data.id || '');
    // Sem ID não há deduplicação segura; não gerar resposta nem simular identidade com Date.now().
    if (!id || id.length > 300) return { ignored: 'missing-id' };
    const fromMe = evolutionBoolean(key.fromMe ?? key.IsFromMe ?? info.IsFromMe ?? data.fromMe ?? data.IsFromMe) || eventKey === 'SEND_MESSAGE';
    const timestamp = evolutionTimestamp(data.messageTimestamp ?? info.Timestamp ?? info.TimestampMS ?? data.timestamp);
    const turn = { id, waMsgId: id, waMsgKey: key, role: fromMe ? 'owner' : 'user', text: text || fallback, timestamp, ...(historical ? { historical: true } : {}), ...(fallback ? { historyMediaUnavailable: true } : {}) };
    // O ingresso fica durável ANTES da chamada de IA. Repetição não autoriza uma segunda resposta.
    const saved = await merge(identity, chatId, [turn], { name: String(data.pushName || jid.split('@')[0]), event: `message:${id}` });
    if (historical) return { historical: true, saved: 1 };
    const settings = tenant.settings || {};
    if (fromMe) {
      if (settings.humanHandoff?.pauseOnOwnerReply !== false) {
        const pauseForever = Boolean(tenant.profile?.lockUntilManualResume);
        const pauseMinutes = Math.max(5, Number(settings.humanHandoff?.pauseDurationMinutes) || 60);
        await merge(identity, chatId, [], { patch: {
          pausedUntil: pauseForever ? 'forever' : new Date(Date.now() + pauseMinutes * 60000).toISOString(),
          pauseReason: 'Você respondeu manualmente pelo WhatsApp'
        } });
      }
      return { persisted: true, role: 'owner' };
    }
    if (!saved.inserted) return { duplicate: true };
    const contact = saved.contact;
    const ignored = contact.aiIgnored || (settings.ignoredContacts || []).some(x => String(x.phone || '').replace(/\D/g, '') === phone);
    const paused = contact.pausedUntil === 'forever' || Date.parse(contact.pausedUntil || '') > Date.now();
    if (pedidoExplicitoParada(text)) {
      await merge(identity, chatId, [], { patch: { aiIgnored: true, pausedUntil: 'forever', pauseReason: 'Pedido explícito de não receber mensagens.' } });
      return { persisted: true, optOut: true };
    }
    const iaEnabled = settings.botEnabled !== false && tenant.slotEnabled && !ignored && !paused;
    const schedule = isWithinBusinessSchedule(settings.schedule || {});
    if (!schedule.active) {
      const offHoursText = String(settings.schedule?.offHoursReplyMessage || '').trim();
      const lastNotice = Date.parse(contact.offHoursNotifiedAt || '') || 0;
      if (schedule.sendOffHoursNotice && offHoursText && phone && env.EVOLUTION_API_KEY && Date.now() - lastNotice >= 6 * 60 * 60 * 1000) {
        const notice = { id: 'evo-hours-' + randomUUID(), role: 'assistant', text: offHoursText, timestamp: trueNowIso(), deliveryStatus: 'uncertain' };
        try {
          await merge(identity, chatId, [notice]);
          const sentId = await send(identity.instanceName, phone, offHoursText, settings);
          await merge(identity, chatId, [{ ...notice, waMsgId: sentId, deliveryStatus: 'accepted' }], { patch: { offHoursNotifiedAt: trueNowIso() } });
        } catch { console.warn('[EvolutionWebhook] Aviso fora do horário não confirmado.'); }
      }
      return { persisted: true, iaEnabled: false, outsideBusinessHours: true };
    }
    if (!iaEnabled || !env.EVOLUTION_API_KEY || !phone || (!text && !media)) return { persisted: true, iaEnabled };
    let pending = [];
    try {
      const reply = await replyGenerator({ profile: tenant.profile, settings, history: contact.messages.filter(x => x.id !== id && x.role !== 'internal_note').slice(-60), userText: text, media, contactName: contact.name || phone, allowDemoFallback: false });
      if (!reply?.cleanText || reply.actions?.optOutReason || reply.actions?.courtesySilence || reply.actions?.silentPauseReason) {
        if (reply?.actions?.optOutReason) await merge(identity, chatId, [], { patch: { aiIgnored: true, pausedUntil: 'forever', pauseReason: 'Opt-out detectado.' } });
        return { persisted: true, iaEnabled };
      }
      const fresh = await tenantFor(identity), current = await merge(identity, chatId);
      const freshSchedule = isWithinBusinessSchedule(fresh.settings?.schedule || {});
      if (fresh.settings.botEnabled === false || !fresh.slotEnabled || !freshSchedule.active || current.contact.aiIgnored || current.contact.pausedUntil === 'forever' || Date.parse(current.contact.pausedUntil || '') > Date.now()) return { persisted: true, iaEnabled: false };
      const chunks = splitReplyText(reply.cleanText, fresh.settings);
      pending = chunks.map(text => ({ id: 'evo-ai-' + randomUUID(), role: 'assistant', text, timestamp: trueNowIso(), deliveryStatus: 'uncertain' }));
      await merge(identity, chatId, pending);
      for (const item of pending) {
        const sentId = await send(identity.instanceName, phone, item.text, fresh.settings);
        await merge(identity, chatId, [{ ...item, waMsgId: sentId, deliveryStatus: 'accepted' }]);
      }
      return { persisted: true, accepted: true, chunks: pending.length, iaEnabled };
    } catch {
      console.warn('[EvolutionWebhook] Falha de resposta; entrada preservada, sem reenvio automático.');
      return { persisted: true, replyUncertain: Boolean(pending.length), replyFailed: true };
    }
  }

  router.post('/webhook', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const secret = env.EVOLUTION_WEBHOOK_SECRET;
    const isolated = env.ZAPIA_ISOLATED_TEST === '1' && !env.VERCEL && !env.VERCEL_ENV && !cloud;
    if (!cloud && !isolated) return res.status(503).json({ ok: false, error: 'Persistência durável do webhook não configurada.' });
    if (!secret && !isolated) return res.status(503).json({ ok: false, error: 'Autenticação do webhook não configurada.' });
    if (secret && !secureEquals(req.get('x-ienvia-webhook-secret'), secret)) return res.status(401).json({ ok: false, error: 'Webhook não autorizado.' });
    const instanceName = req.body?.instance?.data?.instance || req.body?.instance?.instanceName || req.body?.instance;
    let identity = evolutionInstanceIdentity(instanceName, env);
    if (!identity && isolated && /^zap-ia-slot_[1-3]$/.test(instanceName)) identity = { userId: null, slotId: instanceName.slice(-6) };
    if (!identity) return res.status(403).json({ ok: false, error: 'Instância sem mapeamento autorizado.' });
    identity = { ...identity, instanceName };
    const data = req.body?.instance?.data || req.body?.data || {};
    const event = String(req.body?.event || data.event || 'MESSAGE').trim().toUpperCase().replace(/[.\s-]+/g, '_');
    const historical = ['HISTORY_SYNC', 'HISTORYSYNC', 'MESSAGES_SET'].includes(event);
    if (!historical && !['MESSAGE', 'MESSAGE_RECEIVED', 'MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE'].includes(event)) return res.json({ ok: true, ignored: 'event' });
    let rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [data];
    if (historical) {
      const conversations = data.conversations || data.Conversations;
      rows = data.messages || data.Messages || data.history || data.History || (Array.isArray(conversations) ? conversations.flatMap(c => (c.messages || c.Messages || []).map(m => ({ ...m, _chat: c.id || c.chat || c.Info?.Chat || c.Jid }))) : []);
    }
    if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ ok: false, error: 'Lote inválido.' });
    try {
      const tenant = await tenantFor(identity), results = [];
      for (const row of rows) results.push(await processRecord(identity, tenant, row || {}, event, historical));
      if (event === 'MESSAGES_UPDATE') return res.json({ ok: true, updated: results.reduce((n, r) => n + (r.updated || 0), 0), event });
      if (historical) return res.json({ ok: true, historical: true, saved: results.reduce((n, r) => n + (r.saved || 0), 0) });
      return res.json({ ok: true, ...(results.length === 1 ? results[0] : { processed: results.length, results }) });
    } catch (error) {
      // Falha ANTES da projeção: o provedor pode repetir; dedupe no banco protege os já persistidos.
      return res.status(error.statusCode || 503).json({ ok: false, error: 'Não foi possível persistir o evento Evolution.' });
    }
  });
  return router;
}
export const evolutionApiWebhookRouter = createEvolutionWebhookRouter();

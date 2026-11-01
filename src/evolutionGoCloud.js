/**
 * Evolution Go Cloud Bridge Router
 * Permite ao painel nuvem (Vercel) conectar WhatsApp via Evolution Go API sem motor local (Termux/PC).
 *
 * Fluxo:
 *   1. Criar instância (POST /instance/create)
 *   2. Conectar (POST /instance/connect) → QR code ou código de pareamento
 *   3. Status (GET /instance/status)
 *   4. Reconectar (POST /instance/reconnect)
 *   5. Desconectar (POST /instance/disconnect)
 *
 * Mount no server.js: app.use('/api/evolution-cloud', evolutionGoCloudRouter)
 */

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'crypto';

export const evolutionGoCloudRouter = Router();
evolutionGoCloudRouter.use(express.json({ limit: '10mb' }));
// The global Evolution pool API key currently serves one configured tenant only.
// Fail closed for other accounts until per-tenant instance credentials are provisioned.
evolutionGoCloudRouter.use((req, res, next) => {
  if (process.env.VERCEL) {
    const userId = req.cloudAuth?.authUser?.id;
    const allowed = Boolean(userId && userId === process.env.EVOLUTION_DEFAULT_USER_ID && !req.cloudAuth?.isRemoteImpersonation);
    if (!allowed) return res.status(userId ? 403 : 401).json({ ok: false, error: 'Esta conta não tem Evolution Go configurado.' });
  }
  next();
});

const EVOLUTION_GO_URL = process.env.EVOLUTION_GO_URL || 'https://pool-evolution-go-025.cloud2.pageup.dev.br';
const EVOLUTION_GO_API_KEY = process.env.EVOLUTION_GO_API_KEY || 'de641771b68731fb4340696241bd2cd6';

// Cache de instâncias no formato que o painel espera (waState.slots)
const instanceCache = new Map(); // slotId → { instanceId, name, token, status, qrDataUrl, pairingCode, ... }

/**
 * Faz requisição à API Evolution Go com a chave global.
 */
async function evolutionGoFetch(path, options = {}, tokenOverride = null) {
  const headers = {
    'apikey': tokenOverride || EVOLUTION_GO_API_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const url = `${EVOLUTION_GO_URL}${path}`;
  try {
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/**
 * Lista todas as instâncias da conta.
 */
async function listInstances() {
  const result = await evolutionGoFetch('/instance/all');
  if (result.ok && Array.isArray(result.data?.data)) {
    return result.data.data;
  }
  return [];
}

/**
 * Cria uma nova instância na Evolution Go.
 */
async function createInstance(instanceId, name, token) {
  return evolutionGoFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({ instanceId, name, token }),
  });
}

/**
 * Busca a instância por nome.
 */
async function findInstanceByName(name) {
  const instances = await listInstances();
  return instances.find(i => i.name === name);
}

async function resolveSlotInstance(slotId, userId = null) {
  const cached = instanceCache.get(slotId);
  if (cached?.token && (!userId || instanceOwnedBy({ name:cached.name }, userId))) return cached;
  const instances = (await listInstances()).filter((i) => !userId || instanceOwnedBy(i, userId));
  const named = instances.find((i) => i.name === `zap-ia-${slotId}`);
  const legacy = slotId === 'slot_1' ? instances.find((i) => i.connected && !/^zap-ia-slot_\d+/.test(i.name || '')) : null;
  const inst = legacy || named;
  if (!inst?.token) return null;
  const resolved = { instanceId: inst.id, name: inst.name, token: inst.token, status: inst.connected ? 'connected' : 'disconnected', qrDataUrl: inst.qrcode || null, pairingCode: null };
  instanceCache.set(slotId, resolved);
  return resolved;
}

/**
 * Busca ou cria uma instância para um slot.
 */
async function ensureInstance(slotId, suffix, userId = null) {
  const name = `zap-ia-${slotId}${suffix ? '-' + suffix : ''}`;
  const available = (await listInstances()).filter((i) => !userId || instanceOwnedBy(i, userId));
  const namedInstance = available.find((i) => i.name === name);
  const connectedLegacy = slotId === 'slot_1' ? available.find((i) => i.connected && !/^zap-ia-slot_\d+/.test(i.name || '')) : null;
  let instance = connectedLegacy || namedInstance;
  if (!instance) {
    const instanceId = randomUUID();
    const token = `zap_ia_${slotId}_${Date.now().toString(36)}`;
    const createResult = await createInstance(instanceId, name, token);
    if (createResult.ok) {
      instance = {
        id: instanceId,
        name,
        token,
        data: { id: instanceId, name, token },
      };
      // Aguarda um pouco para a instância estar disponível
      await new Promise(r => setTimeout(r, 1500));
    } else {
      return { error: `Falha ao criar instância: ${createResult.data?.error || createResult.error}` };
    }
  }
  return { instance };
}

/**
 * Conecta a instância e obtém QR code.
 */
async function connectInstance(instanceToken, webhookUrl = null) {
  const body = { immediate: false, subscribe: ['ALL'] };
  if (webhookUrl) body.webhookUrl = webhookUrl;
  return evolutionGoFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceToken);
}

/**
 * Obtém o QR code de uma instância.
 */
async function getInstanceQr(instanceToken) {
  return evolutionGoFetch('/instance/qr', { method: 'GET' }, instanceToken);
}

/**
 * Gera código de pareamento para um número.
 */
async function requestPairingCode(instanceToken, phone) {
  return evolutionGoFetch('/instance/pair', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  }, instanceToken);
}

/**
 * Reconecta uma instância.
 */
async function reconnectInstance(instanceToken) {
  return evolutionGoFetch('/instance/reconnect', {
    method: 'POST',
    body: JSON.stringify({}),
  }, instanceToken);
}

/**
 * Desconecta uma instância.
 */
async function disconnectInstance(instanceToken) {
  return evolutionGoFetch('/instance/disconnect', {
    method: 'POST',
    body: JSON.stringify({}),
  }, instanceToken);
}

/**
 * Obtém o status de uma instância.
 */
async function getInstanceStatus(instanceToken) {
  return evolutionGoFetch('/instance/status', { method: 'GET' }, instanceToken);
}

// A API Evolution Go já retorna QR code como data URL (data:image/png;base64,...)
// não é necessário converter — o valor é usado diretamente.

// ======================== ROTAS ========================

/**
 * GET /api/evolution-cloud/status
 * Retorna o estado atual das instâncias Evolution Go.
 */
evolutionGoCloudRouter.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const statusUserId = req.cloudAuth?.authUser?.id || null;
    const instances = (await listInstances()).filter((inst) => !statusUserId || instanceOwnedBy(inst, statusUserId));
    const slots = {};
    for (const inst of instances) {
      // Parse slot ID from instance name (zap-ia-slot_1)
      const slotMatch = inst.name?.match(/zap-ia-(slot_\d+)/);
      const slotId = slotMatch ? slotMatch[1] : (inst.connected && slots.slot_1?.status !== 'connected' ? 'slot_1' : null);
      if (!slotId) continue;
      const candidate = { slotId, instanceId: inst.id, name: inst.name, status: inst.connected ? 'connected' : 'disconnected', phone: inst.jid ? inst.jid.split(':')[0] : null, webhookUrl: inst.webhook || null };
      if (!slots[slotId] || (candidate.status === 'connected' && slots[slotId].status !== 'connected')) slots[slotId] = candidate;
    }

    // Check cache for QR codes and pairing codes
    for (const [slotId, cached] of instanceCache.entries()) {
      if (!slots[slotId]) {
        slots[slotId] = { slotId, ...cached };
      } else {
        slots[slotId].qrDataUrl = cached.qrDataUrl || null;
        slots[slotId].pairingCode = cached.pairingCode || null;
      }
    }

    res.json({
      ok: true,
      available: true,
      slots,
      instanceCount: instances.length,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, available: false });
  }
});

/**
 * POST /api/evolution-cloud/connect
 * Cria/reusa instância, conecta e retorna QR code.
 * Body: { slotId, pairingPhone }
 */
evolutionGoCloudRouter.post('/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const pairingPhone = req.body?.pairingPhone || null;

    // Busca ou cria instância
    const { instance, error } = await ensureInstance(slotId, undefined, req.cloudAuth?.authUser?.id || null);
    if (error) return res.status(500).json({ ok: false, error });

    const instanceToken = instance.token;

    // Se foi solicitado código de pareamento
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${baseUrl}/api/evolution-webhook/webhook`;
    // Pair endpoint does not accept webhookUrl; configure instance first, then request pairing code.
    const configureResult = await connectInstance(instanceToken, webhookUrl);
    if (!configureResult.ok && !String(configureResult.data?.error || '').toLowerCase().includes('already')) {
      return res.status(502).json({ ok: false, error: `Falha ao configurar webhook: ${configureResult.data?.error || configureResult.error}` });
    }
    if (pairingPhone) {
      const pairResult = await requestPairingCode(instanceToken, pairingPhone);
      if (pairResult.ok) {
        const code = pairResult.data?.data?.PairingCode || pairResult.data?.data?.code || pairResult.data?.PairingCode || pairResult.data?.code || null;
        // Cache do código de pareamento
        instanceCache.set(slotId, {
          instanceId: instance.id,
          name: instance.name,
          token: instanceToken,
          status: 'qr_ready',
          pairingCode: code,
          qrDataUrl: null,
        });
        return res.json({
          ok: true,
          slotId,
          instanceId: instance.id,
          status: 'qr_ready',
          pairingCode: code,
          qrDataUrl: null,
        });
      }
      const errMsg = pairResult.data?.error || pairResult.error || '';
      if (errMsg.includes('429') || errMsg.includes('rate-overlimit')) {
        return res.status(429).json({
          ok: false,
          error: 'Número temporariamente limitado pelo WhatsApp (429). Aguarde 15-40 minutos e tente novamente.',
        });
      }
      return res.status(500).json({ ok: false, error: `Falha ao gerar código: ${errMsg}` });
    }

    // Conecta a instância (com webhook configurado para receber mensagens)
    const connectResult = configureResult;

    // Obtém QR code (pode ser assincrono)
    let qrDataUrl = null;
    try {
      const qrResult = await getInstanceQr(instanceToken);
      if (qrResult.ok && qrResult.data?.data) {
        // Formato: { data: { qrcode: "data:image/png;base64,...", code: "https://wa.me/..." } }
        qrDataUrl = qrResult.data.data.qrcode || null;
      }
    } catch {
      // QR pode ainda não estar disponível, voltamos com status connecting
    }

    const status = qrDataUrl ? 'qr_ready' : 'connecting';

    // Cache
    instanceCache.set(slotId, {
      instanceId: instance.id,
      name: instance.name,
      token: instanceToken,
      status,
      qrDataUrl,
      pairingCode: null,
    });

    res.json({
      ok: true,
      slotId,
      instanceId: instance.id,
      status,
      pairingCode: null,
      qrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/refresh-qr
 * Atualiza o QR code de uma instância (para quando ainda não está disponível).
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/refresh-qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = await resolveSlotInstance(slotId, req.cloudAuth?.authUser?.id || null);
    if (!cached) return res.status(404).json({ ok: false, error: 'Instância não encontrada' });

    const qrResult = await getInstanceQr(cached.token);
    let qrDataUrl = null;
    if (qrResult.ok && qrResult.data?.data) {
      qrDataUrl = qrResult.data.data.qrcode || null;
    }

    if (qrDataUrl) {
      cached.qrDataUrl = qrDataUrl;
      cached.status = 'qr_ready';
    }

    res.json({
      ok: true,
      slotId,
      status: cached.status,
      qrDataUrl: qrDataUrl || cached.qrDataUrl,
      pairingCode: cached.pairingCode,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/reconnect
 * Reconecta uma instância existente.
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/reconnect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = await resolveSlotInstance(slotId, req.cloudAuth?.authUser?.id || null);
    if (!cached) return res.status(404).json({ ok: false, error: 'Instância não encontrada' });

    const reconnectResult = await reconnectInstance(cached.token);
    if (!reconnectResult.ok) {
      return res.status(500).json({ ok: false, error: `Falha ao reconectar: ${reconnectResult.data?.error || reconnectResult.error}` });
    }

    // Tenta obter QR code
    let qrDataUrl = null;
    try {
      const qrResult = await getInstanceQr(cached.token);
      if (qrResult.ok && qrResult.data?.data?.qrcode) {
        qrDataUrl = qrResult.data.data.qrcode;
      }
    } catch {}

    cached.status = qrDataUrl ? 'qr_ready' : 'connecting';
    cached.qrDataUrl = qrDataUrl || null;

    res.json({
      ok: true,
      slotId,
      status: cached.status,
      qrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/disconnect
 * Desconecta uma instância.
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/disconnect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = await resolveSlotInstance(slotId, req.cloudAuth?.authUser?.id || null);
    if (!cached) return res.status(404).json({ ok: false, error: 'Instância não encontrada' });

    const logout = req.body?.logout === true;
    const disconnectResult = logout
      ? await evolutionGoFetch('/instance/logout', { method: 'DELETE' }, cached.token)
      : await disconnectInstance(cached.token);
    if (!disconnectResult.ok) return res.status(502).json({ ok: false, error: disconnectResult.data?.error || disconnectResult.error || 'Falha ao desconectar.' });
    cached.status = 'disconnected';
    cached.qrDataUrl = null;
    cached.pairingCode = null;

    res.json({ ok: true, slotId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/delete
 * Deleta uma instância da Evolution Go.
 * Body: { slotId } or { instanceId }
 */
evolutionGoCloudRouter.post('/delete', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || null;
    const instanceId = req.body?.instanceId || null;

    if (!instanceId && !slotId) {
      return res.status(400).json({ ok: false, error: 'Informe slotId ou instanceId' });
    }

    const resolved = slotId ? await resolveSlotInstance(slotId, req.cloudAuth?.authUser?.id || null) : null;
    const ownedById = instanceId ? (await listInstances()).find((inst) => inst.id === instanceId && instanceOwnedBy(inst, req.cloudAuth?.authUser?.id || null)) : null;
    const targetId = instanceId ? ownedById?.id : resolved?.instanceId;
    if (!targetId) {
      return res.status(404).json({ ok: false, error: 'Instância não encontrada' });
    }

    const result = await evolutionGoFetch(`/instance/delete/${targetId}`, { method: 'DELETE' });
    if (result.ok) {
      if (slotId) instanceCache.delete(slotId);
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: `Falha ao deletar: ${result.data?.error || result.error}` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/sync-history
 * Pede à Evolution Go para sincronizar o histórico de um chat específico.
 * As mensagens syncronizadas são enviadas de volta via webhook (já configurado).
 * Body: { slotId, chatId }
 */
evolutionGoCloudRouter.post('/sync-history', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const chatId = req.body?.chatId;
    if (!chatId) return res.status(400).json({ ok: false, error: 'Informe chatId' });

    const { instance, error } = await ensureInstance(slotId, undefined, req.cloudAuth?.authUser?.id || null);
    if (error) return res.status(500).json({ ok: false, error });

    const instanceToken = instance.token;

    // Faz o history-sync (pede à Evolution Go para sincronizar o histórico do chat)
    const result = await evolutionGoFetch('/chat/history-sync', {
      method: 'POST',
      body: JSON.stringify({ count: Math.max(1, Math.min(100, Number(req.body?.count) || 50)), messageInfo: { chat: chatId, id: String(req.body?.messageId || ''), isFromMe: Boolean(req.body?.isFromMe), timestamp: Number(req.body?.timestamp) || 0 } }),
    }, instanceToken);

    if (result.ok) {
      // As mensagens syncronizadas chegam via webhook em seguida
      res.json({ ok: true, chatId, sync: result.data, message: 'Sincronização iniciada. As mensagens chegam via webhook.' });
    } else {
      res.status(500).json({ ok: false, error: result.data?.error || result.error });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
// Retorna o status real dos slots da Evolution Go (para merge no waState do poll)
// Exportado para server.js usar no /api/cloud/poll quando em modo nuvem (vercel_cloud).
export async function getEvolutionGoSlotStatus(userId = null) {
  const instances = (await listInstances()).filter((i) => !userId || instanceOwnedBy(i, userId));
  const slots = {};
  for (const inst of instances) {
    const slotMatch = inst.name?.match(/zap-ia-(slot_\d+)/);
    const slotId = slotMatch ? slotMatch[1] : (inst.connected && slots.slot_1?.status !== 'connected' ? 'slot_1' : null);
    if (!slotId) continue;
    const cached = instanceCache.get(slotId) || {};
    const candidate = {
      slotId,
      instanceId: inst.id,
      name: inst.name,
      status: inst.connected ? 'connected' : 'disconnected',
      phone: inst.jid ? inst.jid.split(':')[0] : null,
      qrDataUrl: inst.qrcode || cached.qrDataUrl || null,
      pairingCode: cached.pairingCode || null,
    };
    if (!slots[slotId] || (candidate.status === 'connected' && slots[slotId].status !== 'connected')) slots[slotId] = candidate;
  }
  return slots;
}

// Obtém os contatos do WhatsApp conectado na Evolution Go (via /user/contacts).
// Retorna um array de contatos no formato do storage (chatId, name, stage, lastMessageAt, messages).
export async function getEvolutionGoContacts(userId = null) {
  const instances = (await listInstances()).filter((i) => !userId || instanceOwnedBy(i, userId));
  const contactsMap = {};
  for (const inst of instances) {
    if (!inst.connected) continue;
    const slotMatch = inst.name?.match(/zap-ia-(slot_\d+)/);
    const slotId = slotMatch ? slotMatch[1] : 'slot_1';
    const token = inst.token || instanceCache.get(slotId)?.token;
    if (!token) continue;
    const result = await evolutionGoFetch('/user/contacts', { method: 'GET' }, token);
    if (result.ok && Array.isArray(result.data?.data)) {
      for (const c of result.data.data) {
        const chatId = c.Jid;
        if (!chatId || contactsMap[chatId]) continue;
        const contactKey = slotId === 'slot_1' ? chatId : `${slotId}::${chatId}`;
        contactsMap[contactKey] = {
          chatId: contactKey,
          name: c.PushName || c.FullName || c.BusinessName || null,
          stage: 'novo',
          lastMessageAt: null,
          messages: [],
          savedContact: false,
        };
      }
    }
  }
  return Object.values(contactsMap);
}

function ownerMap() {
  try { return JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}'); } catch { return {}; }
}
function instanceOwnedBy(inst, userId) {
  return Boolean(userId && (ownerMap()[inst.name] || process.env.EVOLUTION_DEFAULT_USER_ID) === userId);
}
async function connectedInstanceForTenant(userId, chatId = '') {
  if (!userId) throw Object.assign(new Error('Conta inválida para Evolution Go.'), { statusCode: 403 });
  const instances = (await listInstances()).filter((i) => i.connected && instanceOwnedBy(i, userId));
  const parsedSlot = String(chatId || '').match(/^(slot_\d+)::/)?.[1] || '';
  const preferred = parsedSlot && instances.find((i) => i.name === `zap-ia-${parsedSlot}`);
  const inst = preferred || instances.find((i) => /^zap-ia-slot_\d+$/.test(i.name || '')) || instances[0];
  if (!inst?.token) throw Object.assign(new Error('Não há instância Evolution Go conectada para esta conta.'), { statusCode: 503 });
  return inst;
}
function phoneForChat(chatId = '') {
  const raw = String(chatId).split('::').at(-1).replace(/:\d+@/, '@');
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw Object.assign(new Error('Conversa sem telefone válido.'), { statusCode: 400 });
  return digits;
}
async function tenantCall(userId, chatId, path, method, payload) {
  const instance = await connectedInstanceForTenant(userId, chatId);
  const result = await evolutionGoFetch(path, { method, ...(payload ? { body: JSON.stringify(payload) } : {}) }, instance.token);
  if (!result.ok) throw Object.assign(new Error(result.data?.error || result.error || `Evolution Go HTTP ${result.status}`), { statusCode: result.status >= 400 ? result.status : 502, evolutionResponse: result.data });
  return result.data;
}
export async function sendEvolutionGoText(userId, chatId, text, options = {}) {
  return tenantCall(userId, chatId, '/send/text', 'POST', { number: phoneForChat(chatId), text: String(text || ''), formatJid: true, ...(options.quoted ? { quoted: options.quoted } : {}) });
}
export async function sendEvolutionGoMedia(userId, chatId, { url, type, caption = '', filename = '' } = {}) {
  if (!url) throw Object.assign(new Error('URL de mídia ausente.'), { statusCode: 400 });
  return tenantCall(userId, chatId, '/send/media', 'POST', { number: phoneForChat(chatId), url, type: type || 'document', caption, filename, formatJid: true });
}
export async function sendEvolutionGoContact(userId, chatId, contact = {}) {
  return tenantCall(userId, chatId, '/send/contact', 'POST', { number: phoneForChat(chatId), vcard: { fullName:String(contact.name || contact.fullName || ''), organization:String(contact.company || contact.organization || ''), phone:String(contact.phone || '') }, formatJid: true });
}
export async function reactEvolutionGoMessage(userId, chatId, msgId, reaction, fromMe = false) {
  return tenantCall(userId, chatId, '/message/react', 'POST', { number: phoneForChat(chatId), id: String(msgId), reaction: String(reaction || ''), fromMe: Boolean(fromMe) });
}
export async function editEvolutionGoMessage(userId, chatId, msgId, text) {
  return tenantCall(userId, chatId, '/message/edit', 'POST', { chat: phoneForChat(chatId), messageId: String(msgId), message: String(text || '') });
}
export async function deleteEvolutionGoMessage(userId, chatId, msgId) {
  return tenantCall(userId, chatId, '/message/delete', 'POST', { chat: phoneForChat(chatId), messageId: String(msgId) });
}
export async function markEvolutionGoRead(userId, chatId, ids = []) {
  return tenantCall(userId, chatId, '/message/markread', 'POST', { number: phoneForChat(chatId), id: ids.map(String) });
}
export async function blockEvolutionGoContact(userId, chatId, blocked) {
  return tenantCall(userId, chatId, blocked ? '/user/block' : '/user/unblock', 'POST', { number: phoneForChat(chatId) });
}
export async function requestEvolutionGoHistory(userId, chatId, count = 50, anchor = {}) {
  return tenantCall(userId, chatId, '/chat/history-sync', 'POST', { count: Math.min(100, Math.max(1, Number(count) || 50)), messageInfo: { chat: phoneForChat(chatId), id: String(anchor.id || ''), isFromMe: Boolean(anchor.isFromMe), isGroup: false, sender: String(anchor.sender || ''), timestamp: String(anchor.timestamp || '') } });
}

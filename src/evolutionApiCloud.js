/**
 * Ponte cloud para Evolution API v2 (Baileys).
 * Mantém os contratos internos do painel; URLs e credencial vêm do ambiente.
 */
import { Router } from 'express';
import express from 'express';
import { assertEvolutionApiAccepted } from './evolutionApiResponse.js';

export const evolutionApiCloudRouter = Router();
evolutionApiCloudRouter.use(express.json({ limit: '10mb' }));

evolutionApiCloudRouter.use((req, res, next) => {
  if (process.env.VERCEL) {
    const userId = req.cloudAuth?.authUser?.id;
    const allowed = Boolean(userId && userId === process.env.EVOLUTION_DEFAULT_USER_ID && !req.cloudAuth?.isRemoteImpersonation);
    if (!allowed) return res.status(userId ? 403 : 401).json({ ok: false, error: 'Esta conta não tem Evolution API configurada.' });
  }
  next();
});

const API_URL = String(process.env.EVOLUTION_API_URL || 'https://pool-evolution-api-067.cloud2.pageup.dev.br').replace(/\/+$/, '');
const API_KEY = process.env.EVOLUTION_API_KEY || '';
const slotCache = new Map();
const EVENTS = ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONTACTS_UPDATE', 'CHATS_UPDATE'];

function ownerMap() {
  try { return JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}'); } catch { return {}; }
}
function instanceName(slotId) { return `zap-ia-${slotId}`; }
function instanceOwnedBy(instance, userId) {
  const name = instance?.name || instance?.instanceName || instance?.instance?.instanceName || '';
  return Boolean(userId && (ownerMap()[name] || process.env.EVOLUTION_DEFAULT_USER_ID) === userId);
}
function normalizeInstance(raw = {}) {
  const item = raw.instance && typeof raw.instance === 'object' ? { ...raw, ...raw.instance } : raw;
  const name = item.instanceName || item.name || '';
  const state = String(item.connectionStatus || item.state || item.status || '').toLowerCase();
  return {
    ...item,
    name,
    id: item.instanceId || item.id || name,
    connected: item.connected === true || state === 'open' || state === 'connected',
    state: state || 'close',
    phone: item.ownerJid || item.owner || item.number || item.phone || null,
  };
}
function assertConfigured() {
  if (!API_KEY) throw Object.assign(new Error('Evolution API não configurada. Cadastre EVOLUTION_API_KEY como segredo na Vercel.'), { statusCode: 503 });
}
async function apiCall(path, { method = 'GET', body, query = '' } = {}) {
  assertConfigured();
  let response;
  try {
    response = await fetch(`${API_URL}${path}${query}`, {
      method,
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw Object.assign(new Error(`Não foi possível acessar a Evolution API: ${err.message}`), { statusCode: 502 });
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const errorValue = data?.error;
    const message = typeof errorValue === 'string' ? errorValue : errorValue?.message || data?.message;
    throw Object.assign(new Error(String(message || `Evolution API HTTP ${response.status}`)), { statusCode: response.status >= 400 ? response.status : 502 });
  }
  try { return assertEvolutionApiAccepted(data); }
  catch (err) { throw Object.assign(err, { statusCode: err.statusCode || 502 }); }
}
async function listInstances() {
  const data = await apiCall('/instance/fetchInstances');
  const rows = Array.isArray(data) ? data : data.instances || data.data || data.response || [];
  return (Array.isArray(rows) ? rows : []).map(normalizeInstance);
}
async function connectionState(name) {
  const data = await apiCall(`/instance/connectionState/${encodeURIComponent(name)}`);
  const raw = data.instance || data.data?.instance || data.data || data;
  const state = String(raw.state || raw.connectionStatus || raw.status || '').toLowerCase();
  return { state: state === 'connected' ? 'open' : state, phone: raw.ownerJid || raw.owner || raw.number || null };
}
async function setWebhook(name, webhookUrl) {
  return apiCall(`/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: EVENTS } },
  });
}
async function ensureInstance(slotId, userId) {
  const safeSlot = /^slot_[1-3]$/.test(String(slotId)) ? String(slotId) : 'slot_1';
  const name = instanceName(safeSlot);
  const existing = (await listInstances()).find((item) => item.name === name && instanceOwnedBy(item, userId));
  if (existing) return existing;
  const created = await apiCall('/instance/create', {
    method: 'POST',
    body: { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true },
  });
  const nested = created.instance || created.data?.instance || created.data || created;
  return normalizeInstance({ ...nested, instanceName: nested.instanceName || name, name });
}
function slotForChat(chatId = '') {
  return String(chatId).match(/^(slot_[1-3])::/)?.[1] || 'slot_1';
}
function chatJidForChat(chatId = '') {
  const raw = String(chatId).split('::').at(-1).replace(/:\d+@/, '@');
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw Object.assign(new Error('Conversa sem telefone válido.'), { statusCode: 400 });
  return `${digits}@s.whatsapp.net`;
}
function numberForChat(chatId = '') {
  const jid = chatJidForChat(chatId);
  return jid.endsWith('@s.whatsapp.net') ? jid.slice(0, -'@s.whatsapp.net'.length) : jid;
}
async function connectedInstanceForTenant(userId, chatId = '') {
  if (!userId) throw Object.assign(new Error('Conta inválida para Evolution API.'), { statusCode: 403 });
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const requested = slotForChat(chatId);
  const choices = [requested, 'slot_1', 'slot_2', 'slot_3'];
  for (const slotId of [...new Set(choices)]) {
    const item = rows.find((candidate) => candidate.name === instanceName(slotId));
    if (item) {
      const state = await connectionState(item.name).catch(() => ({ state: item.state }));
      if (state.state === 'open') return { ...item, state: 'open', phone: state.phone || item.phone };
    }
  }
  throw Object.assign(new Error('Não há instância Evolution API conectada para esta conta.'), { statusCode: 503 });
}
async function tenantCall(userId, chatId, path, method = 'POST', payload = undefined) {
  const instance = await connectedInstanceForTenant(userId, chatId);
  return apiCall(`${path}/${encodeURIComponent(instance.name)}`, { method, ...(payload !== undefined ? { body: payload } : {}) });
}

// Compatibilidade com os nomes internos atuais; o transporte já é Evolution API v2.
export async function sendEvolutionApiText(userId, chatId, text, options = {}) {
  const number = numberForChat(chatId);
  const body = { number, text: String(text || '') };
  if (options.quoted?.messageId) body.quoted = { key: { id: String(options.quoted.messageId), remoteJid: chatJidForChat(chatId), fromMe: options.quoted.fromMe !== false }, ...(options.quoted.text ? { message: { conversation: String(options.quoted.text) } } : {}) };
  return tenantCall(userId, chatId, '/message/sendText', 'POST', body);
}
export async function sendEvolutionApiMedia(userId, chatId, { url, type = 'document', caption = '', filename = '', mimeType = '' } = {}) {
  if (!url) throw Object.assign(new Error('URL de mídia ausente.'), { statusCode: 400 });
  return tenantCall(userId, chatId, '/message/sendMedia', 'POST', { number: numberForChat(chatId), mediatype: type, media: url, caption, fileName: filename, ...(mimeType ? { mimetype: mimeType } : {}) });
}
export async function sendEvolutionApiContact(userId, chatId, contact = {}) {
  const phone = String(contact.phone || '').replace(/\D/g, '');
  return tenantCall(userId, chatId, '/message/sendContact', 'POST', { number: numberForChat(chatId), contact: [{ fullName: String(contact.name || contact.fullName || ''), wuid: phone, phoneNumber: phone ? `+${phone}` : '', organization: String(contact.company || contact.organization || '') }] });
}
export async function reactEvolutionApiMessage(userId, chatId, msgId, reaction, fromMe = false) {
  return tenantCall(userId, chatId, '/message/sendReaction', 'POST', { key: { remoteJid: chatJidForChat(chatId), fromMe: Boolean(fromMe), id: String(msgId) }, reaction: String(reaction || '') });
}
export async function editEvolutionApiMessage(userId, chatId, msgId, text) {
  return tenantCall(userId, chatId, '/chat/updateMessage', 'POST', { key: { remoteJid: chatJidForChat(chatId), fromMe: true, id: String(msgId) }, text: String(text || '') });
}
export async function deleteEvolutionApiMessage(userId, chatId, msgId) {
  return tenantCall(userId, chatId, '/chat/deleteMessageForEveryone', 'DELETE', { key: { remoteJid: chatJidForChat(chatId), fromMe: true, id: String(msgId) } });
}
export async function markEvolutionApiRead(userId, chatId, ids = []) {
  const remoteJid = chatJidForChat(chatId);
  return tenantCall(userId, chatId, '/chat/markMessageAsRead', 'POST', { readMessages: ids.map((id) => ({ id: String(id), remoteJid, fromMe: false })) });
}
export async function blockEvolutionApiContact(userId, chatId, blocked) {
  return tenantCall(userId, chatId, '/chat/updateBlockStatus', 'POST', { number: numberForChat(chatId), status: blocked ? 'block' : 'unblock' });
}
export async function requestEvolutionApiHistory(userId, chatId, count = 50, anchor = {}) {
  const remoteJid = chatJidForChat(chatId);
  const data = await tenantCall(userId, chatId, '/chat/findMessages', 'POST', { where: { key: { remoteJid } }, page: 1, offset: Math.min(100, Math.max(1, Number(count) || 50)) });
  return { ...data, requested: true, anchor: anchor.id || null };
}

export async function getEvolutionApiSlotStatus(userId = null) {
  if (!userId || !API_KEY) return {};
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const result = {};
  for (const item of rows) {
    const match = item.name.match(/zap-ia-(slot_[1-3])/);
    if (!match) continue;
    const slotId = match[1];
    const state = await connectionState(item.name).catch(() => ({ state: item.state }));
    const cached = slotCache.get(slotId) || {};
    result[slotId] = {
      slotId, instanceId: item.id, name: item.name,
      status: state.state === 'open' ? 'connected' : state.state === 'connecting' ? 'connecting' : 'disconnected',
      phone: state.phone || item.phone || null,
      qrDataUrl: cached.qrDataUrl || null,
      pairingCode: cached.pairingCode || null,
    };
  }
  return result;
}

export async function getEvolutionApiContacts(userId = null) {
  if (!userId) return [];
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const contacts = {};
  for (const item of rows) {
    const state = await connectionState(item.name).catch(() => ({ state: item.state }));
    if (state.state !== 'open') continue;
    const slotId = item.name.match(/zap-ia-(slot_[1-3])/)?.[1] || 'slot_1';
    const data = await apiCall(`/chat/findContacts/${encodeURIComponent(item.name)}`, { method: 'POST', body: { where: {}, take: 1000, skip: 0 } });
    const list = Array.isArray(data) ? data : data.contacts || data.data || data.response || [];
    for (const raw of Array.isArray(list) ? list : []) {
      const jid = raw.remoteJid || raw.id || raw.wuid;
      if (!jid || contacts[jid]) continue;
      const key = slotId === 'slot_1' ? jid : `${slotId}::${jid}`;
      contacts[key] = { chatId: key, name: raw.pushName || raw.name || raw.verifiedName || null, stage: 'novo', lastMessageAt: raw.updatedAt || null, messages: [], savedContact: true };
    }
  }
  return Object.values(contacts);
}

async function connectSlot(slotId, userId, baseUrl, pairingPhone = null) {
  const instance = await ensureInstance(slotId, userId);
  const hookUrl = `${baseUrl}/api/evolution-webhook/webhook`;
  await setWebhook(instance.name, hookUrl);
  const query = pairingPhone ? `?number=${encodeURIComponent(String(pairingPhone).replace(/\D/g, ''))}` : '';
  const data = await apiCall(`/instance/connect/${encodeURIComponent(instance.name)}${query}`);
  const payload = data.data || data;
  const rawQr = payload.base64 || payload.qrcode?.base64 || payload.qrcode || null;
  const qrDataUrl = rawQr ? (String(rawQr).startsWith('data:') ? rawQr : `data:image/png;base64,${rawQr}`) : null;
  const pairingCode = payload.code || payload.pairingCode || null;
  const state = await connectionState(instance.name).catch(() => ({ state: 'connecting' }));
  const status = state.state === 'open' ? 'connected' : qrDataUrl || pairingCode ? 'qr_ready' : 'connecting';
  const slot = { instanceId: instance.id, name: instance.name, status, qrDataUrl, pairingCode };
  slotCache.set(slotId, slot);
  return { slotId, ...slot };
}

evolutionApiCloudRouter.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slots = await getEvolutionApiSlotStatus(req.cloudAuth?.authUser?.id || null);
    return res.json({ ok: true, available: Boolean(API_KEY), slots, instanceCount: Object.keys(slots).length });
  } catch (err) {
    return res.json({ ok: false, available: false, error: err.message, slots: {} });
  }
});
evolutionApiCloudRouter.post('/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl, req.body?.pairingPhone || null)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/refresh-qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/reconnect', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const name = instanceName(slotId);
    await apiCall(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST', body: {} });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/disconnect', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const name = instanceName(slotId);
    await apiCall(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' });
    slotCache.delete(slotId);
    return res.json({ ok: true, slotId });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/delete', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : '';
    if (!slotId) return res.status(400).json({ ok: false, error: 'Informe um slot válido.' });
    await apiCall(`/instance/delete/${encodeURIComponent(instanceName(slotId))}`, { method: 'DELETE' });
    slotCache.delete(slotId);
    return res.json({ ok: true });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/sync-history', async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || '');
    if (!chatId) return res.status(400).json({ ok: false, error: 'Informe chatId.' });
    const data = await requestEvolutionApiHistory(req.cloudAuth?.authUser?.id || null, chatId, req.body?.count || 50);
    return res.json({ ok: true, chatId, sync: data, message: 'Histórico consultado na Evolution API.' });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});

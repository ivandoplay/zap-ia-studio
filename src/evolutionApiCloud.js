/**
 * Ponte cloud para Evolution API v2 (Baileys).
 * Mantém os contratos internos do painel; URLs e credencial vêm do ambiente.
 */
import { Router } from 'express';
import express from 'express';
import { assertEvolutionApiAccepted } from './evolutionApiResponse.js';
import QRCode from 'qrcode';
import { runReadOnlyEvolutionDiagnostics } from './crmV2/readOnlyEvolutionDiagnostics.js';

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
const readOnlyDiagnosticRuns = new Map();
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
  const item = rows.find((candidate) => candidate.name === instanceName(requested));
  if (!item) {
    throw Object.assign(new Error(`Não há instância Evolution API configurada para o chip selecionado (${requested}).`), { statusCode: 503 });
  }
  const state = await connectionState(item.name).catch(() => ({ state: item.state }));
  if (state.state !== 'open') {
    throw Object.assign(new Error(`O chip selecionado (${requested}) está desconectado; a operação não será encaminhada para outro chip.`), { statusCode: 503 });
  }
  return { ...item, state: 'open', phone: state.phone || item.phone };
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
  const remoteJid = chatJidForChat(chatId);
  return tenantCall(userId, chatId, '/chat/updateMessage', 'POST', { number: numberForChat(chatId), key: { remoteJid, fromMe: true, id: String(msgId) }, text: String(text || '') });
}
export async function deleteEvolutionApiMessage(userId, chatId, msgId) {
  return tenantCall(userId, chatId, '/chat/deleteMessageForEveryone', 'DELETE', { id: String(msgId), remoteJid: chatJidForChat(chatId), fromMe: true });
}
export async function markEvolutionApiRead(userId, chatId, ids = []) {
  const readMessages = (Array.isArray(ids) ? ids : []).filter(Boolean).map((id) => ({ id: String(id), remoteJid: chatJidForChat(chatId), fromMe: false }));
  if (!readMessages.length) return { skipped: true, reason: 'no-message-ids' };
  return tenantCall(userId, chatId, '/chat/markMessageAsRead', 'POST', { readMessages });
}
export async function blockEvolutionApiContact(userId, chatId, blocked) {
  return tenantCall(userId, chatId, '/chat/updateBlockStatus', 'POST', { number: numberForChat(chatId), status: blocked ? 'block' : 'unblock' });
}
export async function requestEvolutionApiHistory(userId, chatId, count = 50, anchor = {}, page = 1) {
  const remoteJid = chatJidForChat(chatId);
  const data = await tenantCall(userId, chatId, '/chat/findMessages', 'POST', {
    where: { key: { remoteJid } },
    page: Math.max(1, Math.floor(Number(page) || 1)),
    offset: Math.min(100, Math.max(1, Number(count) || 50))
  });
  return { ...data, requested: true, anchor: anchor.id || null };
}

function unwrapHistoryContent(message = {}) {
  let current = message && typeof message === 'object' ? message : {};
  for (let i = 0; i < 5; i += 1) {
    const nested = current.ephemeralMessage?.message || current.viewOnceMessage?.message || current.viewOnceMessageV2?.message || current.documentWithCaptionMessage?.message;
    if (!nested || typeof nested !== 'object') break;
    current = nested;
  }
  return current;
}

function historyTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function historyMessageText(content, record) {
  const text = content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || content.buttonsResponseMessage?.selectedDisplayText
    || content.templateButtonReplyMessage?.selectedDisplayText
    || content.listResponseMessage?.title
    || content.pollUpdateMessage?.vote?.selectedOptions?.join(', ')
    || '';
  if (text) return String(text);
  if (content.imageMessage) return '[Imagem recebida]';
  if (content.videoMessage) return '[Vídeo recebido]';
  if (content.documentMessage) return `[Arquivo recebido${content.documentMessage.fileName ? `: ${content.documentMessage.fileName}` : ''}]`;
  if (content.audioMessage || content.ptvMessage) return '[Áudio recebido]';
  if (content.stickerMessage) return '[Figurinha recebida]';
  if (content.locationMessage || content.liveLocationMessage) return '[Localização recebida]';
  if (content.contactMessage || content.contactsArrayMessage) return '[Contato recebido]';
  if (content.protocolMessage || !record?.key?.id) return '';
  return record?.messageType ? `[${String(record.messageType).replace(/Message$/i, '')} recebido]` : '';
}

/** Converte registros persistidos pela Evolution API v2.3.7 em mensagens seguras para o CRM. */
export function normalizeEvolutionApiHistoryRecords(data, chatId = '') {
  const records = Array.isArray(data?.messages?.records) ? data.messages.records
    : Array.isArray(data?.data?.messages?.records) ? data.data.messages.records
      : Array.isArray(data?.records) ? data.records : [];
  return records.map((record) => {
    const key = record?.key || {};
    const content = unwrapHistoryContent(record?.message || {});
    const timestamp = historyTimestamp(record?.messageTimestamp || record?.timestamp);
    const waMsgId = String(key.id || record?.id || '').trim();
    const text = historyMessageText(content, record);
    if (!waMsgId || !timestamp || !text) return null;
    const messageType = String(record.messageType || Object.keys(content).find((k) => /Message$/.test(k)) || '');
    const historyMediaUnavailable = Boolean(content.imageMessage || content.videoMessage || content.documentMessage || content.audioMessage || content.ptvMessage || content.stickerMessage);
    return {
      role: key.fromMe === true || key.fromMe === 'true' ? 'owner' : 'user',
      text,
      waMsgId,
      waFromMe: key.fromMe === true || key.fromMe === 'true',
      waTimestampMs: Date.parse(timestamp),
      timestamp,
      historical: true,
      ...(record.pushName ? { contactName: String(record.pushName).slice(0, 120) } : {}),
      ...(messageType ? { waMessageType: messageType } : {}),
      ...(historyMediaUnavailable ? { historyMediaUnavailable: true } : {}),
      ...(content.documentMessage?.fileName ? { mediaName: String(content.documentMessage.fileName).slice(0, 180) } : {}),
      ...(content.imageMessage?.mimetype ? { mediaMime: String(content.imageMessage.mimetype).slice(0, 100) } : {}),
      ...(content.videoMessage?.mimetype ? { mediaMime: String(content.videoMessage.mimetype).slice(0, 100) } : {}),
      ...(content.documentMessage?.mimetype ? { mediaMime: String(content.documentMessage.mimetype).slice(0, 100) } : {}),
    };
  }).filter(Boolean);
}

const DIAGNOSTIC_READ_TIMEOUT_MS = 4000;

async function diagnosticReadRequest(path, body) {
  if (!API_KEY) return { ok: false, errorCategory: 'configuration', statusCode: null };
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(DIAGNOSTIC_READ_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, errorCategory: timedOut ? 'timeout' : 'connection', statusCode: null };
  }

  let data;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, errorCategory: 'invalid_json', statusCode: response.status };
  }
  if (!response.ok) {
    const statusCode = response.status;
    const errorCategory = statusCode === 401 || statusCode === 403 ? 'authentication'
      : statusCode === 404 ? 'endpoint_not_found'
        : 'http_error';
    return { ok: false, errorCategory, statusCode };
  }
  try {
    assertEvolutionApiAccepted(data);
  } catch {
    return { ok: false, errorCategory: 'application_rejected', statusCode: response.status };
  }
  return { ok: true, data };
}

export async function getEvolutionApiReadOnlyDiagnostics(userId) {
  if (!API_KEY) return { ok: false, readOnly: true, errorCategory: 'configuration', slots: [] };
  if (!userId) return { ok: false, readOnly: true, errorCategory: 'authentication', slots: [] };

  const instancesResponse = await diagnosticReadRequest('/instance/fetchInstances');
  if (!instancesResponse.ok) return { ok: false, readOnly: true, errorCategory: instancesResponse.errorCategory, statusCode: instancesResponse.statusCode, slots: [] };
  const body = instancesResponse.data;
  const rawRows = Array.isArray(body) ? body : body?.instances || body?.data || body?.response;
  if (!Array.isArray(rawRows)) return { ok: false, readOnly: true, errorCategory: 'invalid_response_shape', slots: [] };
  const ownedByName = new Map(rawRows.map(normalizeInstance).filter((row) => row.name && instanceOwnedBy(row, userId)).map((row) => [row.name, row]));
  const slots = ['slot_1', 'slot_2', 'slot_3'];
  const readInstance = (slotId) => ownedByName.get(instanceName(slotId)) || null;
  const pathFor = (endpoint, slotId) => `/chat/${endpoint}/${encodeURIComponent(instanceName(slotId))}`;

  const result = await runReadOnlyEvolutionDiagnostics({
    slots,
    readConnection: async (slotId) => {
      const instance = readInstance(slotId);
      if (!instance) return { ok: true, instanceFound: false };
      const stateResponse = await diagnosticReadRequest(`/instance/connectionState/${encodeURIComponent(instance.name)}`);
      if (!stateResponse.ok) return { ok: false, instanceFound: true, errorCategory: stateResponse.errorCategory, statusCode: stateResponse.statusCode };
      const stateBody = stateResponse.data;
      const stateObject = stateBody?.instance || stateBody?.data?.instance || stateBody?.data || stateBody || {};
      const state = String(stateObject.state || stateObject.connectionStatus || stateObject.status || '').toLowerCase();
      if (!state) return { ok: false, instanceFound: true, errorCategory: 'invalid_response_shape', statusCode: null };
      return { ok: true, instanceFound: true, state: state === 'connected' ? 'open' : state };
    },
    readContactsPage: (slotId, page) => diagnosticReadRequest(pathFor('findContacts', slotId), { where: {}, ...page }),
    readChatsPage: (slotId, page) => diagnosticReadRequest(pathFor('findChats', slotId), { where: {}, ...page }),
    readMessageSample: (slotId, remoteJid, page) => diagnosticReadRequest(pathFor('findMessages', slotId), { where: { key: { remoteJid } }, page: 1, offset: page.take }),
  });
  return result;
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

export async function getEvolutionApiChats(userId = null, { limit = 200, offset = 0 } = {}) {
  if (!userId) return [];
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const chats = new Map();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  let hasMore = false;
  for (const item of rows) {
    const state = await connectionState(item.name).catch(() => ({ state: item.state }));
    if (state.state !== 'open') continue;
    const slotId = item.name.match(/zap-ia-(slot_[1-3])/)?.[1] || 'slot_1';
    const data = await apiCall(`/chat/findChats/${encodeURIComponent(item.name)}`, {
      method: 'POST', body: { where: {}, take: safeLimit, skip: safeOffset }
    });
    const list = Array.isArray(data) ? data : data.chats || data.data || data.response || [];
    if (Array.isArray(list) && list.length >= safeLimit) hasMore = true;
    for (const row of Array.isArray(list) ? list : []) {
      const remoteJid = String(row.remoteJid || row.lastMessage?.key?.remoteJid || row.lastMessage?.remoteJid || '').trim();
      if (!remoteJid || /@(g\.us|broadcast|newsletter)$/i.test(remoteJid)) continue;
      const chatId = slotId === 'slot_1' ? remoteJid : `${slotId}::${remoteJid}`;
      if (chats.has(chatId)) continue;
      chats.set(chatId, {
        chatId, remoteJid, slotId,
        name: row.pushName || row.name || row.lastMessagePushName || row.lastMessage?.pushName || null,
        lastMessageAt: historyTimestamp(row.updatedAt || row.lastMessage?.messageTimestamp || row.lastMessageMessageTimestamp),
      });
    }
  }
  return { chats: [...chats.values()], hasMore };
}

function contactJidFromEvolution(raw = {}) {
  const rawId = String(raw.remoteJid || raw.id || raw.wuid || '').trim();
  if (rawId.includes('@')) return rawId;
  const phone = String(raw.number || raw.phoneNumber || rawId).replace(/\D/g, '');
  return phone ? `${phone}@s.whatsapp.net` : '';
}

export async function getEvolutionApiContacts(userId = null) {
  if (!userId) return [];
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const contacts = new Map();
  const pageSize = 1000;
  const maxPages = 10; // Fail-safe: never fetch an unbounded directory from one request.
  for (const item of rows) {
    const state = await connectionState(item.name).catch(() => ({ state: item.state }));
    if (state.state !== 'open') continue;
    const slotId = item.name.match(/zap-ia-(slot_[1-3])/)?.[1] || 'slot_1';
    for (let page = 0; page < maxPages; page += 1) {
      const skip = page * pageSize;
      const data = await apiCall(`/chat/findContacts/${encodeURIComponent(item.name)}`, {
        method: 'POST', body: { where: {}, take: pageSize, skip }
      });
      const list = Array.isArray(data) ? data : data.contacts || data.data || data.response || [];
      const pageRows = Array.isArray(list) ? list : [];
      for (const raw of pageRows) {
        const jid = contactJidFromEvolution(raw);
        if (!jid || /@(g\.us|broadcast|newsletter)$/i.test(jid)) continue;
        // JIDs are only unique inside one WhatsApp instance; retain the slot in the key.
        const chatId = slotId === 'slot_1' ? jid : `${slotId}::${jid}`;
        const name = raw.pushName || raw.name || raw.verifiedName || null;
        const phone = String(raw.number || raw.phoneNumber || raw.wuid || jid.split('@')[0]).replace(/\D/g, '');
        contacts.set(chatId, {
          chatId, slotId, phone, name,
          avatarUrl: raw.profilePictureUrl || raw.profilePicUrl || '',
          stage: 'novo', lastMessageAt: raw.updatedAt || null,
          // Evolution address-book membership is not the same as a CRM-saved contact.
          messages: [], savedContact: false, directoryImport: true
        });
      }
      if (pageRows.length < pageSize) break;
    }
  }
  return [...contacts.values()];
}

function resolveWebhookBaseUrl(req) {
  if (process.env.VERCEL) {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || req.get('host');
    return `https://${String(host || '').replace(/^https?:\/\//i, '')}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function connectionPayload(data = {}) {
  let payload = data;
  for (let i = 0; i < 3 && payload?.data && typeof payload.data === 'object'; i += 1) payload = payload.data;
  if (payload?.qrcode && typeof payload.qrcode === 'object') return { ...payload.qrcode, ...payload };
  return payload || {};
}

function normalizeQrDataUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (/^data:image\//i.test(raw)) return raw;
  const withoutOtherDataUri = raw.replace(/^data:[^,]*;base64,/i, '');
  return `data:image/png;base64,${withoutOtherDataUri}`;
}

async function connectSlot(slotId, userId, baseUrl, pairingPhone = null) {
  const instance = await ensureInstance(slotId, userId);
  const hookUrl = `${baseUrl}/api/evolution-webhook/webhook`;
  await setWebhook(instance.name, hookUrl);
  const digits = pairingPhone ? String(pairingPhone).replace(/\D/g, '') : '';
  const query = digits ? `?number=${encodeURIComponent(digits)}` : '';
  const data = await apiCall(`/instance/connect/${encodeURIComponent(instance.name)}${query}`);
  const payload = connectionPayload(data);
  const qrSource = typeof payload.base64 === 'string'
    ? payload.base64
    : typeof payload.qrcode?.base64 === 'string'
      ? payload.qrcode.base64
      : typeof payload.qrcode === 'string'
        ? payload.qrcode
        : '';
  let qrDataUrl = normalizeQrDataUrl(qrSource);
  // In Evolution API v2.3.7, `code` is the raw QR payload (for example `2@...`),
  // while `pairingCode` is the separate eight-digit linking code.
  const pairingCode = typeof payload.pairingCode === 'string' && payload.pairingCode.trim()
    ? payload.pairingCode.trim()
    : null;
  if (!qrDataUrl && typeof payload.code === 'string' && payload.code.trim()) {
    qrDataUrl = await QRCode.toDataURL(payload.code.trim());
  }
  const state = await connectionState(instance.name).catch(() => ({ state: 'connecting' }));
  const connected = state.state === 'open';
  const status = connected ? 'connected' : qrDataUrl || pairingCode ? 'qr_ready' : 'connecting';
  const slot = { instanceId: instance.id, name: instance.name, status, qrDataUrl: connected ? null : qrDataUrl, pairingCode: connected ? null : pairingCode };
  slotCache.set(slotId, slot);
  return { slotId, ...slot };
}

evolutionApiCloudRouter.get('/diagnostics/read-only', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  const userId = req.cloudAuth?.authUser?.id || null;
  if (!process.env.VERCEL || !userId || userId !== process.env.EVOLUTION_DEFAULT_USER_ID || req.cloudAuth?.isRemoteImpersonation) {
    return res.status(userId ? 403 : 401).json({ ok: false, errorCategory: 'authentication' });
  }
  const now = Date.now();
  const previous = readOnlyDiagnosticRuns.get(userId) || 0;
  if (now - previous < 30_000) {
    return res.status(429).json({ ok: false, errorCategory: 'rate_limited', retryAfterSeconds: Math.ceil((30_000 - (now - previous)) / 1000) });
  }
  readOnlyDiagnosticRuns.set(userId, now);
  try {
    const result = await getEvolutionApiReadOnlyDiagnostics(userId);
    return res.status(result.ok ? 200 : 502).json(result);
  } catch {
    return res.status(502).json({ ok: false, readOnly: true, errorCategory: 'diagnostic_failed' });
  }
});

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
    const baseUrl = resolveWebhookBaseUrl(req);
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl, req.body?.pairingPhone || null)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/refresh-qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const baseUrl = resolveWebhookBaseUrl(req);
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/reconnect', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const name = instanceName(slotId);
    await apiCall(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST', body: {} });
    const baseUrl = resolveWebhookBaseUrl(req);
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

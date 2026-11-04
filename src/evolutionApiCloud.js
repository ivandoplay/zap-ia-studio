/**
 * Ponte cloud para Evolution API v2 (Baileys).
 * Mantém os contratos internos do painel; URLs e credencial vêm do ambiente.
 */
import { Router } from 'express';
import {validateConnectionControl} from './connections/controls.js';
import express from 'express';
import { evolutionInstanceIdentity } from './evolutionIdentity.js';
import { assertEvolutionApiAccepted, requireEvolutionMessageId } from './evolutionApiResponse.js';
import QRCode from 'qrcode';
import { runReadOnlyEvolutionDiagnostics } from './crmV2/readOnlyEvolutionDiagnostics.js';

export const evolutionApiCloudRouter = Router();
evolutionApiCloudRouter.use(express.json({ limit: '10mb' }));

evolutionApiCloudRouter.use((req, res, next) => {
  if (process.env.VERCEL) {
    const userId = req.cloudAuth?.authUser?.id;
    if (!userId || req.cloudAuth?.isRemoteImpersonation) return res.status(userId ? 403 : 401).json({ ok: false, error: 'Entre na conta titular para usar a Evolution API.' });
  }
  next();
});

const API_URL = String(process.env.EVOLUTION_API_URL || 'https://pool-evolution-api-067.cloud2.pageup.dev.br').replace(/\/+$/, '');
const API_KEY = process.env.EVOLUTION_API_KEY || '';
const slotCache = new Map();
const cacheKey = (userId, slotId) => `${String(userId || '')}:${slotId}`;
const readOnlyDiagnosticRuns = new Map();
const EVENTS = ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONTACTS_UPDATE', 'CHATS_UPDATE'];

function instanceName(slotId, userId) {
  const safeSlot = /^slot_[1-3]$/.test(String(slotId)) ? String(slotId) : 'slot_1';
  const defaultUser = process.env.EVOLUTION_DEFAULT_USER_ID || '';
  // Preserva os nomes legados da conta principal; cada outra conta recebe instâncias isoladas.
  if (userId && userId === defaultUser) return `zap-ia-${safeSlot}`;
  return userId ? `zap-ia-${userId}-${safeSlot}` : `zap-ia-${safeSlot}`;
}
function instanceOwnedBy(instance, userId) {
  const name = instance?.name || instance?.instanceName || instance?.instance?.instanceName || '';
  return evolutionInstanceIdentity(name)?.userId === String(userId || '').toLowerCase();
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
async function apiCall(path, { method = 'GET', body, query = '', timeoutMs } = {}) {
  assertConfigured();
  let response;
  try {
    response = await fetch(`${API_URL}${path}${query}`, {
      method,
      signal: AbortSignal.timeout(method === 'GET' ? Math.max(250, Math.min(5000, timeoutMs || 5000)) : 12000),
      redirect: 'error',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw Object.assign(new Error(`Não foi possível acessar a Evolution API: ${err.message}`), { statusCode: 502 });
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Resposta inválida da Evolution API; confira a conversa antes de repetir um envio.'), { statusCode: 502, deliveryUncertain: method === 'POST' }); }
  if (!response.ok) {
    const errorValue = data?.error;
    const message = typeof errorValue === 'string' ? errorValue : errorValue?.message || data?.message;
    throw Object.assign(new Error(String(message || `Evolution API HTTP ${response.status}`)), { statusCode: response.status >= 400 ? response.status : 502 });
  }
  try { return assertEvolutionApiAccepted(data); }
  catch (err) { throw Object.assign(err, { statusCode: err.statusCode || 502 }); }
}
async function listInstances(options = {}) {
  const data = await apiCall('/instance/fetchInstances', options);
  const rows = Array.isArray(data) ? data : data.instances || data.data || data.response || null;
  if (!Array.isArray(rows)) throw Object.assign(new Error('Resposta de instâncias inválida.'), { statusCode: 502 });
  return rows.map(normalizeInstance);
}
async function connectionState(name, options = {}) {
  const data = await apiCall(`/instance/connectionState/${encodeURIComponent(name)}`, options);
  const raw = data.instance || data.data?.instance || data.data || data;
  const state = String(raw.state || raw.connectionStatus || raw.status || '').toLowerCase();
  return { state: state === 'connected' ? 'open' : state, phone: raw.ownerJid || raw.owner || raw.number || null };
}
async function setWebhook(name, webhookUrl) {
  if (!process.env.EVOLUTION_WEBHOOK_SECRET) throw Object.assign(new Error('Configure EVOLUTION_WEBHOOK_SECRET antes de conectar a instância.'), { statusCode: 503 });
  return apiCall(`/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: EVENTS, ...(process.env.EVOLUTION_WEBHOOK_SECRET ? { headers: { 'x-ienvia-webhook-secret': process.env.EVOLUTION_WEBHOOK_SECRET } } : {}) } },
  });
}
async function ensureInstance(slotId, userId) {
  const safeSlot = /^slot_[1-3]$/.test(String(slotId)) ? String(slotId) : 'slot_1';
  const name = instanceName(safeSlot, userId);
  const candidates = (await listInstances()).filter(item => instanceOwnedBy(item,userId) && evolutionInstanceIdentity(item.name)?.slotId===safeSlot);
  if (candidates.length>1) throw Object.assign(new Error('Mais de uma instância mapeada para o mesmo chip. Corrija o mapa antes de conectar.'),{statusCode:409});
  if (candidates[0]) return candidates[0];
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
async function lifecycleInstanceName(userId,slotId) {
  const candidates=(await listInstances()).filter(item=>instanceOwnedBy(item,userId)&&evolutionInstanceIdentity(item.name)?.slotId===slotId);
  if(candidates.length!==1)throw Object.assign(new Error('Selecione um chip com uma única instância Evolution configurada.'),{statusCode:409});
  return candidates[0].name;
}
async function connectedInstanceForTenant(userId, chatId = '') {
  if (!userId) throw Object.assign(new Error('Conta inválida para Evolution API.'), { statusCode: 403 });
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const requested = slotForChat(chatId);
  const candidates = rows.filter(candidate => evolutionInstanceIdentity(candidate.name)?.slotId === requested);
  if (candidates.length>1) throw Object.assign(new Error('Chip com múltiplas instâncias Evolution. Nenhum envio foi feito.'),{statusCode:409});
  const item = candidates[0];
  if (!item) {
    throw Object.assign(new Error(`Não há instância Evolution API configurada para o chip selecionado (${requested}).`), { statusCode: 503 });
  }
  const state = await connectionState(item.name);
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
  return requireEvolutionMessageId(await tenantCall(userId, chatId, '/message/sendText', 'POST', body));
}
export async function sendEvolutionApiMedia(userId, chatId, { url, type = 'document', caption = '', filename = '', mimeType = '' } = {}) {
  if (!url) throw Object.assign(new Error('URL de mídia ausente.'), { statusCode: 400 });
  return requireEvolutionMessageId(await tenantCall(userId, chatId, '/message/sendMedia', 'POST', { number: numberForChat(chatId), mediatype: type, media: url, caption, fileName: filename, ...(mimeType ? { mimetype: mimeType } : {}) }));
}
export async function sendEvolutionApiVoice(userId, chatId, url) {
  if (!url) throw Object.assign(new Error('URL de áudio ausente.'), { statusCode: 400 });
  return requireEvolutionMessageId(await tenantCall(userId, chatId, '/message/sendWhatsAppAudio', 'POST', { number: numberForChat(chatId), audio: url }));
}
export async function sendEvolutionApiContact(userId, chatId, contact = {}) {
  const phone = String(contact.phone || '').replace(/\D/g, '');
  return requireEvolutionMessageId(await tenantCall(userId, chatId, '/message/sendContact', 'POST', { number: numberForChat(chatId), contact: [{ fullName: String(contact.name || contact.fullName || ''), wuid: phone, phoneNumber: phone ? `+${phone}` : '', organization: String(contact.company || contact.organization || '') }] }));
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
      redirect: 'error',
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
  const readInstance = (slotId) => { const candidates=[...ownedByName.values()].filter(row=>evolutionInstanceIdentity(row.name)?.slotId===slotId); if(candidates.length>1) throw new Error('Chip com múltiplas instâncias Evolution.'); return candidates[0] || null; };
  const pathFor = (endpoint, slotId) => `/chat/${endpoint}/${encodeURIComponent(readInstance(slotId)?.name || instanceName(slotId, userId))}`;

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

export async function getEvolutionApiSlotStatus(userId = null, { timeoutMs = 5000 } = {}) {
  if (!userId || !API_KEY) return {};
  const rows = (await listInstances({ timeoutMs })).filter((item) => instanceOwnedBy(item, userId));
  const result = {};
  const seen = new Set();
  for (const item of rows) {
    const id = evolutionInstanceIdentity(item.name)?.slotId;
    if (id && seen.has(id)) throw Object.assign(new Error('Múltiplas instâncias no mesmo chip; revise EVOLUTION_INSTANCE_USERS.'), {statusCode:409});
    seen.add(id);
  }
  await Promise.all(rows.map(async (item) => {
    const slotId = evolutionInstanceIdentity(item.name)?.slotId;
    if (!slotId) return;
    const state = await connectionState(item.name, { timeoutMs }).catch(() => ({ state: 'unknown', readFailed: true }));
    const cached = slotCache.get(cacheKey(userId, slotId)) || {};
    result[slotId] = {
      slotId, instanceId: item.id, name: item.name,
      status: state.readFailed || !['open','close','closed','disconnected','connecting'].includes(state.state) ? 'unknown' : state.state === 'open' ? 'connected' : state.state === 'connecting' ? 'connecting' : 'disconnected',
      checkedAt: new Date().toISOString(), readStatus: state.readFailed ? 'unavailable' : 'updated',
      phone: state.phone || item.phone || null,
      qrDataUrl: cached.qrDataUrl || null,
      pairingCode: cached.pairingCode || null,
    };
  }));
  return result;
}

function evolutionPhoneCandidate(value) {
  const raw = String(value || '').trim();
  if (!raw || /@lid$/i.test(raw)) return '';
  if (raw.includes('@') && !/@s\.whatsapp\.net$/i.test(raw)) return '';
  const local = raw.includes('@') ? raw.split('@')[0].split(':')[0] : raw;
  const digits = local.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13 ? digits : '';
}

function evolutionContactPhone(raw = {}) {
  const messageKey = raw.lastMessage?.key || {};
  const candidates = [
    raw.phoneNumber, raw.phone, raw.number, raw.pn, raw.pnJid,
    raw.remoteJidAlt, raw.remoteJIDAlt, raw.wuid, raw.remoteJid, raw.id,
    messageKey.remoteJidAlt, messageKey.participantAlt,
    raw.lastMessage?.remoteJidAlt, raw.lastMessage?.phoneNumber, raw.lastMessage?.number,
  ];
  for (const candidate of candidates) {
    const phone = evolutionPhoneCandidate(candidate);
    if (phone) return phone;
  }
  return '';
}

function evolutionContactJid(raw = {}) {
  const candidates = [raw.remoteJid, raw.id, raw.wuid, raw.jid, raw.chatId];
  const rawId = candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
  if (rawId.includes('@')) return rawId;
  const rawDigits = rawId.replace(/\D/g, '');
  // WhatsApp LIDs are opaque identifiers, not telephone numbers. Keep the
  // identity in the correct namespace instead of fabricating a PN JID.
  if (rawDigits.length >= 14 && rawDigits.length <= 16) return `${rawDigits}@lid`;
  const phone = evolutionContactPhone(raw);
  if (phone) return `${phone}@s.whatsapp.net`;
  return '';
}

function isGenericEvolutionContactName(value) {
  const name = String(value || '').trim();
  return !name || /^(?:você|voce|you|me|yourself)$/i.test(name) ||
    /^(?:cliente|contato|contato whatsapp|whatsapp)(?:\s+\+?\d+)?$/i.test(name) ||
    /^\+?\d{8,}$/.test(name.replace(/[\s()-]/g, '')) ||
    /@(s\.whatsapp\.net|lid)$/i.test(name);
}

function evolutionContactName(raw = {}) {
  const candidates = [raw.name, raw.displayName, raw.verifiedName, raw.notify, raw.pushName];
  return candidates.map((value) => String(value || '').trim()).find((name) => !isGenericEvolutionContactName(name)) || null;
}

export async function getEvolutionApiChats(userId = null, { limit = 200, offset = 0 } = {}) {
  if (!userId) return [];
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const chats = new Map();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  let hasMore = false;
  for (const item of rows) {
    const state = await connectionState(item.name).catch(() => ({ state: 'unknown', readFailed: true }));
    if (state.state !== 'open') continue;
    const slotId = evolutionInstanceIdentity(item.name)?.slotId;
    if (!slotId) continue;
    const data = await apiCall(`/chat/findChats/${encodeURIComponent(item.name)}`, {
      method: 'POST', body: { where: {}, take: safeLimit, skip: safeOffset }
    });
    const list = Array.isArray(data) ? data : data.chats || data.data || data.response || [];
    if (Array.isArray(list) && list.length >= safeLimit) hasMore = true;
    for (const row of Array.isArray(list) ? list : []) {
      const remoteJid = evolutionContactJid({
        ...row,
        remoteJid: row.remoteJid || row.lastMessage?.key?.remoteJid || row.lastMessage?.remoteJid || '',
        remoteJidAlt: row.remoteJidAlt || row.lastMessage?.key?.remoteJidAlt || row.lastMessage?.remoteJidAlt || '',
      });
      if (!remoteJid || /@(g\.us|broadcast|newsletter)$/i.test(remoteJid)) continue;
      const chatId = slotId === 'slot_1' ? remoteJid : `${slotId}::${remoteJid}`;
      if (chats.has(chatId)) continue;
      const name = evolutionContactName({
        ...row,
        name: row.name || row.contact?.name,
        pushName: row.pushName || row.lastMessagePushName || row.lastMessage?.pushName,
      });
      const phone = evolutionContactPhone({
        ...row,
        remoteJidAlt: row.remoteJidAlt || row.lastMessage?.key?.remoteJidAlt || row.lastMessage?.remoteJidAlt,
      });
      chats.set(chatId, {
        chatId, remoteJid, slotId, ...(phone ? { phone } : {}),
        name,
        lastMessageAt: historyTimestamp(row.updatedAt || row.lastMessage?.messageTimestamp || row.lastMessageMessageTimestamp),
      });
    }
  }
  return { chats: [...chats.values()], hasMore };
}

function contactJidFromEvolution(raw = {}) {
  return evolutionContactJid(raw);
}

export async function getEvolutionApiContacts(userId = null) {
  if (!userId) return [];
  const rows = (await listInstances()).filter((item) => instanceOwnedBy(item, userId));
  const contacts = new Map();
  const pageSize = 1000;
  const maxPages = 10; // Fail-safe: never fetch an unbounded directory from one request.
  for (const item of rows) {
    const state = await connectionState(item.name).catch(() => ({ state: 'unknown', readFailed: true }));
    if (state.state !== 'open') continue;
    const slotId = evolutionInstanceIdentity(item.name)?.slotId;
    if (!slotId) continue;
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
        const name = evolutionContactName(raw);
        const phone = evolutionContactPhone(raw);
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
  if (process.env.EVOLUTION_WEBHOOK_BASE_URL) {
    const url = new URL(process.env.EVOLUTION_WEBHOOK_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('URL pública HTTPS de webhook inválida.'), { statusCode: 503 });
    return url.origin;
  }
  if (process.env.VERCEL) {
    // Nunca confiar no Host de uma requisição para registrar destino que receberá o segredo.
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'zap-ia-studio.vercel.app';
    return new URL(`https://${String(host).replace(/^https?:\/\//i, '')}`).origin;
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
  if (!process.env.EVOLUTION_WEBHOOK_SECRET) throw Object.assign(new Error('Configure EVOLUTION_WEBHOOK_SECRET antes de conectar a instância.'), { statusCode: 503 });
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
  slotCache.set(cacheKey(userId, slotId), slot);
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

// Envia somente a etapa já reservada para este titular; a rota nunca escolhe outro chip.
evolutionApiCloudRouter.post('/campaign-send', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const userId=req.cloudAuth?.authUser?.id, client=req.cloudAuth?.client, b=req.body||{};
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!userId||!client||req.cloudAuth?.isRemoteImpersonation)return res.status(401).json({ok:false,error:'Autenticação de titular obrigatória.'});
  if(!UUID.test(b.campaignId)||!UUID.test(b.recipientId)||!UUID.test(b.tentativaId)||!Number.isSafeInteger(b.etapa)||b.etapa<0||b.etapa>=100||!/^slot_[1-3]$/.test(b.slotId))return res.status(400).json({ok:false,error:'Reserva de campanha inválida.'});
  try {
    const q=await client.from('ienvia_campanha_checkpoints').select('owner_id,campanha_id,destinatario_id,etapa,status,tentativa_id,material').eq('owner_id',userId).eq('campanha_id',b.campaignId).eq('destinatario_id',b.recipientId).eq('etapa',b.etapa).maybeSingle();
    const cp=q.data;
    if(q.error||!cp||cp.owner_id!==userId||cp.campanha_id!==b.campaignId||cp.destinatario_id!==b.recipientId||cp.etapa!==b.etapa||cp.status!=='em_envio'||cp.tentativa_id!==b.tentativaId||cp.material?.slotId!==b.slotId||cp.material?.provedor!=='evolution_api'||!cp.material?.bloco)return res.status(409).json({ok:false,error:'A etapa não possui uma reserva Evolution válida.'});
    const d=await client.from('ienvia_campanha_destinatarios').select('owner_id,campanha_id,destinatario_id,telefone').eq('owner_id',userId).eq('campanha_id',b.campaignId).eq('destinatario_id',b.recipientId).maybeSingle();
    const destino=d.data;
    if(d.error||!destino||destino.owner_id!==userId||destino.campanha_id!==b.campaignId||destino.destinatario_id!==b.recipientId||!/^\d{8,15}$/.test(destino.telefone||''))return res.status(409).json({ok:false,error:'Destinatário da reserva inválido.'});
    const chatId=`${b.slotId}::${destino.telefone}@s.whatsapp.net`, m=cp.material.bloco; let sent, dispatch;
    if(m.tipo==='texto'&&typeof m.texto==='string'&&m.texto.trim()&&m.texto.length<=10000){dispatch=()=>sendEvolutionApiText(userId,chatId,m.texto);}
    else if((m.tipo==='imagem'||m.tipo==='audio')&&UUID.test(m.arquivoId||'')&&UUID.test(m.pastaId||'')&&typeof b.mediaUrl==='string'){
      const f=await client.from('ienvia_campanha_arquivos').select('owner_id,pasta_id,arquivo_id,tipo,mime,tamanho,sha256,excluindo').eq('owner_id',userId).eq('pasta_id',m.pastaId).eq('arquivo_id',m.arquivoId).maybeSingle();
      const file=f.data;
      if(f.error||!file||file.owner_id!==userId||file.pasta_id!==m.pastaId||file.arquivo_id!==m.arquivoId||file.tipo!==m.tipo||file.excluindo!==false||!Number.isSafeInteger(file.tamanho)||file.tamanho<1||file.tamanho>35*1024*1024||!/^([a-f0-9]{64})$/.test(file.sha256||'')||(m.tipo==='imagem'&&!['image/jpeg','image/png','image/webp'].includes(file.mime))||(m.tipo==='audio'&&!['audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm'].includes(file.mime)))return res.status(409).json({ok:false,error:'Mídia da reserva inválida.'});
      const storageUrl=new URL(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'https://iuysmojhaxplnhfrxqkv.supabase.co');
      let mediaUrl;try{mediaUrl=new URL(b.mediaUrl);}catch{return res.status(400).json({ok:false,error:'Ticket de mídia inválido.'});}
      const expected=`/storage/v1/object/sign/ienvia-campanhas-privadas/${userId}/${m.pastaId}/${m.arquivoId}`;
      if(mediaUrl.origin!==storageUrl.origin||mediaUrl.username||mediaUrl.password||mediaUrl.hash||mediaUrl.pathname!==expected||!mediaUrl.searchParams.get('token'))return res.status(400).json({ok:false,error:'Ticket de mídia não corresponde à conta.'});
      if(m.tipo==='imagem')dispatch=()=>sendEvolutionApiMedia(userId,chatId,{url:mediaUrl.href,type:'image',filename:`imagem-${m.arquivoId}.${({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.mime]}`,mimeType:file.mime});
      else if(m.notaVoz===true)dispatch=()=>sendEvolutionApiVoice(userId,chatId,mediaUrl.href);
      else if(m.notaVoz===false)dispatch=()=>sendEvolutionApiMedia(userId,chatId,{url:mediaUrl.href,type:'document',filename:`audio-${m.arquivoId}.${({'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/webm':'webm'})[file.mime]}`,mimeType:file.mime});
      else return res.status(409).json({ok:false,error:'Configuração de áudio inválida.'});
    } else return res.status(409).json({ok:false,error:'Material da reserva inválido.'});
    // Claim persistido no banco, não em memória: replays concorrentes nunca disparam duas vezes.
    const claim=await client.rpc('ienvia_claim_evolution_send',{p_campanha:b.campaignId,p_destinatario:b.recipientId,p_etapa:b.etapa,p_tentativa:b.tentativaId,p_slot:b.slotId});
    if(claim.error) return res.status(503).json({ok:false,error:'Não foi possível registrar a trava de envio. Verifique a migração Evolution.'});
    if(claim.data!==true) return res.status(409).json({ok:false,error:'Tentativa já utilizada ou reserva inativa. Confira a conversa; nenhum reenvio automático foi feito.'});
    sent=await dispatch();
    const messageId=sent?.key?.id||sent?.data?.key?.id||sent?.data?.id||sent?.id;
    if(typeof messageId!=='string'||!messageId)return res.status(502).json({ok:false,error:'A Evolution API não confirmou um identificador; a etapa ficará incerta e não será reenviada automaticamente.'});
    // Um erro de projeção posterior ao aceite NÃO pode transformar isso em um retry de envio.
    let historyPersisted=false;
    try { const recorded=await client.rpc('ienvia_record_evolution_campaign_send',{p_campanha:b.campaignId,p_destinatario:b.recipientId,p_etapa:b.etapa,p_tentativa:b.tentativaId,p_message_id:messageId}); historyPersisted=!recorded.error&&recorded.data===true; } catch { /* reconciliar pelo ID do provedor */ }
    return res.json({ok:true,accepted:true,messageId,historyPersisted,...(!historyPersisted?{warning:'Envio aceito; histórico pendente de reconciliação.'}:{})});
  } catch(err) { return res.status(err.statusCode||502).json({ok:false,error:err.message||'Falha segura no envio Evolution.'}); }
});
evolutionApiCloudRouter.use((req, res, next) => {
  if (req.method !== 'POST' || !['/connect','/refresh-qr','/reconnect','/disconnect','/delete'].includes(req.path)) return next();
  if(!req.cloudAuth?.authUser?.id)return res.status(403).json({ok:false,error:'Abra o painel da conta titular na nuvem para operar a Evolution.'});
  const profile=req.cloudAuth.profile;
  try{validateConnectionControl('/evolution-cloud'+req.path,req.body,{maxSlots:profile?.role==='master'?3:profile?Number(profile.max_wa_slots||1):3,support:req.cloudAuth.isRemoteImpersonation===true});}catch(error){return res.status(error.statusCode||400).json({ok:false,error:error.message});}
  if (['/connect','/refresh-qr','/reconnect'].includes(req.path) && !process.env.EVOLUTION_WEBHOOK_SECRET) return res.status(503).json({ok:false,error:'Configure EVOLUTION_WEBHOOK_SECRET antes de conectar a instância.'});
  next();
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
    const name = await lifecycleInstanceName(req.cloudAuth?.authUser?.id || null,slotId);
    await apiCall(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST', body: {} });
    const baseUrl = resolveWebhookBaseUrl(req);
    return res.json({ ok: true, ...(await connectSlot(slotId, req.cloudAuth?.authUser?.id || null, baseUrl)) });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/disconnect', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : 'slot_1';
    const userId = req.cloudAuth?.authUser?.id || null;
    const name = await lifecycleInstanceName(userId,slotId);
    await apiCall(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' });
    slotCache.delete(cacheKey(userId, slotId));
    return res.json({ ok: true, slotId });
  } catch (err) { return res.status(err.statusCode || 502).json({ ok: false, error: err.message }); }
});
evolutionApiCloudRouter.post('/delete', async (req, res) => {
  try {
    const slotId = /^slot_[1-3]$/.test(String(req.body?.slotId || '')) ? req.body.slotId : '';
    if (!slotId) return res.status(400).json({ ok: false, error: 'Informe um slot válido.' });
    await apiCall(`/instance/delete/${encodeURIComponent(await lifecycleInstanceName(req.cloudAuth?.authUser?.id || null,slotId))}`, { method: 'DELETE' });
    slotCache.delete(cacheKey(req.cloudAuth?.authUser?.id || null, slotId));
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

import fs from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers,
  MEDIA_PATH_MAP,
  proto
} from '@whiskeysockets/baileys';
import { useCompactWaAuthState } from './waCompactAuth.js';
import {
  AUTH_DIR,
  UPLOADS_DIR,
  WA_SLOT_IDS,
  normalizeSlotId,
  parseContactChannelKey,
  buildContactChannelKey,
  normalizeWaSlotsSettings,
  storage,
  normalizePhoneDigits,
  extractPhoneFromJidIfPn,
  isLikelyRealPhone,
  phonesMatch,
  uid,
  buildContactVCard
} from './storage.js';
import { generateSmartReply, buildExecutiveHandoffDossier } from './aiEngine.js';
import { formatPixMessageWithQr } from './pix.js';
import { convertToCanonicalWhatsAppVoice, WHATSAPP_VOICE_MIMETYPE, isNativeOggOpus } from './audioProcessor.js';
import { ensureLocalMediaCached } from './supabaseCloud.js';
import { observeServerTimestamp, trueNowIso, trueNowMs } from './trueClock.js';

// Garante que Notas de Voz subam no bucket nativo /mms/ptt do WhatsApp (idêntico à gravação no celular)
if (MEDIA_PATH_MAP && !MEDIA_PATH_MAP.ptt) {
  MEDIA_PATH_MAP.ptt = '/mms/ptt';
}

const logger = pino({ level: 'silent' });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomJitter(baseMs) {
  const delta = Math.round(baseMs * 0.22);
  return Math.max(400, baseMs + Math.floor(Math.random() * (delta * 2 + 1)) - delta);
}

function unwrapMessageContent(message) {
  if (!message) return null;
  if (message.deviceSentMessage?.message) return unwrapMessageContent(message.deviceSentMessage.message);
  if (message.ephemeralMessage?.message) return unwrapMessageContent(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessageContent(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessageContent(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) return unwrapMessageContent(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessageContent(message.documentWithCaptionMessage.message);
  if (message.associatedChildMessage?.message) return unwrapMessageContent(message.associatedChildMessage.message);
  if (message.groupMentionedMessage?.message) return unwrapMessageContent(message.groupMentionedMessage.message);
  if (message.botInvokeMessage?.message) return unwrapMessageContent(message.botInvokeMessage.message);
  if (message.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapMessageContent(message.editedMessage.message.protocolMessage.editedMessage);
  }
  return message;
}

function toEpochMs(rawTs) {
  if (!rawTs) return 0;
  let n = 0;
  if (typeof rawTs === 'number') {
    n = rawTs;
  } else if (typeof rawTs === 'bigint') {
    n = Number(rawTs);
  } else if (typeof rawTs === 'string') {
    const parsed = Number(rawTs);
    if (!Number.isNaN(parsed)) {
      n = parsed;
    } else {
      const dt = new Date(rawTs).getTime();
      return Number.isNaN(dt) ? 0 : dt;
    }
  } else if (typeof rawTs === 'object') {
    if (typeof rawTs.toNumber === 'function') {
      n = rawTs.toNumber();
    } else if (typeof rawTs.low === 'number') {
      n = rawTs.low >>> 0;
    }
  }
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}

function extractReadableTextFromUnwrapped(unwrapped) {
  if (!unwrapped) return '';
  const direct = (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.documentMessage?.caption ||
    unwrapped.buttonsResponseMessage?.selectedDisplayText ||
    unwrapped.listResponseMessage?.title ||
    unwrapped.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  ).trim();
  if (direct) return direct;

  if (unwrapped.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const p = JSON.parse(unwrapped.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      if (p?.id || p?.screen_0_TextInput_0) return String(p.id || p.screen_0_TextInput_0).trim();
    } catch {}
  }
  if (unwrapped.contactMessage?.displayName) {
    return `📇 [Contato compartilhado: ${unwrapped.contactMessage.displayName}]`;
  }
  if (unwrapped.contactsArrayMessage?.contacts?.length) {
    return `📇 [${unwrapped.contactsArrayMessage.contacts.length} contatos compartilhados]`;
  }
  if (unwrapped.locationMessage || unwrapped.liveLocationMessage) {
    const loc = unwrapped.locationMessage || unwrapped.liveLocationMessage;
    return `📍 [Localização${loc?.name ? `: ${loc.name}` : ' enviada'}]`;
  }
  if (unwrapped.pollCreationMessage?.name || unwrapped.pollCreationMessageV3?.name) {
    const pollName = unwrapped.pollCreationMessage?.name || unwrapped.pollCreationMessageV3?.name;
    return `📊 [Enquete: ${pollName}]`;
  }
  return '';
}

function isWithinBusinessSchedule(schedule = {}) {
  if (!schedule || schedule.mode === 'always') return { active: true };

  const tz = schedule.timezone || 'America/Fortaleza';
  let nowParts;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = dtf.formatToParts(new Date());
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    nowParts = {
      day: dayMap[map.weekday] ?? new Date().getDay(),
      minutes: Number(map.hour) * 60 + Number(map.minute)
    };
  } catch {
    const d = new Date();
    nowParts = { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }

  const [sh, sm] = (schedule.startHour || '08:00').split(':').map(Number);
  const [eh, em] = (schedule.endHour || '18:00').split(':').map(Number);
  const startMin = sh * 60 + (sm || 0);
  const endMin = eh * 60 + (em || 0);
  const workDays = Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5, 6];

  const insideHours = workDays.includes(nowParts.day) && nowParts.minutes >= startMin && nowParts.minutes <= endMin;

  if (schedule.mode === 'business_hours_only') {
    return { active: insideHours, sendOffHoursNotice: !insideHours };
  }
  if (schedule.mode === 'outside_hours_only') {
    return { active: !insideHours, sendOffHoursNotice: false };
  }
  return { active: true };
}

function wrapSocketForSlot(rawSock) {
  if (!rawSock) return rawSock;
  const toRaw = (jid) => (typeof jid === 'string' ? parseContactChannelKey(jid).rawJid : jid);
  return new Proxy(rawSock, {
    get(target, prop, receiver) {
      if (prop === 'sendMessage') {
        return (jid, content, opts) => target.sendMessage(toRaw(jid), content, opts);
      }
      if (prop === 'sendPresenceUpdate') {
        return (state, jid) => target.sendPresenceUpdate(state, jid ? toRaw(jid) : jid);
      }
      if (prop === 'profilePictureUrl') {
        return (jid, type, timeoutMs) => target.profilePictureUrl(toRaw(jid), type, timeoutMs);
      }
      if (prop === 'updateBlockStatus') {
        return (jid, action) => target.updateBlockStatus(toRaw(jid), action);
      }
      if (prop === 'readMessages') {
        return (keys = []) =>
          target.readMessages(
            (keys || []).map((k) => (k?.remoteJid ? { ...k, remoteJid: toRaw(k.remoteJid) } : k))
          );
      }
      if (prop === 'fetchMessageHistory') {
        return (count, oldestKey, ts) =>
          target.fetchMessageHistory(
            count,
            oldestKey?.remoteJid ? { ...oldestKey, remoteJid: toRaw(oldestKey.remoteJid) } : oldestKey,
            ts
          );
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

class WhatsAppSlotEngine {
  constructor(slotId = 'slot_1', orchestrator = null) {
    this.slotId = normalizeSlotId(slotId);
    this.orchestrator = orchestrator;
    this.sock = null;
    this.authDir = this.slotId === 'slot_1' ? AUTH_DIR : path.join(AUTH_DIR, this.slotId);
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedUser = null;
    this.lastError = null;
    this.broadcastFn = () => {};
    this.onStateChange = null;

    this.sentByBotIds = new Set();
    this.lidToPhoneMap = new Map(); // LID JID -> Phone digits (3-layer fallback pattern)
    this.contactDirectory = new Map(); // JID or Phone digits -> Nome real salvo na agenda / perfil do cliente
    this.debounceQueues = new Map(); // chatId -> { timer, texts, media, keys, pushName, phone }
    this.chatProcessingLocks = new Map(); // chatId -> Promise (evita respostas concorrentes na mesma conversa)
    this.rateTracker = new Map(); // chatId -> timestamps[]
    this.offHoursNotified = new Map(); // chatId -> timestamp
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.socketSeq = 0;
    this.conflictTimestamps = [];
    this.lastConnectedUser = null;
    this.lastConnectedLogAt = 0;
    this.lastConnectedLogPhone = '';
    this.connectionWaiters = new Set();
    this.historySyncWaiters = new Set();
    this.syncInProgress = false;
    this.avatarFetchCache = new Map(); // chatId -> ts
    this.scheduledSendingLock = false;

    this.loadLidMappingsFromDisk();

    // Poda preventiva de memória 24/7 por slot
    this.cachePruneTimer = setInterval(() => {
      this.pruneTransientCaches();
    }, 60_000);
    if (this.cachePruneTimer.unref) this.cachePruneTimer.unref();

    // Disparador automático de Mensagens Programadas das conversas deste Chip (a cada 15s)
    this.scheduledMsgTimer = setInterval(() => {
      this.processDueScheduledMessages().catch(() => {});
    }, 15_000);
    if (this.scheduledMsgTimer.unref) this.scheduledMsgTimer.unref();
  }

  toStorageKey(rawJid = '') {
    return buildContactChannelKey(this.slotId, rawJid);
  }

  toRawJid(chatIdOrKey = '') {
    return parseContactChannelKey(chatIdOrKey).rawJid;
  }

  getSlotConfig() {
    const all = normalizeWaSlotsSettings(storage.data.settings?.waSlots);
    return all[this.slotId] || { label: `Chip ${this.slotId.slice(-1)}`, aiEnabled: true };
  }

  isSlotAiEnabled() {
    return this.getSlotConfig().aiEnabled !== false;
  }

  getSlotDisplayBadge() {
    const cfg = this.getSlotConfig();
    const num = this.connectedUser?.phone ? ` (+${this.connectedUser.phone})` : '';
    return `${cfg.label}${num}`;
  }

  pruneTransientCaches() {
    const now = Date.now();
    // 1. Mantém sentByBotIds limitado às últimas 3.000 mensagens para estabilidade contínua de meses no Termux/Linux
    if (this.sentByBotIds.size > 3000) {
      const dropCount = this.sentByBotIds.size - 2000;
      let i = 0;
      for (const id of this.sentByBotIds) {
        this.sentByBotIds.delete(id);
        if (++i >= dropCount) break;
      }
    }
    // 2. Limpa entradas antigas de avatarFetchCache (> 6h ou > 2.500 chaves)
    if (this.avatarFetchCache.size > 500) {
      for (const [k, ts] of this.avatarFetchCache) {
        if (now - ts > 6 * 3600_000) this.avatarFetchCache.delete(k);
      }
      if (this.avatarFetchCache.size > 2500) {
        const firstKey = this.avatarFetchCache.keys().next().value;
        if (firstKey) this.avatarFetchCache.delete(firstKey);
      }
    }
    // 3. Limpa avisos fora de horário (> 24h) e janelas antigas de rateTracker (> 15 min)
    for (const [k, ts] of this.offHoursNotified) {
      if (now - ts > 24 * 3600_000) this.offHoursNotified.delete(k);
    }
    for (const [k, arr] of this.rateTracker) {
      const recent = Array.isArray(arr) ? arr.filter((t) => now - t < 15 * 60_000) : [];
      if (recent.length === 0) this.rateTracker.delete(k);
      else this.rateTracker.set(k, recent);
    }
    if (this.contactDirectory.size > 12000) {
      const drop = this.contactDirectory.size - 10000;
      let n = 0;
      for (const k of this.contactDirectory.keys()) {
        this.contactDirectory.delete(k);
        if (++n >= drop) break;
      }
    }
  }

  setAuthDir(dirPath) {
    if (!dirPath) return;
    this.authDir = dirPath;
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
    this.lidToPhoneMap.clear();
    this.loadLidMappingsFromDisk();
  }

  setStateChangeHook(fn) {
    this.onStateChange = typeof fn === 'function' ? fn : null;
  }

  async disconnectOnly() {
    return this.disconnect(false);
  }

  loadLidMappingsFromDisk() {
    try {
      const dir = this.authDir || AUTH_DIR;
      if (!fs.existsSync(dir)) return;

      const applyLidEntry = (fileKey, val) => {
        if (typeof val !== 'string' || !fileKey.startsWith('lid-mapping-')) return;
        const key = fileKey.replace('lid-mapping-', '').replace(/\.json$/i, '');
        if (key.includes('_reverse')) {
          const lidNum = key.replace('_reverse', '');
          this.lidToPhoneMap.set(`${lidNum}@lid`, normalizePhoneDigits(val));
        } else {
          this.lidToPhoneMap.set(`${normalizePhoneDigits(val)}@lid`, normalizePhoneDigits(key));
        }
      };

      // 1. Cofre Compacto Atômico (store_lid-mapping.json)
      const compactPath = path.join(dir, 'store_lid-mapping.json');
      if (fs.existsSync(compactPath)) {
        try {
          const bucket = JSON.parse(fs.readFileSync(compactPath, 'utf-8'));
          if (bucket && typeof bucket === 'object') {
            for (const [k, v] of Object.entries(bucket)) {
              applyLidEntry(k, v);
            }
          }
        } catch {}
      }

      // 2. Compatibilidade com arquivos legados individuais (lid-mapping-*.json)
      const files = fs.readdirSync(dir).filter(f => f.startsWith('lid-mapping-') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
          applyLidEntry(file, JSON.parse(raw));
        } catch {}
      }
    } catch {
      // Silencioso caso ainda não existam mapeamentos LID
    }
  }

  resolvePhoneFromMessage(msg) {
    const remoteJid = msg?.key?.remoteJid || '';
    const altJid = msg?.key?.remoteJidAlt || msg?.key?.participantAlt || '';

    // Camada 1: JID tradicional @s.whatsapp.net direto ou em remoteJidAlt
    if (remoteJid.endsWith('@s.whatsapp.net')) {
      const p = normalizePhoneDigits(remoteJid);
      if (altJid.endsWith('@lid')) this.lidToPhoneMap.set(altJid, p);
      return p;
    }
    if (altJid.endsWith('@s.whatsapp.net')) {
      const p = normalizePhoneDigits(altJid);
      if (remoteJid.endsWith('@lid')) this.lidToPhoneMap.set(remoteJid, p);
      return p;
    }

    // Camada 2: Cache em memória alimentado por contacts.upsert / lid-mapping
    if (this.lidToPhoneMap.has(remoteJid)) {
      return this.lidToPhoneMap.get(remoteJid);
    }

    // Camada 3: Recarregar arquivos lid-mapping-*.json do disco caso recém-criados
    this.loadLidMappingsFromDisk();
    if (this.lidToPhoneMap.has(remoteJid)) {
      return this.lidToPhoneMap.get(remoteJid);
    }

    return extractPhoneFromJidIfPn(remoteJid);
  }

  resolvePhoneFromJid(jid = '') {
    const clean = String(jid || '').trim();
    if (!clean) return '';
    if (clean.endsWith('@s.whatsapp.net')) return normalizePhoneDigits(clean);
    if (this.lidToPhoneMap.has(clean)) return this.lidToPhoneMap.get(clean);
    const bareLid = `${normalizePhoneDigits(clean)}@lid`;
    if (clean.endsWith('@lid') && this.lidToPhoneMap.has(bareLid)) {
      return this.lidToPhoneMap.get(bareLid);
    }
    return extractPhoneFromJidIfPn(clean);
  }

  getOwnerSelfName() {
    return String(this.connectedUser?.name || this.sock?.authState?.creds?.me?.name || '').trim();
  }

  isSelfJid(jid = '') {
    const s = String(jid || '').trim();
    if (!s) return true;
    const myPhone = normalizePhoneDigits(this.connectedUser?.phone || this.sock?.authState?.creds?.me?.id || '');
    const myLid = normalizePhoneDigits(this.sock?.authState?.creds?.me?.lid || '');
    const resolvedPhone = this.resolvePhoneFromJid(s);
    if (myPhone && resolvedPhone && resolvedPhone === myPhone) return true;
    if (myLid && s.endsWith('@lid') && normalizePhoneDigits(s) === myLid) return true;
    return false;
  }

  isValid1to1ChatJid(jid = '') {
    const s = String(jid || '').trim();
    if (!s) return false;
    if (
      s === 'status@broadcast' ||
      s === '0@s.whatsapp.net' ||
      s.endsWith('@g.us') ||
      s.endsWith('@broadcast') ||
      s.endsWith('@newsletter')
    ) {
      return false;
    }
    if (!s.endsWith('@s.whatsapp.net') && !s.endsWith('@lid')) return false;
    if (this.isSelfJid(s)) return false;
    return true;
  }

  lookupBestContactName(jid = '', phone = '') {
    const cleanJid = String(jid || '').trim();
    const cleanPhone = normalizePhoneDigits(phone || this.resolvePhoneFromJid(cleanJid));
    if (cleanJid && this.contactDirectory.has(cleanJid)) return this.contactDirectory.get(cleanJid);
    if (cleanPhone && this.contactDirectory.has(cleanPhone)) return this.contactDirectory.get(cleanPhone);
    return '';
  }

  getHistorySyncMetaFile() {
    return path.join(this.authDir || AUTH_DIR, 'zapia_history_sync.json');
  }

  hasCompletedHistoryBootstrap() {
    try {
      if (Object.keys(storage.data.contacts || {}).length >= 1) return true;
      const fp = this.getHistorySyncMetaFile();
      if (!fs.existsSync(fp)) return false;
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return Boolean(parsed?.completedAt);
    } catch {
      return false;
    }
  }

  markHistoryBootstrapCompleted(extra = {}) {
    try {
      const fp = this.getHistorySyncMetaFile();
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(
        fp,
        JSON.stringify({ completedAt: new Date().toISOString(), ...extra }, null, 2),
        'utf-8'
      );
    } catch {}
  }

  notifyHistoryWaiters(info = {}) {
    for (const resolve of [...this.historySyncWaiters]) {
      try { resolve(info); } catch {}
    }
  }

  ingestContactRecords(contacts = [], { deferSave = false } = {}) {
    const ownerSelfName = this.getOwnerSelfName();
    let mutatedExisting = false;

    for (const c of contacts || []) {
      if (!c) continue;
      const rawId = String(c.id || '').trim();
      const lid = String(c.lid || (rawId.endsWith('@lid') ? rawId : '')).trim();
      const pnRaw = String(c.phoneNumber || c.pnJid || (rawId.endsWith('@s.whatsapp.net') ? rawId : '')).trim();
      const phone = pnRaw ? normalizePhoneDigits(pnRaw) : (lid ? this.resolvePhoneFromJid(lid) : '');

      if (lid && isLikelyRealPhone(phone)) {
        const cleanLid = lid.endsWith('@lid') ? `${normalizePhoneDigits(lid)}@lid` : `${lid}@lid`;
        this.lidToPhoneMap.set(cleanLid, phone);
      }

      if (this.isSelfJid(rawId) || (lid && this.isSelfJid(lid))) continue;

      const candidateName = String(c.name || c.verifiedName || c.notify || c.displayName || '').trim();
      if (candidateName && !storage.isGenericContactName(candidateName, ownerSelfName)) {
        if (rawId) this.contactDirectory.set(rawId, candidateName);
        if (lid) this.contactDirectory.set(lid, candidateName);
        if (isLikelyRealPhone(phone)) this.contactDirectory.set(phone, candidateName);
      }

      // Enriquecer conversas que JÁ existem no CRM (nunca cria fantasmas vazios da agenda telefônica!)
      const existingKey =
        (lid && storage.data.contacts[lid] ? lid : null) ||
        (rawId && storage.data.contacts[rawId] ? rawId : null) ||
        (isLikelyRealPhone(phone) ? storage.findSiblingContactKey(lid || rawId, phone) : null);

      if (existingKey && storage.data.contacts[existingKey]) {
        const bestName = candidateName || this.lookupBestContactName(existingKey, phone);
        storage.upsertContact(
          lid || existingKey,
          {
            ...(isLikelyRealPhone(phone) ? { phone } : {}),
            ...(bestName ? { name: bestName } : {})
          },
          { deferSave: true, ownerSelfName, preferAddressBookName: Boolean(c.name) }
        );
        mutatedExisting = true;
      }
    }

    if (mutatedExisting && !deferSave) {
      storage.saveSoon();
      this.broadcastFn('crm_updated', {});
    }
    return mutatedExisting;
  }

  ingestChatRecords(chats = [], { deferSave = false, fromAppStateUpdate = false } = {}) {
    const ownerSelfName = this.getOwnerSelfName();
    let count = 0;

    for (const ch of chats || []) {
      const rawChatId = String(ch?.id || '').trim();
      if (!this.isValid1to1ChatJid(rawChatId)) continue;
      const chatId = this.toStorageKey(rawChatId);

      if (ch.lidJid && ch.pnJid) {
        this.lidToPhoneMap.set(`${normalizePhoneDigits(ch.lidJid)}@lid`, normalizePhoneDigits(ch.pnJid));
      } else if (rawChatId.endsWith('@lid') && ch.pnJid) {
        this.lidToPhoneMap.set(`${normalizePhoneDigits(rawChatId)}@lid`, normalizePhoneDigits(ch.pnJid));
      } else if (rawChatId.endsWith('@s.whatsapp.net') && ch.lidJid) {
        this.lidToPhoneMap.set(`${normalizePhoneDigits(ch.lidJid)}@lid`, normalizePhoneDigits(rawChatId));
      }

      const phone = this.resolvePhoneFromJid(rawChatId);
      const chatName =
        String(ch.name || ch.displayName || '').trim() ||
        this.lookupBestContactName(rawChatId, phone);

      const rawTsMs =
        toEpochMs(ch.conversationTimestamp) ||
        toEpochMs(ch.lastMessageRecvTimestamp) ||
        toEpochMs(ch.pinned);

      // Em updates parciais do App-State (ex: mute/archive antigo sem timestamp), ignora se não tiver telefone resolvido nem nome nem conversa prévia
      const alreadyExists = Boolean(storage.findSiblingContactKey(chatId, phone));
      if (fromAppStateUpdate && !alreadyExists && !isLikelyRealPhone(phone) && !chatName) {
        continue;
      }

      // Trava Anti-Ressurreição: se o usuário apagou explicitamente esta conversa no CRM, não recria a partir do histórico antigo
      const tombstoneMs = storage.getDeletedChatTombstoneMs(chatId, phone);
      if (tombstoneMs > 0 && !alreadyExists && (!rawTsMs || rawTsMs <= tombstoneMs + 2000)) {
        continue;
      }

      const defaultHistoricalIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const patch = {
        ...(isLikelyRealPhone(phone) ? { phone } : {}),
        ...(chatName ? { name: chatName } : {}),
        ...(rawTsMs > 0
          ? { lastMessageAt: new Date(rawTsMs).toISOString() }
          : (!alreadyExists ? { lastMessageAt: defaultHistoricalIso } : {}))
      };

      if (typeof ch.archived === 'boolean') {
        patch.archived = ch.archived;
      }
      if (ch.pinned !== undefined && ch.pinned !== null) {
        patch.pinned = Boolean(Number(ch.pinned) > 0 || ch.pinned === true);
      }
      if (typeof ch.unreadCount === 'number' && ch.unreadCount >= 0) {
        patch.unreadCount = ch.unreadCount;
      }

      const upserted = storage.upsertContact(chatId, patch, {
        deferSave: true,
        ownerSelfName
      });

      // Conversas pré-existentes vindas do WhatsApp entram em "em_atendimento" caso já tivessem atividade
      if (!alreadyExists && upserted.stage === 'novo' && rawTsMs > 0) {
        upserted.stage = 'em_atendimento';
      }
      count += 1;
    }

    if (count > 0 && !deferSave) {
      storage.saveSoon();
      this.broadcastFn('crm_updated', {});
    }
    return count;
  }

  ingestHistorySyncPayload(payload = {}) {
    const { chats = [], contacts = [], messages = [], lidPnMappings = [] } = payload;
    const ownerSelfName = this.getOwnerSelfName();

    // 1. Mapeamentos @lid <-> @s.whatsapp.net
    for (const m of lidPnMappings || []) {
      if (m?.lid && m?.pn) {
        const cleanLid = `${normalizePhoneDigits(m.lid)}@lid`;
        const cleanPn = normalizePhoneDigits(m.pn);
        if (isLikelyRealPhone(cleanPn)) {
          this.lidToPhoneMap.set(cleanLid, cleanPn);
        }
      }
    }

    // 2. Diretório de contatos (nomes reais salvos na agenda)
    if (contacts?.length) {
      this.ingestContactRecords(contacts, { deferSave: true });
    }

    // 3. Threads de conversas 1:1
    const chatsAdded = chats?.length ? this.ingestChatRecords(chats, { deferSave: true }) : 0;

    // 4. Mensagens históricas em ordem cronológica (NUNCA dispara resposta automática da IA!)
    const sortedMsgs = [...(messages || [])].sort(
      (a, b) => toEpochMs(a?.messageTimestamp) - toEpochMs(b?.messageTimestamp)
    );

    const touchedChatKeys = new Set();
    let msgsImported = 0;

    for (const msg of sortedMsgs) {
      const destJid = msg?.message?.deviceSentMessage?.destinationJid;
      const rawRemoteJid = (destJid && this.isSelfJid(msg?.key?.remoteJid)) ? destJid : msg?.key?.remoteJid;
      if (!this.isValid1to1ChatJid(rawRemoteJid)) continue;
      const remoteJid = this.toStorageKey(rawRemoteJid);

      const unwrapped = unwrapMessageContent(msg.message);
      if (!unwrapped || unwrapped.protocolMessage || unwrapped.reactionMessage) continue;

      const textContent = extractReadableTextFromUnwrapped(unwrapped);
      const hasAudio = Boolean(unwrapped.audioMessage);
      const hasImage = Boolean(unwrapped.imageMessage || unwrapped.stickerMessage);
      const hasVideo = Boolean(unwrapped.videoMessage);
      const hasAnyDoc = Boolean(unwrapped.documentMessage);
      if (!textContent && !hasAudio && !hasImage && !hasVideo && !hasAnyDoc) continue;

      const bestPhone = this.resolvePhoneFromMessage(msg);
      const fromMe = Boolean(msg.key?.fromMe);
      const rawDocName = hasAnyDoc
        ? String(unwrapped.documentMessage?.fileName || unwrapped.documentMessage?.title || 'arquivo').slice(0, 100)
        : '';

      const displayLabel = hasAudio
        ? (fromMe ? `🎤 [Áudio enviado] ${textContent}`.trim() : `[Áudio do cliente] ${textContent}`.trim())
        : hasImage
          ? (fromMe ? `[Imagem enviada] ${textContent}`.trim() : `[Imagem do cliente] ${textContent}`.trim())
          : hasVideo
            ? (fromMe ? `[Vídeo enviado] ${textContent}`.trim() : `[Vídeo do cliente] ${textContent}`.trim())
            : hasAnyDoc
              ? `[Arquivo: ${rawDocName}] ${textContent}`.trim()
              : textContent;

      const tsMs = toEpochMs(msg.messageTimestamp) || trueNowMs();
      const tombMs = storage.getDeletedChatTombstoneMs(remoteJid, bestPhone);
      if (tombMs > 0 && tsMs <= tombMs + 2000) continue;

      const existingChatKey = storage.findSiblingContactKey(remoteJid, bestPhone) || remoteJid;
      const clearedAtIso = storage.data.contacts?.[existingChatKey]?.historyClearedAt;
      if (clearedAtIso && tsMs <= (new Date(clearedAtIso).getTime() || 0)) continue;

      const contactName =
        this.lookupBestContactName(rawRemoteJid, bestPhone) ||
        (!fromMe && msg.pushName && !storage.isGenericContactName(msg.pushName, ownerSelfName) ? msg.pushName : '');

      const updatedContact = storage.appendContactMessage(
        remoteJid,
        {
          role: fromMe ? 'owner' : 'user',
          text: displayLabel,
          waMsgId: msg.key?.id || undefined,
          waFromMe: fromMe,
          waTimestampMs: tsMs,
          timestamp: new Date(tsMs).toISOString(),
          phone: bestPhone || undefined,
          contactName: contactName || undefined,
          historical: true,
          skipUnread: true
        },
        { deferSave: true, historical: true, ownerSelfName }
      );

      if (updatedContact?.chatId) {
        touchedChatKeys.add(updatedContact.chatId);
      }
      msgsImported += 1;
    }

    // 5. Proteção de Atendimento Humano Pré-Existente:
    // Se a conversa já estava em andamento manual antes de conectar (última mensagem enviada pelo dono nas últimas 24h),
    // preserva em "em_atendimento" e respeita a trava humana para a IA não atravessar uma negociação manual!
    const pauseOnOwner = Boolean(storage.data.settings.humanHandoff?.pauseOnOwnerReply);
    const activeBiz = storage.getBusiness();
    const pauseMinsCfg = Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60;

    for (const cKey of touchedChatKeys) {
      const c = storage.data.contacts[cKey];
      if (!c) continue;
      if (c.stage === 'novo' && (c.messages?.length || 0) > 0) {
        c.stage = 'em_atendimento';
      }
      const realMsgs = (c.messages || []).filter((m) => m.role !== 'internal_note');
      const lastMsg = realMsgs[realMsgs.length - 1];
      if (pauseOnOwner && lastMsg?.role === 'owner' && !c.pausedUntil) {
        const lastMs = new Date(lastMsg.timestamp || 0).getTime();
        const ageHours = (Date.now() - lastMs) / 3_600_000;
        if (ageHours >= 0 && ageHours <= 24) {
          if (activeBiz?.lockUntilManualResume) {
            c.pausedUntil = 'forever';
            c.pauseReason = 'Conversa já assumida por você antes de conectar';
          } else {
            const expMs = lastMs + pauseMinsCfg * 60_000;
            if (expMs > Date.now()) {
              c.pausedUntil = new Date(expMs).toISOString();
              c.pauseReason = 'Você respondeu manualmente nesta conversa';
            }
          }
        }
      }
    }

    if (chatsAdded > 0 || msgsImported > 0 || contacts?.length > 0) {
      storage.saveSoon();
      if (chatsAdded > 0 || msgsImported > 0) {
        this.markHistoryBootstrapCompleted({ chatsAdded, msgsImported });
      }
      this.broadcastFn('crm_updated', {});
      this.notifyHistoryWaiters({ chatsAdded, msgsImported });
    }
  }

  setBroadcaster(fn) {
    this.broadcastFn = fn;
  }

  emitState(event = 'wa_state') {
    if (this.orchestrator) {
      this.orchestrator.emitState(event);
      return;
    }
    const pub = this.getPublicState();
    this.broadcastFn(event, pub);
    if (this.onStateChange) {
      try { this.onStateChange(pub); } catch {}
    }
  }

  getPublicState() {
    const cfg = this.getSlotConfig();
    return {
      slotId: this.slotId,
      label: cfg.label,
      aiEnabled: cfg.aiEnabled !== false,
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      pairingCode: this.pairingCode,
      connectedUser: this.connectedUser,
      lastError: this.lastError,
      botEnabled: storage.data.settings.botEnabled,
      proactive: this.orchestrator ? this.orchestrator.getProactiveQueueState() : { running: false, paused: false, remaining: 0 }
    };
  }

  hasSavedSession() {
    return fs.existsSync(path.join(this.authDir || AUTH_DIR, 'creds.json'));
  }

  rememberBotMessage(sentResult) {
    const id = sentResult?.key?.id;
    if (id) {
      this.sentByBotIds.add(id);
      if (this.sentByBotIds.size > 600) {
        const first = this.sentByBotIds.values().next().value;
        this.sentByBotIds.delete(first);
      }
    }
  }

  async autoRestoreIfSessionExists() {
    if (this.hasSavedSession()) {
      storage.addLog('whatsapp', 'Sessão anterior encontrada. Reconectando automaticamente ao WhatsApp...');
      await this.connect();
    }
  }

  destroySocketSilently(sock) {
    if (!sock) return;
    try {
      sock.ev?.removeAllListeners?.('connection.update');
      sock.ev?.removeAllListeners?.('creds.update');
      sock.ev?.removeAllListeners?.('contacts.upsert');
      sock.ev?.removeAllListeners?.('contacts.update');
      sock.ev?.removeAllListeners?.('messages.upsert');
    } catch {}
    try {
      sock.end(undefined);
    } catch {}
    try {
      sock.ws?.close?.();
    } catch {}
  }

  resolveConnectionWaiters(ok) {
    if (!this.connectionWaiters.size) return;
    for (const waiter of Array.from(this.connectionWaiters)) {
      this.connectionWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(Boolean(ok));
    }
  }

  async waitUntilConnected(timeoutMs = 6500) {
    if (this.sock && this.status === 'connected') return true;
    // Se não há sessão salva nem reconexão em andamento, retorna falso imediatamente
    if (this.status === 'disconnected' && !this.reconnectTimer) return false;
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          this.connectionWaiters.delete(waiter);
          resolve(Boolean(this.sock && this.status === 'connected'));
        }, timeoutMs)
      };
      this.connectionWaiters.add(waiter);
    });
  }

  async connect(pairingPhone = null) {
    if (this.sock && this.status === 'connected' && !pairingPhone) {
      return this.getPublicState();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Se já havia um socket conectado ou conectando sem novo pedido de código, reutiliza sem derrubar!
    if (this.sock && (this.status === 'connecting' || this.status === 'connected') && !pairingPhone) {
      return this.getPublicState();
    }

    // Encerra qualquer socket anterior removendo TODOS os listeners antes de criar outro (zero socket zumbi!)
    if (this.sock) {
      const prev = this.sock;
      this.sock = null;
      this.destroySocketSilently(prev);
    }

    const mySeq = ++this.socketSeq;
    if (pairingPhone) {
      this.conflictTimestamps = [];
    }

    // Se for novo pareamento por código de 8 dígitos e a sessão atual ainda não estiver registrada, limpa rascunho antigo
    if (pairingPhone) {
      try {
        const credsPath = path.join(this.authDir || AUTH_DIR, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const parsedCreds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
          if (!parsedCreds?.registered) {
            this.clearAuthFolder();
          }
        }
      } catch {
        this.clearAuthFolder();
      }
    }

    this.status = 'connecting';
    this.lastError = null;
    if (pairingPhone) {
      this.pairingCode = null;
      this.qrDataUrl = null;
    }
    this.emitState();

    let rawDigits = pairingPhone ? normalizePhoneDigits(pairingPhone) : '';
    if (rawDigits.length === 10 || rawDigits.length === 11) {
      rawDigits = `55${rawDigits}`; // Auto-prefixa DDI 55 do Brasil se o usuário informar apenas DDD + Número!
    }
    const cleanPairingDigits = rawDigits;

    let resolvePairingWait = null;
    const pairingWaitPromise = cleanPairingDigits.length >= 12
      ? new Promise(resolve => {
          resolvePairingWait = resolve;
          setTimeout(resolve, 9000);
        })
      : null;

    try {
      const { state, saveCreds } = await useCompactWaAuthState(this.authDir || AUTH_DIR);
      if (mySeq !== this.socketSeq) {
        if (resolvePairingWait) resolvePairingWait();
        return this.getPublicState();
      }

      let version = [2, 3000, 1023223821];
      try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
      } catch {
        // Mantém versão fallback caso offline
      }

      if (mySeq !== this.socketSeq) {
        if (resolvePairingWait) resolvePairingWait();
        return this.getPublicState();
      }

      const rawSock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true,
        emitOwnEvents: false,
        markOnlineOnConnect: false,
        getMessage: async (key) => {
          const cid = this.toStorageKey(key?.remoteJid || '');
          const c = storage.data.contacts[cid] || storage.data.contacts[storage.findSiblingContactKey(cid) || ''];
          const found = c?.messages?.find((m) => m.waMsgId && m.waMsgId === key?.id);
          return found?.text ? { conversation: found.text } : undefined;
        }
      });

      const sock = wrapSocketForSlot(rawSock);
      this.sock = sock;
      let pairingRequested = false;

      sock.ev.on('creds.update', () => {
        if (mySeq !== this.socketSeq) return;
        saveCreds().catch(() => {});
      });

      sock.ev.on('lid-mapping.update', (mapping) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        const items = Array.isArray(mapping) ? mapping : [mapping];
        let changed = false;
        for (const item of items) {
          if (item?.lid && item?.pn) {
            const cleanLid = `${normalizePhoneDigits(item.lid)}@lid`;
            const cleanPn = normalizePhoneDigits(item.pn);
            if (isLikelyRealPhone(cleanPn)) {
              this.lidToPhoneMap.set(cleanLid, cleanPn);
              const slotLidKey = this.toStorageKey(cleanLid);
              if (storage.data.contacts[slotLidKey] || storage.findSiblingContactKey(slotLidKey, cleanPn)) {
                storage.upsertContact(slotLidKey, { phone: cleanPn }, { ownerSelfName: this.getOwnerSelfName() });
                changed = true;
              }
            }
          }
        }
        if (changed) this.broadcastFn('crm_updated', {});
      });

      sock.ev.on('contacts.upsert', (contacts = []) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        this.ingestContactRecords(contacts);
      });

      sock.ev.on('contacts.update', (contacts = []) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        this.ingestContactRecords(contacts);
      });

      sock.ev.on('chats.upsert', (chats = []) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        this.ingestChatRecords(chats, { fromAppStateUpdate: false });
      });

      sock.ev.on('chats.update', (chats = []) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        this.ingestChatRecords(chats, { fromAppStateUpdate: true });
      });

      sock.ev.on('messaging-history.set', (payload = {}) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        try {
          this.ingestHistorySyncPayload(payload);
        } catch (err) {
          console.error('[WA] Erro ao importar histórico de conversas:', err.message);
        }
      });

      sock.ev.on('connection.update', async update => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Se o usuário pediu Código de 8 Dígitos, solicita na chegada do evento QR (padrão oficial baileys.wiki)
          if (cleanPairingDigits.length >= 10 && !sock.authState.creds.registered && !pairingRequested) {
            pairingRequested = true;
            try {
              const rawCode = await sock.requestPairingCode(cleanPairingDigits);
              if (mySeq !== this.socketSeq) return;
              const formatted = rawCode?.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
              this.pairingCode = formatted;
              this.qrDataUrl = null;
              this.status = 'qr_ready';
              this.connectedUser = null;
              this.emitState();
              storage.addLog('whatsapp', `Código de pareamento gerado para +${cleanPairingDigits}: ${formatted}`);
              if (resolvePairingWait) resolvePairingWait();
            } catch (err) {
              if (mySeq !== this.socketSeq) return;
              this.lastError = `Erro ao gerar código de 8 dígitos: ${err.message}`;
              this.emitState();
              if (resolvePairingWait) resolvePairingWait();
            }
          } else if (!this.pairingCode) {
            const qrImg = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
            if (mySeq !== this.socketSeq) return;
            this.qrDataUrl = qrImg;
            this.status = 'qr_ready';
            this.connectedUser = null;
            this.emitState();
          }
        }

        if (connection === 'open') {
          const connectedPhone = normalizePhoneDigits(sock.user?.id || '');
          // Proteção Anti-Conflito 440: impede que o mesmo número seja pareado em 2 slots da mesma conta!
          const dupOtherSlot = this.orchestrator?.findOtherConnectedSlotByPhone(this.slotId, connectedPhone);
          if (dupOtherSlot) {
            const dupMsg = `Este número (+${connectedPhone}) já está ativo no ${dupOtherSlot.getSlotConfig().label}. Conecte um número diferente neste slot.`;
            await this.disconnect(true);
            this.lastError = dupMsg;
            storage.addLog('alert', dupMsg);
            this.emitState();
            return;
          }

          this.status = 'connected';
          this.reconnectAttempts = 0;
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.lastError = null;
          this.loadLidMappingsFromDisk();
          this.connectedUser = {
            id: sock.user?.id || '',
            phone: connectedPhone,
            name: sock.user?.name || 'WhatsApp Conectado'
          };
          this.lastConnectedUser = this.connectedUser;
          const nowMs = Date.now();
          if (
            this.lastConnectedLogPhone !== this.connectedUser.phone ||
            nowMs - this.lastConnectedLogAt > 90_000
          ) {
            this.lastConnectedLogPhone = this.connectedUser.phone;
            this.lastConnectedLogAt = nowMs;
            storage.addLog('whatsapp', `[${this.getSlotConfig().label}] WhatsApp conectado com sucesso! (+${this.connectedUser.phone})`);
            console.log(`✅ [WhatsApp 24h Ativo · ${this.getSlotConfig().label}] Conectado em +${this.connectedUser.phone} (${this.connectedUser.name}) — Atendendo normalmente!`);
          }
          this.resolveConnectionWaiters(true);
          this.emitState();

          // Limpa eventual auto-contato do próprio número apenas dentro deste mesmo slot
          for (const k of Object.keys(storage.data.contacts || {})) {
            const parsedK = parseContactChannelKey(k);
            if (parsedK.slotId === this.slotId && this.isSelfJid(parsedK.rawJid)) {
              storage.deleteContact(k, { recordTombstone: false });
            }
          }

          // Se esta conta ainda não recuperou as conversas pré-existentes do celular, sincroniza automaticamente em background!
          if (!this.hasCompletedHistoryBootstrap()) {
            setTimeout(() => {
              if (mySeq === this.socketSeq && this.status === 'connected') {
                this.syncAllConversationsFromPhone({ force: false }).catch(() => {});
              }
            }, 2600);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errMsg = String(lastDisconnect?.error?.message || '');
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const isConflict =
            statusCode === DisconnectReason.connectionReplaced ||
            statusCode === 440 ||
            /conflict|replaced/i.test(errMsg);
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          this.destroySocketSilently(sock);
          this.sock = null;
          this.qrDataUrl = null;

          if (loggedOut) {
            this.status = 'disconnected';
            this.pairingCode = null;
            this.connectedUser = null;
            this.lastConnectedUser = null;
            this.lastError = 'Sessão desconectada pelo celular. Clique em Conectar WhatsApp para gerar um novo QR Code.';
            this.clearAuthFolder();
            this.resolveConnectionWaiters(false);
            storage.addLog('alert', 'Sessão encerrada pelo aparelho celular.');
            this.emitState();
          } else if (isConflict) {
            const nowMs = Date.now();
            this.conflictTimestamps = (this.conflictTimestamps || []).filter(ts => nowMs - ts < 45_000);
            this.conflictTimestamps.push(nowMs);

            if (this.conflictTimestamps.length >= 2) {
              // Duas instâncias abertas ao mesmo tempo: para de disputar a sessão para não derrubar em loop!
              this.status = 'disconnected';
              this.connectedUser = null;
              this.lastError =
                'Outra janela do motor assumiu esta sessão do WhatsApp. Feche a janela duplicada no Termux/PC ou clique em Conectar.';
              this.resolveConnectionWaiters(false);
              storage.addLog('alert', 'Conflito de sessão detectado (2 motores abertos na mesma conta). Reconexão pausada para evitar quedas.');
              this.emitState();
            } else {
              this.status = 'connecting';
              this.connectedUser = this.lastConnectedUser;
              this.lastError = 'Sincronizando sessão ativa do WhatsApp...';
              this.emitState();
              this.reconnectTimer = setTimeout(() => {
                if (mySeq === this.socketSeq) this.connect().catch(() => {});
              }, 6000);
            }
          } else {
            this.status = 'connecting';
            // Preserva connectedUser durante micro-oscilações de rede 4G/Wi-Fi para o painel não piscar "Desconectado"
            this.connectedUser = this.lastConnectedUser;
            this.lastError = isRestartRequired
              ? 'Finalizando pareamento seguro com o aparelho...'
              : 'Reconectando ao WhatsApp...';
            this.emitState();
            // Reconexão imediata (450ms) após código 515 de pareamento; caso contrário, backoff exponencial seguro (2.5s -> máx 35s)
            this.reconnectAttempts = isRestartRequired ? 0 : Math.min(8, (this.reconnectAttempts || 0) + 1);
            const delayMs = isRestartRequired
              ? 450
              : Math.min(35000, Math.round(2500 * Math.pow(1.6, this.reconnectAttempts - 1)));
            this.reconnectTimer = setTimeout(() => {
              if (mySeq === this.socketSeq) this.connect().catch(() => {});
            }, delayMs);
          }
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        if (type !== 'notify' && type !== 'append') return;
        const isHistoryAppend = type === 'append';
        for (const msg of messages || []) {
          this.handleIncomingRawMessage(msg, { isHistoryAppend }).catch(err => {
            console.error('[WA] Erro ao processar mensagem:', err);
            storage.addLog('error', `Erro ao processar mensagem: ${err.message}`);
          });
        }
      });

      sock.ev.on('messages.update', (updates) => {
        if (mySeq !== this.socketSeq || this.sock !== sock) return;
        let changed = false;
        for (const u of updates || []) {
          const rJid = u?.key?.remoteJid;
          const mId = u?.key?.id;
          if (!rJid || !mId || !this.isValid1to1ChatJid(rJid)) continue;
          const storageJid = this.toStorageKey(rJid);
          const st = u?.update?.status;
          if (typeof st === 'number' && st >= 2) {
            const ackLevel = st >= 4 ? 3 : st === 3 ? 2 : 1;
            storage.applyMessageAck(storageJid, mId, ackLevel);
            changed = true;
          }
          const edited = u?.update?.message?.editedMessage || u?.update?.message?.protocolMessage?.editedMessage;
          if (edited) {
            const newTxt = extractReadableTextFromUnwrapped(unwrapMessageContent(edited));
            if (newTxt) {
              storage.applyMessageEdit(storageJid, mId, newTxt);
              changed = true;
            }
          }
        }
        if (changed) this.broadcastFn('crm_updated', {});
      });
    } catch (err) {
      if (mySeq !== this.socketSeq) return this.getPublicState();
      this.status = 'disconnected';
      this.lastError = err.message;
      this.resolveConnectionWaiters(false);
      storage.addLog('error', `Falha ao iniciar WhatsApp: ${err.message}`);
      this.emitState();
      if (resolvePairingWait) resolvePairingWait();
    }

    if (pairingWaitPromise) {
      await pairingWaitPromise;
    }

    return this.getPublicState();
  }

  clearAuthFolder() {
    try {
      const dir = this.authDir || AUTH_DIR;
      if (fs.existsSync(dir)) {
        // Remove apenas arquivos deste slot (NUNCA apaga subpastas slot_2/slot_3 quando limpando slot_1!)
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile()) {
            try { fs.unlinkSync(path.join(dir, entry.name)); } catch {}
          }
        }
      } else {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error('[WA] Erro ao limpar auth:', err.message);
    }
  }

  async disconnect(clearSession = true) {
    this.socketSeq++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const prev = this.sock;
    this.sock = null;
    try {
      if (prev) {
        if (clearSession) {
          try {
            prev.ev?.removeAllListeners?.('connection.update');
          } catch {}
          await prev.logout().catch(() => {});
        }
        this.destroySocketSilently(prev);
      }
    } catch {}
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedUser = null;
    this.lastConnectedUser = null;
    this.conflictTimestamps = [];
    this.resolveConnectionWaiters(false);
    if (clearSession) {
      this.clearAuthFolder();
    }
    storage.addLog('whatsapp', 'WhatsApp desconectado pelo painel.');
    this.emitState();
    return this.getPublicState();
  }

  /**
   * Recupera todas as conversas 1:1 e histórico recente diretamente do celular conectado
   * MESMO QUANDO A SESSÃO JÁ ESTAVA PAREADA ANTES (sem precisar desconectar nem ler QR Code de novo!).
   */
  async syncAllConversationsFromPhone({ force = false, waitMs = 6500 } = {}) {
    const ready = await this.waitUntilConnected(7000);
    if (!ready || !this.sock) {
      throw new Error('O WhatsApp precisa estar conectado para sincronizar as conversas do aparelho.');
    }
    if (this.syncInProgress && !force) {
      return {
        ok: true,
        alreadyRunning: true,
        totalConversations: Object.keys(storage.data.contacts || {}).length
      };
    }

    this.syncInProgress = true;
    const beforeCount = Object.keys(storage.data.contacts || {}).length;

    const chunkArrivalPromise = new Promise((resolve) => {
      let timer = null;
      const done = (info) => {
        if (timer) clearTimeout(timer);
        this.historySyncWaiters.delete(done);
        resolve(info || {});
      };
      this.historySyncWaiters.add(done);
      timer = setTimeout(() => done({ timedOut: true }), waitMs);
    });

    try {
      // Passo 1: Resync de Snapshots do App-State apenas quando solicitado manualmente (force=true),
      // evitando downloads pesados em mmg.whatsapp.net a cada reconexão de rede móvel!
      if (force && this.sock.authState?.keys?.set && typeof this.sock.resyncAppState === 'function') {
        try {
          await this.sock.resyncAppState(
            ['regular_high', 'regular_low', 'critical_unblock_low', 'regular'],
            false
          );
        } catch (err) {
          console.warn('[WA Sync] Aviso leve no resyncAppState (seguindo via PeerData):', err?.message || err);
        }
      }

      // Passo 2: Solicita ao aparelho principal (via PeerDataOperation) o pacote completo de conversas e mensagens recentes!
      if (typeof this.sock.sendPeerDataOperationMessage === 'function') {
        try {
          await this.sock.sendPeerDataOperationMessage({
            peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
            fullHistorySyncOnDemandRequest: {
              requestMetadata: { requestId: `zapia_${Date.now()}` },
              historySyncConfig: {
                storageQuotaMb: 10240,
                inlineInitialPayloadInE2EeMsg: true,
                recentSyncDaysLimit: 90,
                supportBotUserAgentChatHistory: true,
                supportBizHostedMsg: true,
                supportRecentSyncChunkMessageCountTuning: true,
                supportMessageAssociation: true
              }
            }
          });
        } catch (err) {
          console.warn('[WA Sync] Aviso em FULL_HISTORY_SYNC_ON_DEMAND:', err?.message || err);
        }

        // Passo 3: Se o celular já havia enviado pacotes INITIAL_BOOTSTRAP / RECENT antes desta versão, pede regeneração imediata dos chunks!
        const prevChunks = this.sock.authState?.creds?.processedHistoryMessages || [];
        if (prevChunks.length > 0) {
          const retryTargets = [
            { syncType: proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP, chunkOrder: 0, id: prevChunks[0]?.key?.id },
            { syncType: proto.HistorySync.HistorySyncType.RECENT, chunkOrder: 0, id: prevChunks[1]?.key?.id || prevChunks[0]?.key?.id },
            { syncType: proto.HistorySync.HistorySyncType.RECENT, chunkOrder: 1, id: prevChunks[2]?.key?.id }
          ].filter((t) => Boolean(t.id));

          for (const t of retryTargets) {
            try {
              await this.sock.sendPeerDataOperationMessage({
                peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_CHUNK_RETRY,
                historySyncChunkRetryRequest: {
                  syncType: t.syncType,
                  chunkOrder: t.chunkOrder,
                  chunkNotificationId: t.id,
                  regenerateChunk: true
                }
              });
            } catch {}
          }
        }
      }

      await chunkArrivalPromise;
      this.loadLidMappingsFromDisk();

      // Reconcilia telefones e nomes recém-descobertos em todos os contatos existentes
      const ownerSelfName = this.getOwnerSelfName();
      for (const [jid, card] of Object.entries({ ...(storage.data.contacts || {}) })) {
        if (this.isSelfJid(jid)) {
          storage.deleteContact(jid);
          continue;
        }
        const resolvedPhone = this.resolvePhoneFromJid(jid) || card.phone;
        const bestName = this.lookupBestContactName(jid, resolvedPhone);
        if (
          (isLikelyRealPhone(resolvedPhone) && resolvedPhone !== card.phone) ||
          (bestName && storage.isGenericContactName(card.name, ownerSelfName))
        ) {
          storage.upsertContact(
            jid,
            {
              ...(isLikelyRealPhone(resolvedPhone) ? { phone: resolvedPhone } : {}),
              ...(bestName ? { name: bestName } : {})
            },
            { deferSave: true, ownerSelfName, preferAddressBookName: true }
          );
        }
      }

      storage.saveSoon();
      this.broadcastFn('crm_updated', {});

      const afterCount = Object.keys(storage.data.contacts || {}).length;
      const syncedNew = Math.max(0, afterCount - beforeCount);
      if (afterCount > 0) {
        this.markHistoryBootstrapCompleted({ totalConversations: afterCount });
      }
      storage.addLog(
        'whatsapp',
        `Sincronização de conversas concluída: ${afterCount} conversa(s) ativa(s) no CRM${syncedNew > 0 ? ` (+${syncedNew} importadas do aparelho)` : ''}.`
      );
      return {
        ok: true,
        totalConversations: afterCount,
        syncedNew
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Carrega sob demanda até `count` mensagens anteriores de uma conversa específica direto do celular conectado!
   */
  async fetchOlderMessagesForChat(chatId, count = 50) {
    const ready = await this.waitUntilConnected(7000);
    if (!ready || !this.sock) {
      throw new Error('O WhatsApp precisa estar conectado para puxar mensagens anteriores.');
    }

    const key = storage.findSiblingContactKey(chatId) || chatId;
    const contact = storage.data.contacts[key];
    if (!contact) {
      throw new Error('Conversa não encontrada no CRM.');
    }

    const beforeMsgCount = (contact.messages || []).length;
    const anchorMsg = (contact.messages || []).find((m) => Boolean(m?.waMsgId));

    if (!anchorMsg || typeof this.sock.fetchMessageHistory !== 'function') {
      // Se esta conversa ainda não tinha âncora de mensagem local, dispara sincronização geral do histórico!
      await this.syncAllConversationsFromPhone({ force: true, waitMs: 5500 });
      const updated = storage.data.contacts[storage.findSiblingContactKey(chatId) || key];
      return {
        ok: true,
        addedCount: Math.max(0, (updated?.messages?.length || 0) - beforeMsgCount),
        contact: updated || contact
      };
    }

    const waitChunk = new Promise((resolve) => {
      let timer = null;
      const done = (info) => {
        if (timer) clearTimeout(timer);
        this.historySyncWaiters.delete(done);
        resolve(info || {});
      };
      this.historySyncWaiters.add(done);
      timer = setTimeout(() => done({ timedOut: true }), 5000);
    });

    const anchorTsMs = anchorMsg.waTimestampMs || new Date(anchorMsg.timestamp || Date.now()).getTime();
    await this.sock.fetchMessageHistory(
      Math.min(50, Math.max(10, Number(count) || 50)),
      {
        remoteJid: contact.chatId,
        fromMe: Boolean(anchorMsg.waFromMe ?? (anchorMsg.role !== 'user')),
        id: anchorMsg.waMsgId
      },
      anchorTsMs
    );

    await waitChunk;
    const updatedKey = storage.findSiblingContactKey(chatId) || key;
    const updated = storage.data.contacts[updatedKey] || contact;
    return {
      ok: true,
      addedCount: Math.max(0, (updated?.messages?.length || 0) - beforeMsgCount),
      contact: updated
    };
  }

  async handleIncomingRawMessage(msg, { isHistoryAppend = false } = {}) {
    const destJid = msg?.message?.deviceSentMessage?.destinationJid;
    const rawRemoteJid = (destJid && this.isSelfJid(msg?.key?.remoteJid)) ? destJid : msg?.key?.remoteJid;
    if (!this.isValid1to1ChatJid(rawRemoteJid)) return;
    const remoteJid = this.toStorageKey(rawRemoteJid);

    const unwrapped = unwrapMessageContent(msg.message);
    if (!unwrapped) return;

    // Processa reações reais e exclusões/edições de protocolo em tempo real no CRM
    if (unwrapped.reactionMessage) {
      const targetWaId = unwrapped.reactionMessage.key?.id;
      if (targetWaId) {
        const emoji = unwrapped.reactionMessage.text || '';
        const actor = msg.key?.fromMe ? 'owner' : 'user';
        storage.applyMessageReaction(remoteJid, targetWaId, emoji, actor);
        this.broadcastFn('crm_updated', { chatId: remoteJid });
      }
      return;
    }
    if (unwrapped.protocolMessage) {
      const pType = unwrapped.protocolMessage.type;
      const targetWaId = unwrapped.protocolMessage.key?.id;
      if (targetWaId && (pType === 0 || pType === 'REVOKE')) {
        storage.applyMessageDelete(remoteJid, targetWaId);
        this.broadcastFn('crm_updated', { chatId: remoteJid });
      } else if (targetWaId && unwrapped.protocolMessage.editedMessage) {
        const editedTxt = extractReadableTextFromUnwrapped(unwrapMessageContent(unwrapped.protocolMessage.editedMessage));
        if (editedTxt) {
          storage.applyMessageEdit(remoteJid, targetWaId, editedTxt);
          this.broadcastFn('crm_updated', { chatId: remoteJid });
        }
      }
      return;
    }

    const ctxInfo =
      unwrapped.extendedTextMessage?.contextInfo ||
      unwrapped.imageMessage?.contextInfo ||
      unwrapped.videoMessage?.contextInfo ||
      unwrapped.audioMessage?.contextInfo ||
      unwrapped.documentMessage?.contextInfo ||
      null;
    let quotedInfo = undefined;
    if (ctxInfo?.quotedMessage || ctxInfo?.stanzaId) {
      const qTxt = extractReadableTextFromUnwrapped(unwrapMessageContent(ctxInfo.quotedMessage)) || '[Mensagem citada]';
      quotedInfo = {
        waMsgId: ctxInfo.stanzaId || '',
        text: qTxt.slice(0, 180),
        role: ctxInfo.participant && !String(ctxInfo.participant).includes(this.connectedUser?.phone || '___') ? 'user' : 'owner'
      };
    }
    const cleanWaKey = msg.key?.id
      ? {
          id: msg.key.id,
          remoteJid: msg.key.remoteJid,
          fromMe: Boolean(msg.key.fromMe),
          ...(msg.key.participant ? { participant: msg.key.participant } : {})
        }
      : undefined;

    const bestPhone = this.resolvePhoneFromMessage(msg);
    const ownerSelfName = this.getOwnerSelfName();
    const rawPushName = String(msg.pushName || '').trim();
    const rawWaTsMs = toEpochMs(msg.messageTimestamp);
    if (!isHistoryAppend && rawWaTsMs > 1_700_000_000_000) {
      observeServerTimestamp(rawWaTsMs);
    }
    const msgTsMs = rawWaTsMs || trueNowMs();
    const msgIso = new Date(msgTsMs).toISOString();
    const msgAgeMs = Math.max(0, trueNowMs() - msgTsMs);
    const isOldHistoricalMsg = isHistoryAppend && msgAgeMs > 90_000;

    const textContent = extractReadableTextFromUnwrapped(unwrapped);

    const hasAudio = Boolean(unwrapped.audioMessage);
    const hasImage = Boolean(unwrapped.imageMessage || unwrapped.stickerMessage);
    const hasVideo = Boolean(unwrapped.videoMessage);
    const hasAnyDoc = Boolean(unwrapped.documentMessage);
    const hasPdfDoc = Boolean(
      unwrapped.documentMessage &&
      (unwrapped.documentMessage.mimetype?.includes('pdf') || /\.pdf$/i.test(unwrapped.documentMessage.fileName || ''))
    );

    if (!textContent && !hasAudio && !hasImage && !hasVideo && !hasAnyDoc) return;

    // 2. Verificar se a mensagem foi enviada pelo PRÓPRIO DONO no celular/WhatsApp Web (fromMe)
    if (msg.key.fromMe) {
      if (this.sentByBotIds.has(msg.key.id)) {
        return; // Foi enviada pelo próprio robô/painel, ignora!
      }

      const rawOwnerDoc = hasAnyDoc
        ? String(unwrapped.documentMessage?.fileName || unwrapped.documentMessage?.title || 'arquivo').replace(/[^\w.\- ()áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '_').slice(0, 120)
        : '';

      // Se a mensagem manual do dono no celular for recente (< 10 min) e tiver áudio/imagem/arquivo, baixa para tocar/ver também no painel!
      let ownerMediaUrl = null;
      let ownerMediaName = null;
      let ownerMediaMime = null;
      let ownerMediaSize = 0;

      if (!isOldHistoricalMsg && msgAgeMs <= 10 * 60_000 && (hasAudio || hasImage || hasVideo || hasAnyDoc)) {
        try {
          const buf = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger, reuploadRequest: this.sock?.updateMediaMessage }
          );
          if (buf && buf.length <= 20 * 1024 * 1024) {
            const mime = hasAudio
              ? (unwrapped.audioMessage?.mimetype || 'audio/ogg')
              : hasImage
                ? (unwrapped.imageMessage?.mimetype || unwrapped.stickerMessage?.mimetype || 'image/jpeg')
                : hasVideo
                  ? (unwrapped.videoMessage?.mimetype || 'video/mp4')
                  : (unwrapped.documentMessage?.mimetype || 'application/octet-stream');
            const ext = hasAudio
              ? (mime.includes('mp3') || mime.includes('mpeg') ? '.mp3' : mime.includes('mp4') ? '.m4a' : '.ogg')
              : hasImage
                ? (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg')
                : hasVideo
                  ? '.mp4'
                  : (path.extname(rawOwnerDoc).toLowerCase() || (hasPdfDoc ? '.pdf' : '.bin'));
            const fn = `own_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            fs.writeFileSync(path.join(UPLOADS_DIR, fn), buf);
            ownerMediaUrl = `/uploads/${fn}`;
            ownerMediaName = rawOwnerDoc || `Midia_Enviada${ext}`;
            ownerMediaMime = mime;
            ownerMediaSize = buf.length;
          }
        } catch {}
      }

      const ownerDisplayLabel = hasAudio
        ? `🎤 [Áudio enviado por você] ${textContent}`.trim()
        : hasImage
          ? `[Imagem enviada por você] ${textContent}`.trim()
          : hasVideo
            ? `[Vídeo enviado por você] ${textContent}`.trim()
            : hasAnyDoc
              ? `[Arquivo enviado: ${rawOwnerDoc}] ${textContent}`.trim()
              : (textContent || '[Mídia enviada manualmente por você]');

      const knownClientName = this.lookupBestContactName(remoteJid, bestPhone);
      storage.appendContactMessage(
        remoteJid,
        {
          role: 'owner',
          text: ownerDisplayLabel,
          waMsgId: msg.key?.id || undefined,
          ...(cleanWaKey ? { waMsgKey: cleanWaKey } : {}),
          ...(quotedInfo ? { quoted: quotedInfo } : {}),
          ack: 1,
          waFromMe: true,
          waTimestampMs: msgTsMs,
          timestamp: msgIso,
          phone: bestPhone || undefined,
          ...(knownClientName ? { contactName: knownClientName } : {}),
          ...(ownerMediaUrl ? { mediaUrl: ownerMediaUrl, mediaName: ownerMediaName, mediaMime: ownerMediaMime, mediaSize: ownerMediaSize } : {}),
          historical: isOldHistoricalMsg,
          skipUnread: isOldHistoricalMsg
        },
        { historical: isOldHistoricalMsg, ownerSelfName }
      );
      if (!isOldHistoricalMsg) {
        this.fetchContactAvatarIfNeeded(remoteJid).catch(() => {});
      }

      // Só trava/loga pausa automática se a resposta manual no celular foi recente (não em mensagens antigas de semanas atrás!)
      if (!isOldHistoricalMsg && storage.data.settings.humanHandoff?.pauseOnOwnerReply) {
        const activeBiz = storage.getBusiness();
        const mins = activeBiz?.lockUntilManualResume
          ? 'forever'
          : (Number(storage.data.settings.humanHandoff.pauseDurationMinutes) || 60);
        if (this.debounceQueues.has(remoteJid)) {
          clearTimeout(this.debounceQueues.get(remoteJid).timer);
          this.debounceQueues.delete(remoteJid);
        }
        storage.pauseContact(remoteJid, mins, 'Você respondeu manualmente pelo celular', bestPhone);
        storage.addLog(
          'info',
          mins === 'forever'
            ? `IA travada permanentemente para ${bestPhone || remoteJid} (você assumiu a conversa — "ok" não reabre sozinho).`
            : `IA pausada por ${mins} min para ${bestPhone || remoteJid} (você assumiu a conversa).`
        );
      }
      this.broadcastFn('crm_updated', { chatId: remoteJid });
      return;
    }

    // 3. Registrar mensagem recebida do cliente no CRM
    if (!isOldHistoricalMsg) {
      storage.data.stats.totalIncoming += 1;
    }
    const rawDocName = hasAnyDoc
      ? String(unwrapped.documentMessage?.fileName || unwrapped.documentMessage?.title || 'arquivo').replace(/[^\w.\- ()áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '_').slice(0, 120)
      : '';
    const displayLabel = hasAudio
      ? `[Áudio do cliente] ${textContent}`.trim()
      : hasImage
        ? `[Imagem do cliente] ${textContent}`.trim()
        : hasVideo
          ? `[Vídeo do cliente] ${textContent}`.trim()
          : hasAnyDoc
            ? `[Arquivo: ${rawDocName}] ${textContent}`.trim()
            : textContent;

    const cleanClientName =
      this.lookupBestContactName(rawRemoteJid, bestPhone) ||
      (!storage.isGenericContactName(rawPushName, ownerSelfName) ? rawPushName : '') ||
      storage.data.contacts[remoteJid]?.name ||
      (bestPhone ? `+${bestPhone}` : 'Cliente');

    const contact = storage.upsertContact(
      remoteJid,
      {
        ...(bestPhone ? { phone: bestPhone } : {}),
        name: cleanClientName
      },
      { ownerSelfName }
    );

    let downloadedMedia = null;
    let inboundMediaUrl = null;
    let inboundMediaName = null;
    let inboundMediaMime = null;
    let inboundMediaSize = 0;

    // Só baixa binário pesado de mídia se NÃO for mensagem antiga de histórico (evita baixar centenas de vídeos antigos de meses atrás!)
    if (!isOldHistoricalMsg && (hasAudio || hasImage || hasVideo || hasAnyDoc) && !storage.isContactIgnored(bestPhone) && !storage.isContactIgnored(remoteJid)) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger, reuploadRequest: this.sock.updateMediaMessage }
        );
        const mimeType = hasAudio
          ? (unwrapped.audioMessage?.mimetype || 'audio/ogg')
          : hasImage
            ? (unwrapped.imageMessage?.mimetype || unwrapped.stickerMessage?.mimetype || 'image/jpeg')
            : hasVideo
              ? (unwrapped.videoMessage?.mimetype || 'video/mp4')
              : (unwrapped.documentMessage?.mimetype || 'application/octet-stream');

        // Passa buffer multimodal para a IA apenas nos formatos aceitos pelo Gemini (áudio, imagem e PDF)
        if (hasAudio || hasImage || hasPdfDoc) {
          downloadedMedia = { buffer, mimeType: hasPdfDoc ? 'application/pdf' : mimeType };
        }
        if (hasAudio) storage.data.stats.totalAudiosProcessed += 1;
        if (hasImage || hasAnyDoc || hasVideo) storage.data.stats.totalImagesProcessed += 1;

        if (buffer && buffer.length <= 22 * 1024 * 1024) {
          const SAFE_DOC_EXTS = new Set([
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.ppt', '.pptx',
            '.zip', '.rar', '.7z', '.xml', '.json', '.jpg', '.jpeg', '.png', '.webp', '.gif',
            '.mp3', '.ogg', '.opus', '.m4a', '.wav', '.mp4'
          ]);
          let ext = '.bin';
          if (hasAudio) {
            ext = mimeType.includes('mpeg') || mimeType.includes('mp3')
              ? '.mp3'
              : mimeType.includes('mp4') || mimeType.includes('m4a')
                ? '.m4a'
                : mimeType.includes('wav')
                  ? '.wav'
                  : '.ogg';
            inboundMediaName = `Audio_Cliente_${bestPhone.slice(-4) || 'WA'}${ext}`;
          } else if (hasImage) {
            ext = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : mimeType.includes('gif') ? '.gif' : '.jpg';
            inboundMediaName = `Imagem_Cliente_${bestPhone.slice(-4) || 'WA'}${ext}`;
          } else if (hasVideo) {
            ext = '.mp4';
            inboundMediaName = `Video_Cliente_${bestPhone.slice(-4) || 'WA'}.mp4`;
          } else if (hasAnyDoc) {
            const candidateExt = path.extname(rawDocName).toLowerCase();
            ext = SAFE_DOC_EXTS.has(candidateExt)
              ? candidateExt
              : hasPdfDoc
                ? '.pdf'
                : mimeType.includes('spreadsheet') || mimeType.includes('excel')
                  ? '.xlsx'
                  : mimeType.includes('word')
                    ? '.docx'
                    : mimeType.includes('csv')
                      ? '.csv'
                      : mimeType.includes('zip')
                        ? '.zip'
                        : mimeType.includes('text/plain')
                          ? '.txt'
                          : '.bin';
            inboundMediaName = rawDocName || `Arquivo_Cliente${ext}`;
          }

          const savedInName = `in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          fs.writeFileSync(path.join(UPLOADS_DIR, savedInName), buffer);
          inboundMediaUrl = `/uploads/${savedInName}`;
          inboundMediaMime = mimeType;
          inboundMediaSize = buffer.length;
        }
      } catch (err) {
        storage.addLog('error', `Não foi possível baixar mídia/arquivo de ${contact.name}: ${err.message}`);
      }
    }

    storage.appendContactMessage(
      remoteJid,
      {
        role: 'user',
        text: displayLabel,
        waMsgId: msg.key?.id || undefined,
        ...(cleanWaKey ? { waMsgKey: cleanWaKey } : {}),
        ...(quotedInfo ? { quoted: quotedInfo } : {}),
        waFromMe: false,
        waTimestampMs: msgTsMs,
        timestamp: msgIso,
        phone: bestPhone || undefined,
        contactName: cleanClientName || undefined,
        historical: isOldHistoricalMsg,
        skipUnread: isOldHistoricalMsg,
        ...(inboundMediaUrl ? { mediaUrl: inboundMediaUrl } : {}),
        ...(inboundMediaName ? { mediaName: inboundMediaName } : {}),
        ...(inboundMediaMime ? { mediaMime: inboundMediaMime } : {}),
        ...(inboundMediaSize ? { mediaSize: inboundMediaSize } : {})
      },
      { historical: isOldHistoricalMsg, ownerSelfName }
    );
    if (!isOldHistoricalMsg) {
      this.fetchContactAvatarIfNeeded(remoteJid).catch(() => {});
    }
    this.broadcastFn('crm_updated', { chatId: remoteJid });

    // Mensagens históricas/antigas sincronizadas nunca acionam resposta automática retroativa da IA!
    if (isOldHistoricalMsg) {
      return;
    }

    // Se já houver uma resposta posterior mais recente na conversa (ex: o dono já respondeu no celular durante offline), não responde por cima!
    const currentCard = storage.data.contacts[storage.findSiblingContactKey(remoteJid, bestPhone) || remoteJid];
    if (currentCard?.messages?.length) {
      const latestReal = [...currentCard.messages].reverse().find((m) => m.role !== 'internal_note');
      if (latestReal && latestReal.role !== 'user' && new Date(latestReal.timestamp || 0).getTime() > msgTsMs + 1000) {
        return;
      }
    }

    // 4. Checar chave geral do Robô e chave individual de IA deste Chip (slot_1 / slot_2 / slot_3)
    if (!storage.data.settings.botEnabled || !this.isSlotAiEnabled()) {
      return;
    }

    // 4.1 Proteção Anti-Loop entre Chips da própria conta (impede IA do Chip 1 conversar infinitamente com IA do Chip 2!)
    if (this.orchestrator?.isAnyOwnSlotPhone(bestPhone)) {
      storage.addLog('info', `[Proteção Anti-Loop] Mensagem recebida de outro Chip da própria conta (+${bestPhone}) — resposta automática bloqueada.`);
      return;
    }

    // 5. Checar Lista de Contatos Ignorados (Família / Pessoal)
    if (storage.isContactIgnored(bestPhone) || storage.isContactIgnored(remoteJid)) {
      storage.addLog('info', `Mensagem ignorada de ${contact.name} (${bestPhone}) — está na Lista Pessoal/Ignorados.`);
      return;
    }

    // 6. Checar se conversa específica está pausada para atendimento humano (checa JID + telefone irmão @lid/@s.whatsapp.net)
    if (storage.isContactPaused(remoteJid, bestPhone)) {
      return;
    }

    // 7. Checar Horário de Funcionamento
    const schedCheck = isWithinBusinessSchedule(storage.data.settings.schedule);
    if (!schedCheck.active) {
      if (schedCheck.sendOffHoursNotice && storage.data.settings.schedule?.offHoursReplyMessage) {
        const lastSent = this.offHoursNotified.get(remoteJid) || 0;
        if (Date.now() - lastSent > 6 * 60 * 60 * 1000) {
          this.offHoursNotified.set(remoteJid, Date.now());
          await this.sendHumanizedText(remoteJid, storage.data.settings.schedule.offHoursReplyMessage, [msg.key]);
          storage.appendContactMessage(remoteJid, {
            role: 'assistant',
            text: storage.data.settings.schedule.offHoursReplyMessage
          });
          this.broadcastFn('crm_updated', { chatId: remoteJid });
        }
      }
      return;
    }

    // 9. Enfileirar no Debounce Inteligente (juntar mensagens picadas)
    const aiTextPayload = (!textContent && hasAnyDoc && !hasPdfDoc)
      ? `[Cliente enviou o arquivo "${rawDocName || 'documento'}" no WhatsApp]`
      : (!textContent && hasVideo)
        ? '[Cliente enviou um vídeo no WhatsApp]'
        : textContent;

    this.enqueueDebouncedReply({
      chatId: remoteJid,
      phone: bestPhone,
      contactName: contact.name,
      text: aiTextPayload,
      media: downloadedMedia,
      msgKey: msg.key
    });
  }

  enqueueDebouncedReply({ chatId, phone, contactName, text, media, msgKey }) {
    const waitSec = Math.max(1, Number(storage.data.settings.antiBan?.debounceSeconds ?? 6));
    const existing = this.debounceQueues.get(chatId) || {
      texts: [],
      media: null,
      keys: [],
      contactName,
      phone,
      timer: null
    };

    if (existing.timer) clearTimeout(existing.timer);
    if (text) existing.texts.push(text);
    if (media) existing.media = media;
    if (msgKey) existing.keys.push(msgKey);
    existing.contactName = contactName;
    existing.phone = phone;

    existing.timer = setTimeout(() => {
      this.debounceQueues.delete(chatId);
      const lockKey = storage.findSiblingContactKey(chatId, phone) || chatId;
      const prevLock = this.chatProcessingLocks.get(lockKey) || Promise.resolve();
      const nextLock = prevLock
        .catch(() => {})
        .then(() => this.processConsolidatedTurn(chatId, existing))
        .catch((err) => {
          storage.addLog('error', `Erro ao responder ${contactName}: ${err.message}`);
          this.broadcastFn('logs_updated', {});
        })
        .finally(() => {
          if (this.chatProcessingLocks.get(lockKey) === nextLock) {
            this.chatProcessingLocks.delete(lockKey);
          }
        });
      this.chatProcessingLocks.set(lockKey, nextLock);
    }, waitSec * 1000);

    this.debounceQueues.set(chatId, existing);
  }

  checkRateLimit(chatId) {
    const maxPerMin = Number(storage.data.settings.antiBan?.maxRepliesPerMinutePerContact || 6);
    const now = Date.now();
    const arr = (this.rateTracker.get(chatId) || []).filter(ts => now - ts < 60_000);
    if (arr.length >= maxPerMin) {
      return false;
    }
    arr.push(now);
    this.rateTracker.set(chatId, arr);
    return true;
  }

  async processConsolidatedTurn(chatId, batch) {
    if (!this.sock || this.status !== 'connected') {
      const reconnected = await this.waitUntilConnected(8000);
      if (!reconnected || !this.sock) return;
    }
    if (!storage.data.settings.botEnabled || storage.isContactPaused(chatId, batch.phone)) return;
    if (!this.checkRateLimit(chatId)) {
      storage.addLog('alert', `Limite anti-loop atingido para ${batch.contactName}. Ignorando excesso.`);
      return;
    }

    const combinedText = batch.texts.join('\n').trim();
    const profile = storage.getBusiness();
    const canonicalKey = storage.findSiblingContactKey(chatId, batch.phone) || chatId;
    const contact = storage.data.contacts[canonicalKey];

    // Histórico anterior excluindo as mensagens deste lote atual (para não duplicar)
    let rawMsgs = contact?.messages || [];
    // Se a conversa entrou via @lid mas a abertura ativa foi enviada para @s.whatsapp.net do mesmo telefone, preserva o contexto!
    if (rawMsgs.length <= batch.keys.length && batch.phone) {
      const sibling = Object.values(storage.data.contacts).find(
        c => c.chatId !== chatId && normalizePhoneDigits(c.phone) === normalizePhoneDigits(batch.phone) && c.messages?.length > 0
      );
      if (sibling) {
        rawMsgs = [...sibling.messages, ...rawMsgs];
      }
    }
    const priorHistory = rawMsgs.slice(0, Math.max(0, rawMsgs.length - Math.max(1, batch.keys.length)));

    if (contact?.stage === 'novo') {
      storage.upsertContact(chatId, { stage: 'em_atendimento' });
    }

    const aiResult = await generateSmartReply({
      profile,
      settings: storage.data.settings,
      history: priorHistory,
      userText: combinedText,
      media: batch.media,
      contactName: batch.contactName,
      sentVoiceIds: contact?.sentVoiceIds || [],
      allowDemoFallback: false
    });

    const { cleanText, actions, providerUsed, modelUsed, activatedSkills, sentiment, shieldTriggered } = aiResult;
    const skillsNote = activatedSkills?.length ? ` | Skills: ${activatedSkills.slice(0, 3).join(', ')}` : '';

    // Salva sentimento atual (Skill #3) e tags automáticas inteligentes no CRM
    const currentContact = storage.data.contacts[storage.findSiblingContactKey(chatId, batch.phone) || chatId];
    const nextTags = new Set(currentContact?.tags || []);
    if (sentiment?.code === 'hot') nextTags.add('Quente');
    if (shieldTriggered) nextTags.add('🛡️ Tripwire');

    storage.upsertContact(chatId, {
      sentiment: sentiment || { code: 'neutral', label: 'Normal', emoji: '💬' },
      tags: Array.from(nextTags),
      ...(shieldTriggered
        ? { tripwireAlert: { at: new Date().toISOString(), text: combinedText.slice(0, 140) } }
        : {})
    });

    // 0. Caso 1: Silêncio de cortesia (ex: "ok obrigado" final) -> zero texto enviado
    if (actions.courtesySilence) {
      storage.addLog('info', `Silêncio de cortesia aplicado para ${batch.contactName} (nenhum texto automático enviado).`);
      storage.writeNow();
      this.broadcastFn('logs_updated', {});
      return;
    }

    // 0. Caso 2: Pausa Silenciosa (intenção não compreendida / mídia sem contexto seguro) -> ZERO texto enviado ao contato!
    if (actions.silentPauseReason) {
      await this.triggerHumanHandoff({
        chatId,
        contactName: batch.contactName,
        phone: batch.phone,
        reason: actions.silentPauseReason,
        profileName: profile.name,
        silentPause: true,
        permanentLock: true,
        lastCustomerText: combinedText
      });
      storage.writeNow();
      this.broadcastFn('crm_updated', { chatId });
      this.broadcastFn('logs_updated', {});
      return;
    }

    // 1. Enviar texto humanizado (com leitura + digitando + divisão opcional em balões)
    if (cleanText) {
      await this.sendHumanizedText(chatId, cleanText, batch.keys);
      storage.appendContactMessage(chatId, {
        role: 'assistant',
        text: cleanText
      });
      storage.data.stats.totalAiReplies += 1;
      storage.addLog('ai', `[${providerUsed.toUpperCase()} • ${modelUsed}] Respondeu para ${batch.contactName}${skillsNote}`);
    }

    // 1.5. Enviar Áudio Estratégico Pré-Gravado (Voz Humana Real em OGG/Opus + Waveform 64 barras) se acionado pela IA
    if (actions.voiceIds?.length > 0) {
      const voiceId = actions.voiceIds[0];
      try {
        const sentVoice = await this.sendLibraryVoiceToChat(chatId, voiceId, {
          senderRole: 'assistant',
          pauseAi: false,
          keysToRead: cleanText ? [] : batch.keys
        });
        if (sentVoice && !cleanText) {
          storage.data.stats.totalAiReplies += 1;
          storage.addLog(
            'ai',
            `[${providerUsed.toUpperCase()} • ${modelUsed}] Respondeu com Nota de Voz "${sentVoice.name}" (${sentVoice.durationSec}s) para ${batch.contactName}${skillsNote}`
          );
        }
      } catch (err) {
        storage.addLog('error', `Falha ao enviar áudio estratégico (${voiceId}): ${err.message}`);
      }
    }

    // 2. Enviar Mídias do Catálogo (Fotos / PDFs — até 5 arquivos por item) acionadas pela IA
    if (actions.itemIds?.length > 0) {
      for (const itemId of actions.itemIds) {
        const item = (profile.catalog || []).find(it => it.id === itemId);
        if (item && ((item.mediaFiles && item.mediaFiles.length > 0) || item.mediaFile?.filename)) {
          await this.sendCatalogMediaFile(chatId, item);
        }
      }
    }

    // 3. Enviar Dados de PIX + Imagem QR Code + Copia e Cola se acionado
    if (actions.sendPix && profile.pix?.enabled && profile.pix?.key) {
      await this.sendPixPayloadToChat(chatId, profile, actions.pixAmount, 'assistant', batch.contactName);
    }

    // 4. Pedido explícito de parar (Opt-out definitivo — Prioridade #1)
    if (actions.optOutReason) {
      storage.upsertContact(chatId, {
        stage: 'concluido',
        pausedUntil: 'forever',
        pauseReason: `Opt-out respeitado: ${actions.optOutReason}`,
        summary: `Encerrado a pedido do contato: ${actions.optOutReason}`
      });
      if (batch.phone && !storage.isContactIgnored(batch.phone)) {
        storage.data.settings.ignoredContacts = storage.data.settings.ignoredContacts || [];
        storage.data.settings.ignoredContacts.push({
          id: `ign_${Date.now()}`,
          phone: batch.phone,
          name: `${batch.contactName} (Pediu p/ parar)`,
          note: actions.optOutReason,
          createdAt: new Date().toISOString()
        });
      }
      storage.addLog('alert', `Pedido de parar respeitado para ${batch.contactName} (${batch.phone}). Automação bloqueada definitivamente.`);
    }

    // 5. Recusa cordial encerrada sem insistir (Prioridade #3)
    if (actions.closeContactReason && !actions.optOutReason) {
      storage.upsertContact(chatId, {
        stage: 'concluido',
        pausedUntil: 'forever',
        pauseReason: `Abordagem encerrada: ${actions.closeContactReason}`,
        summary: actions.closeContactReason
      });
      storage.addLog('info', `Conversa encerrada sem insistir para ${batch.contactName}: ${actions.closeContactReason}`);
    }

    // 6. Transbordo Humano + Notificação no WhatsApp Pessoal do Dono
    if (actions.handoffReason) {
      await this.triggerHumanHandoff({
        chatId,
        contactName: batch.contactName,
        phone: batch.phone,
        reason: actions.handoffReason,
        profileName: profile.name,
        silentPause: false,
        permanentLock: Boolean(profile.lockUntilManualResume),
        lastCustomerText: combinedText
      });
    }

    storage.writeNow();
    this.broadcastFn('crm_updated', { chatId });
    this.broadcastFn('logs_updated', {});
  }

  async sendHumanizedText(chatId, fullText, keysToRead = []) {
    if (!this.sock || !fullText) return;
    const antiBan = storage.data.settings.antiBan || {};

    if (keysToRead.length > 0) {
      await sleep(randomJitter(Number(antiBan.readDelayMs) || 900));
      await this.sock.readMessages(keysToRead).catch(() => {});
    }

    let chunks = [fullText];
    if (antiBan.splitLongMessages && fullText.length > 260 && fullText.includes('\n\n')) {
      const parts = fullText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1 && parts.length <= 3) {
        chunks = parts;
      } else if (parts.length > 3) {
        chunks = [parts[0], parts.slice(1, -1).join('\n\n'), parts[parts.length - 1]];
      }
    }

    for (const chunk of chunks) {
      if (antiBan.simulateTyping !== false) {
        await this.sock.sendPresenceUpdate('composing', chatId).catch(() => {});
        const minMs = Number(antiBan.minTypingMs) || 1500;
        const maxMs = Number(antiBan.maxTypingMs) || 5000;
        const calcMs = Math.min(maxMs, Math.max(minMs, chunk.length * 24));
        await sleep(randomJitter(calcMs));
        await this.sock.sendPresenceUpdate('paused', chatId).catch(() => {});
      }
      const sent = await this.sock.sendMessage(chatId, { text: chunk });
      this.rememberBotMessage(sent);
    }
  }

  async sendCatalogMediaFile(chatId, item, senderRole = 'assistant') {
    if (!item) return;
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) throw new Error('O WhatsApp não está conectado no momento.');
    }
    const files = Array.isArray(item.mediaFiles) && item.mediaFiles.length > 0
      ? item.mediaFiles
      : (item.mediaFile?.filename ? [item.mediaFile] : []);
    if (!files.length) return;

    const baseCaption = `*${item.name}*${item.price ? ` — R$ ${item.price}` : ''}\n${item.description || ''}${item.paymentLink ? `\n${item.paymentLink}` : ''}`.trim();

    let sentCount = 0;
    for (let idx = 0; idx < files.length; idx++) {
      const mf = files[idx];
      if (!mf?.filename) continue;
      let filePath = path.join(UPLOADS_DIR, mf.filename);
      if (!fs.existsSync(filePath) && mf.url && /^https?:\/\//i.test(mf.url)) {
        const cached = await ensureLocalMediaCached(mf.filename, mf.url);
        if (cached) filePath = cached;
      }
      if (!fs.existsSync(filePath)) continue;

      const buffer = fs.readFileSync(filePath);
      const caption = idx === 0 ? baseCaption : '';
      await sleep(idx === 0 ? 850 : 650);

      let sent;
      const isAudioFile =
        mf.mimeType?.startsWith('audio/') ||
        /\.(ogg|opus|mp3|m4a|wav|webm)$/i.test(mf.filename || '');

      if (mf.mimeType?.startsWith('image/')) {
        sent = await this.sock.sendMessage(chatId, {
          image: buffer,
          ...(caption ? { caption } : {})
        });
      } else if (isAudioFile) {
        const canonical = await convertToCanonicalWhatsAppVoice(buffer, mf.originalName || mf.filename);
        sent = await this.sendCanonicalVoiceNote({
          chatId,
          oggBuffer: canonical.buffer,
          durationSec: canonical.durationSec,
          waveform: canonical.waveform
        });
        if (caption && item.description) {
          await sleep(600);
          const sentCap = await this.sock.sendMessage(chatId, { text: caption });
          this.rememberBotMessage(sentCap);
        }
      } else {
        sent = await this.sock.sendMessage(chatId, {
          document: buffer,
          mimetype: mf.mimeType || 'application/pdf',
          fileName: mf.originalName || `${item.name}_${idx + 1}.pdf`,
          ...(caption ? { caption } : {})
        });
      }
      this.rememberBotMessage(sent);
      storage.data.stats.totalMediaSent += 1;
      sentCount += 1;
      storage.appendContactMessage(chatId, {
        role: senderRole,
        text: isAudioFile
          ? `🎤 [Nota de voz enviada: ${item.name}]`
          : `[Arquivo ${idx + 1}/${files.length} enviado: ${item.name}]`,
        mediaUrl: `/uploads/${mf.filename}`
      });
    }

    if (sentCount > 0) {
      storage.addLog('whatsapp', `Enviou ${sentCount} arquivo(s) do item "${item.name}" para ${chatId}`);
    }
  }

  async sendPixPayloadToChat(chatId, profile, requestedAmount = null, senderRole = 'assistant', contactLabel = '') {
    if (!profile?.pix?.enabled || !profile?.pix?.key) return null;
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) throw new Error('O WhatsApp não está conectado no momento.');
    }
    const pixPayload = await formatPixMessageWithQr(profile.pix, requestedAmount);
    if (!pixPayload) return null;

    if (pixPayload.qrBuffer && profile.pix.sendQrImage !== false) {
      await sleep(750);
      const sentQr = await this.sock.sendMessage(chatId, {
        image: pixPayload.qrBuffer,
        caption: pixPayload.summaryText
      });
      this.rememberBotMessage(sentQr);
      storage.appendContactMessage(chatId, {
        role: senderRole,
        text: `[QR Code PIX enviado]\n${pixPayload.summaryText}`
      });
    } else {
      await this.sendHumanizedText(chatId, pixPayload.summaryText);
      storage.appendContactMessage(chatId, {
        role: senderRole,
        text: pixPayload.summaryText
      });
    }

    if (pixPayload.brcode) {
      await sleep(650);
      const sentBr = await this.sock.sendMessage(chatId, { text: pixPayload.brcode });
      this.rememberBotMessage(sentBr);
      storage.appendContactMessage(chatId, {
        role: senderRole,
        text: `[PIX Copia e Cola]: ${pixPayload.brcode}`
      });
    }

    storage.data.stats.totalPixSent += 1;
    storage.addLog('whatsapp', `Dados PIX${pixPayload.qrBuffer ? ' + QR Code' : ''} enviados para ${contactLabel || chatId}.`);
    return pixPayload;
  }

  async triggerHumanHandoff({
    chatId,
    contactName,
    phone,
    reason,
    profileName,
    silentPause = false,
    permanentLock = false,
    lastCustomerText = ''
  }) {
    const handoffCfg = storage.data.settings.humanHandoff || {};
    const pauseMins = Number(handoffCfg.pauseDurationMinutes) || 60;
    const pausedUntil = permanentLock || silentPause
      ? 'forever'
      : new Date(Date.now() + pauseMins * 60 * 1000).toISOString();

    const canonicalKey = storage.findSiblingContactKey(chatId, phone) || chatId;
    const existingContact = storage.data.contacts[canonicalKey] || {};
    const dossier = buildExecutiveHandoffDossier({
      contact: existingContact,
      handoffReason: reason,
      inboundText: lastCustomerText,
      profile: storage.getBusiness()
    });

    storage.upsertContact(chatId, {
      stage: 'aguardando_humano',
      unreadAlert: true,
      summary: silentPause ? `[Pausa Silenciosa] ${dossier.trigger}` : dossier.trigger,
      handoffDossier: dossier,
      pausedUntil,
      pauseReason: silentPause
        ? `Pausa silenciosa (revisão humana): ${dossier.trigger}`
        : `Aguardando atendimento humano: ${dossier.trigger}`
    });

    storage.data.stats.totalHandoffs += 1;
    storage.addLog(
      'alert',
      silentPause
        ? `Pausa Silenciosa ativada para ${contactName} (${phone}) — zero texto enviado ao contato: ${dossier.trigger}`
        : `Passagem Humana (Dossiê 3 Linhas) para ${contactName} (${phone}): ${dossier.trigger}`
    );
    this.broadcastFn('handoff_alert', {
      chatId,
      contactName,
      phone,
      reason: dossier.trigger,
      dossier,
      silentPause
    });

    // Enviar Dossiê Executivo de 3 Linhas (Skill #2) centralizado pelo Chip 1 Principal (com relay multi-dispositivo + failover)
    if (handoffCfg.notifyOwnerOnHandoff && handoffCfg.ownerPersonalWhatsapp) {
      const ownerDigits = normalizePhoneDigits(handoffCfg.ownerPersonalWhatsapp);
      if (ownerDigits.length >= 10) {
        const fullOwnerDigits = ownerDigits.startsWith('55') ? ownerDigits : `55${ownerDigits}`;
        const waLink = phone ? `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}` : 'Abra no painel';

        const headerTitle = silentPause
          ? '🔕 *PAUSA SILENCIOSA — DOSSIÊ P/ REVISÃO*'
          : '🚨 *PASSAGEM HUMANA — DOSSIÊ EXECUTIVO*';
        const lockNote = pausedUntil === 'forever'
          ? '_Atendimento automático travado nesta conversa ("ok" do cliente não reabre sozinho)._'
          : `_Atendimento automático pausado por ${pauseMins} min nesta conversa para você assumir._`;

        const alertText = [
          headerTitle,
          `*Canal de Entrada:* ${this.getSlotDisplayBadge()}`,
          `*Atendimento:* ${profileName}`,
          `*Contato:* ${contactName} (+${phone || 'N/D'})`,
          '',
          `1️⃣ *Cenário:* ${dossier.scenario}`,
          `2️⃣ *Gatilho:* ${dossier.trigger}`,
          `3️⃣ *Próxima jogada:* ${dossier.nextMove}`,
          lastCustomerText ? `\n*Última fala:* "${lastCustomerText.slice(0, 180)}"` : null,
          silentPause ? '*Conduta:* Nenhum texto foi enviado ao contato.' : null,
          '',
          `*Abrir conversa:* ${waLink}`,
          lockNote
        ]
          .filter(Boolean)
          .join('\n');

        try {
          if (this.orchestrator) {
            await this.orchestrator.deliverOwnerAlertCentralized({
              fromSlotId: this.slotId,
              ownerPhoneDigits: fullOwnerDigits,
              alertText
            });
          } else if (this.sock && this.status === 'connected') {
            await this.sendDirectAlertText(fullOwnerDigits, alertText);
          }
          storage.addLog('whatsapp', `Resumo enviado para o seu WhatsApp pessoal (+${fullOwnerDigits})!`);
        } catch (err) {
          storage.addLog('error', `Não foi possível enviar alerta ao WhatsApp pessoal: ${err.message}`);
        }
      }
    }
  }

  async sendDirectAlertText(fullOwnerDigits, alertText) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error(`${this.getSlotConfig().label} não está conectado neste aparelho.`);
    }
    let targetJid = `${fullOwnerDigits}@s.whatsapp.net`;
    const check = await this.sock.onWhatsApp(fullOwnerDigits).catch(() => []);
    if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
      targetJid = check[0].jid;
    }
    const sentAlert = await this.sock.sendMessage(targetJid, { text: alertText });
    this.rememberBotMessage(sentAlert);
    return sentAlert;
  }

  async fetchContactAvatarIfNeeded(chatId) {
    if (!this.sock || this.status !== 'connected') return '';
    const key = storage.findSiblingContactKey(chatId) || chatId;
    const contact = storage.data.contacts[key];
    if (!contact) return '';
    const lastTry = this.avatarFetchCache.get(key) || 0;
    if (Date.now() - lastTry < 6 * 60 * 60 * 1000 && contact.avatarUrl) {
      return contact.avatarUrl;
    }
    if (Date.now() - lastTry < 15 * 60 * 1000) return contact.avatarUrl || '';
    this.avatarFetchCache.set(key, Date.now());
    try {
      const targetJid = String(contact.chatId || chatId);
      const url = await this.sock.profilePictureUrl(targetJid, 'preview').catch(() => '');
      if (url && /^https?:\/\//i.test(url) && url !== contact.avatarUrl) {
        storage.upsertContact(key, { avatarUrl: url });
        this.broadcastFn('crm_updated', { chatId: key });
        return url;
      }
    } catch {}
    return contact?.avatarUrl || '';
  }

  buildMsgKeyFromStored(chatId, msg) {
    if (!msg) return null;
    const rawChatJid = this.toRawJid(chatId);
    if (msg.waMsgKey?.id) {
      return {
        remoteJid: this.toRawJid(msg.waMsgKey.remoteJid || rawChatJid),
        fromMe: Boolean(msg.waMsgKey.fromMe ?? (msg.role !== 'user')),
        id: msg.waMsgKey.id,
        ...(msg.waMsgKey.participant ? { participant: msg.waMsgKey.participant } : {})
      };
    }
    if (msg.waMsgId) {
      return {
        remoteJid: rawChatJid,
        fromMe: Boolean(msg.waFromMe ?? (msg.role !== 'user')),
        id: msg.waMsgId
      };
    }
    return null;
  }

  async sendManualOwnerMessage(chatId, text, pauseAi = true, opts = {}) {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('O WhatsApp não está conectado no momento.');
      }
    }
    const targetJid = this.toStorageKey(
      String(chatId || '').includes('@')
        ? String(chatId)
        : `${normalizePhoneDigits(chatId)}@s.whatsapp.net`
    );

    let sendOpts = undefined;
    let storedQuoted = undefined;
    if (opts?.quotedMsgId) {
      const { contact: qContact, msg: qMsg } = storage.findMessageInContact(targetJid, opts.quotedMsgId);
      if (qMsg) {
        storedQuoted = {
          id: qMsg.id,
          waMsgId: qMsg.waMsgId || '',
          text: String(qMsg.text || '').slice(0, 180),
          role: qMsg.role || 'user'
        };
        const qKey = this.buildMsgKeyFromStored(qContact?.chatId || targetJid, qMsg);
        if (qKey) {
          sendOpts = {
            quoted: {
              key: qKey,
              message: { conversation: String(qMsg.text || '').slice(0, 400) || 'Mensagem' }
            }
          };
        }
      }
    }

    const sent = await this.sock.sendMessage(targetJid, { text }, sendOpts);
    this.rememberBotMessage(sent);
    const sentWaMs = toEpochMs(sent?.messageTimestamp);
    if (sentWaMs > 1_700_000_000_000) observeServerTimestamp(sentWaMs);
    const sentKey = sent?.key?.id
      ? { id: sent.key.id, remoteJid: sent.key.remoteJid || targetJid, fromMe: true }
      : undefined;
    storage.appendContactMessage(targetJid, {
      role: 'owner',
      text,
      ack: 1,
      timestamp: new Date(sentWaMs || trueNowMs()).toISOString(),
      ...(sent?.key?.id ? { waMsgId: sent.key.id } : {}),
      ...(sentKey ? { waMsgKey: sentKey } : {}),
      ...(storedQuoted ? { quoted: storedQuoted } : {})
    });
    if (pauseAi) {
      const activeBiz = storage.getBusiness();
      const mins = activeBiz?.lockUntilManualResume
        ? 'forever'
        : (Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60);
      storage.pauseContact(targetJid, mins, 'Mensagem manual enviada pelo painel');
    }
    storage.markContactRead(targetJid);
    this.fetchContactAvatarIfNeeded(targetJid).catch(() => {});
    this.broadcastFn('crm_updated', { chatId: targetJid });
    return true;
  }

  async reactToWhatsappMessage(chatId, msgId, emoji = '') {
    const { contact, msg } = storage.findMessageInContact(chatId, msgId);
    if (!contact || !msg) throw new Error('Mensagem não encontrada nesta conversa.');
    const targetJid = contact.chatId;
    const key = this.buildMsgKeyFromStored(targetJid, msg);
    const currentReaction = msg.reactions?.owner || '';
    const nextEmoji = currentReaction === emoji ? '' : String(emoji || '').trim();
    if (key && this.sock && this.status === 'connected') {
      await this.sock.sendMessage(targetJid, { react: { text: nextEmoji, key } });
    }
    const updated = storage.applyMessageReaction(targetJid, msg.id || msg.waMsgId, emoji, 'owner');
    this.broadcastFn('crm_updated', { chatId: targetJid });
    return updated;
  }

  async editWhatsappMessage(chatId, msgId, newText = '') {
    const cleanText = String(newText || '').trim();
    if (!cleanText) throw new Error('Informe o novo texto da mensagem.');
    const { contact, msg } = storage.findMessageInContact(chatId, msgId);
    if (!contact || !msg) throw new Error('Mensagem não encontrada.');
    if (msg.role === 'user') throw new Error('Só é possível editar mensagens enviadas por você ou pelo atendente.');
    const targetJid = contact.chatId;
    const key = this.buildMsgKeyFromStored(targetJid, msg);
    if (key && this.sock && this.status === 'connected') {
      await this.sock.sendMessage(targetJid, { text: cleanText, edit: key });
    }
    const updated = storage.applyMessageEdit(targetJid, msg.id || msg.waMsgId, cleanText);
    this.broadcastFn('crm_updated', { chatId: targetJid });
    return updated;
  }

  async deleteWhatsappMessageForEveryone(chatId, msgId) {
    const { contact, msg } = storage.findMessageInContact(chatId, msgId);
    if (!contact || !msg) throw new Error('Mensagem não encontrada.');
    const targetJid = contact.chatId;
    const key = this.buildMsgKeyFromStored(targetJid, msg);
    if (key && key.fromMe && this.sock && this.status === 'connected') {
      await this.sock.sendMessage(targetJid, { delete: key });
    }
    const updated = storage.applyMessageDelete(targetJid, msg.id || msg.waMsgId);
    this.broadcastFn('crm_updated', { chatId: targetJid });
    return updated;
  }

  async forwardCrmMessage(fromChatId, msgId, toChatIdOrPhone) {
    const { contact: srcContact, msg } = storage.findMessageInContact(fromChatId, msgId);
    if (!srcContact || !msg) throw new Error('Mensagem de origem não encontrada.');
    const rawDest = String(toChatIdOrPhone || '').trim();
    if (!rawDest) throw new Error('Selecione o contato de destino.');
    const destJid = this.toStorageKey(
      rawDest.includes('@') ? rawDest : `${normalizePhoneDigits(rawDest)}@s.whatsapp.net`
    );
    const cleanText = String(msg.text || '').trim();

    if (msg.mediaUrl && this.sock && this.status === 'connected') {
      let buf = null;
      if (msg.mediaUrl.startsWith('/uploads/')) {
        const fp = path.join(UPLOADS_DIR, path.basename(msg.mediaUrl));
        if (fs.existsSync(fp)) buf = fs.readFileSync(fp);
      } else if (/^https?:\/\//i.test(msg.mediaUrl)) {
        const res = await fetch(msg.mediaUrl, { signal: AbortSignal.timeout(25_000) });
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      }
      if (buf) {
        await this.sendManualAttachment({
          chatId: destJid,
          buffer: buf,
          mimeType: msg.mediaMime || 'application/octet-stream',
          fileName: msg.mediaName || 'encaminhado',
          caption: cleanText.startsWith('[') ? '' : cleanText,
          mediaUrl: msg.mediaUrl,
          pauseAi: true
        });
        const destKey = storage.findSiblingContactKey(destJid) || destJid;
        return storage.data.contacts[destKey];
      }
    }

    await this.sendManualOwnerMessage(destJid, cleanText || '[Mensagem encaminhada]', true);
    const destKey = storage.findSiblingContactKey(destJid) || destJid;
    return storage.data.contacts[destKey];
  }

  async processDueScheduledMessages() {
    if (this.scheduledSendingLock || !this.sock || this.status !== 'connected') return;
    this.scheduledSendingLock = true;
    try {
      const nowMs = trueNowMs();
      for (const contact of Object.values(storage.data.contacts || {})) {
        const contactSlot = normalizeSlotId(contact.slotId || parseContactChannelKey(contact.chatId).slotId);
        if (contactSlot !== this.slotId) continue;
        if (!Array.isArray(contact.scheduledMessages) || contact.scheduledMessages.length === 0) continue;
        for (const item of contact.scheduledMessages) {
          if (item.status !== 'pending') continue;
          const dueMs = new Date(item.sendAt).getTime();
          if (Number.isNaN(dueMs) || dueMs > nowMs) continue;
          try {
            await this.sendManualOwnerMessage(contact.chatId, item.text, true);
            storage.markScheduledMessageResult(contact.chatId, item.id, { status: 'sent' });
            storage.addLog('whatsapp', `Mensagem agendada enviada automaticamente para ${contact.name}!`);
          } catch (err) {
            storage.markScheduledMessageResult(contact.chatId, item.id, { status: 'failed', error: err.message });
            storage.addLog('error', `Falha no envio agendado para ${contact.name}: ${err.message}`);
          }
        }
      }
    } finally {
      this.scheduledSendingLock = false;
    }
  }

  /**
   * Envia imagem, vídeo ou documento/arquivo avulso pelo compositor do Inbox 360º.
   */
  async sendManualAttachment({ chatId, buffer, mimeType = 'image/jpeg', fileName = 'anexo', caption = '', mediaUrl = '', pauseAi = true }) {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('O WhatsApp não está conectado no momento.');
      }
    }
    const targetJid = this.toStorageKey(
      String(chatId || '').includes('@')
        ? String(chatId)
        : `${normalizePhoneDigits(chatId)}@s.whatsapp.net`
    );
    const isImage = /^image\//i.test(mimeType) && !/svg/i.test(mimeType);
    const isVideo = /^video\//i.test(mimeType);
    const payload = isImage
      ? {
          image: buffer,
          ...(caption ? { caption } : {})
        }
      : isVideo
        ? {
            video: buffer,
            mimetype: mimeType || 'video/mp4',
            ...(caption ? { caption } : {})
          }
        : {
            document: buffer,
            mimetype: mimeType || 'application/octet-stream',
            fileName: fileName || 'arquivo',
            ...(caption ? { caption } : {})
          };

    const sent = await this.sock.sendMessage(targetJid, payload);
    this.rememberBotMessage(sent);
    storage.data.stats.totalMediaSent += 1;
    storage.appendContactMessage(targetJid, {
      role: 'owner',
      text: caption || (isImage ? '[Imagem enviada]' : isVideo ? `[Vídeo enviado: ${fileName}]` : `[Arquivo enviado: ${fileName}]`),
      ...(sent?.key?.id ? { waMsgId: sent.key.id } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      mediaName: fileName || (isImage ? 'imagem.jpg' : 'arquivo'),
      mediaMime: mimeType,
      mediaSize: buffer?.length || 0
    });
    if (pauseAi) {
      const activeBiz = storage.getBusiness();
      const mins = activeBiz?.lockUntilManualResume
        ? 'forever'
        : (Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60);
      storage.pauseContact(targetJid, mins, 'Anexo enviado manualmente pelo painel');
    }
    storage.markContactRead(targetJid);
    this.broadcastFn('crm_updated', { chatId: targetJid });
    return true;
  }

  /**
   * Dispara uma Nota de Voz 100% indistinguível de gravação real no WhatsApp celular:
   * - Simula "gravando áudio..." proporcional à duração real do áudio;
   * - Sobe pelo endpoint nativo /mms/ptt;
   * - Entrega OGG/Opus mono VoIP + seconds exatos + 64 barras reais de onda sonora (waveform).
   */
  async sendCanonicalVoiceNote({ chatId, oggBuffer, durationSec = 5, waveform = null, keysToRead = [] }) {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('O WhatsApp não está conectado no momento.');
      }
    }
    const antiBan = storage.data.settings.antiBan || {};
    if (keysToRead.length > 0) {
      await sleep(randomJitter(Number(antiBan.readDelayMs) || 850));
      await this.sock.readMessages(keysToRead).catch(() => {});
    }

    if (antiBan.simulateTyping !== false) {
      await this.sock.sendPresenceUpdate('recording', chatId).catch(() => {});
      // Presença "gravando áudio..." proporcional à duração real (entre 2.4s e 8.2s)
      const proportionalMs = Math.min(8200, Math.max(2400, Math.round((Number(durationSec) || 5) * 380)));
      await sleep(randomJitter(proportionalMs));
      await this.sock.sendPresenceUpdate('paused', chatId).catch(() => {});
    }

    const waveArray = Array.isArray(waveform) && waveform.length === 64
      ? new Uint8Array(waveform.map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)))))
      : new Uint8Array(new Array(64).fill(28));

    const payload = {
      audio: oggBuffer,
      mimetype: WHATSAPP_VOICE_MIMETYPE,
      ptt: true,
      seconds: Math.max(1, Math.round(Number(durationSec) || 1)),
      waveform: waveArray
    };

    const pttUpload = this.sock.waUploadToServer
      ? (filePath, opts) => this.sock.waUploadToServer(filePath, { ...opts, mediaType: 'ptt' })
      : undefined;

    let sent;
    try {
      sent = await this.sock.sendMessage(chatId, payload, pttUpload ? { upload: pttUpload } : undefined);
    } catch {
      sent = await this.sock.sendMessage(chatId, payload);
    }
    this.rememberBotMessage(sent);
    return sent;
  }

  /**
   * Envia um áudio pré-gravado da Biblioteca de Áudios Estratégicos (pela IA, pelo CRM ou pelo Disparador).
   */
  async sendLibraryVoiceToChat(chatId, voiceId, { senderRole = 'assistant', pauseAi = false, keysToRead = [] } = {}) {
    const vItem = storage.getVoiceLibrary().find((v) => v.id === voiceId);
    if (!vItem || !vItem.filename) {
      throw new Error('Áudio estratégico não encontrado na biblioteca.');
    }
    let filePath = path.join(UPLOADS_DIR, vItem.filename);
    if (!fs.existsSync(filePath) && vItem.url && /^https?:\/\//i.test(vItem.url)) {
      const cached = await ensureLocalMediaCached(vItem.filename, vItem.url);
      if (cached) filePath = cached;
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo físico .ogg deste áudio não foi encontrado em data/uploads.');
    }

    let oggBuffer = fs.readFileSync(filePath);
    let durationSec = vItem.durationSec || 5;
    let waveform = vItem.waveform;

    // Garantia dupla: se por qualquer motivo o arquivo em disco não era OGG/Opus canônico, converte e atualiza
    if (!isNativeOggOpus(oggBuffer)) {
      const converted = await convertToCanonicalWhatsAppVoice(oggBuffer, vItem.filename);
      oggBuffer = converted.buffer;
      durationSec = converted.durationSec;
      waveform = converted.waveform;
      fs.writeFileSync(filePath, oggBuffer);
    }

    await this.sendCanonicalVoiceNote({
      chatId,
      oggBuffer,
      durationSec,
      waveform,
      keysToRead
    });

    storage.data.stats.totalMediaSent += 1;
    storage.recordVoiceSentToContact(chatId, vItem.id);
    storage.appendContactMessage(chatId, {
      role: senderRole,
      text: `🎤 [Nota de voz: ${vItem.name} (${durationSec}s)]`,
      mediaUrl: vItem.url || `/uploads/${vItem.filename}`,
      durationSec,
      waveform
    });

    if (pauseAi && senderRole === 'owner') {
      const activeBiz = storage.getBusiness();
      const mins = activeBiz?.lockUntilManualResume
        ? 'forever'
        : (Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60);
      storage.pauseContact(chatId, mins, `Áudio estratégico "${vItem.name}" enviado manualmente pelo painel`);
    }

    storage.addLog('whatsapp', `Nota de voz estratégica "${vItem.name}" (${durationSec}s) enviada para ${chatId}.`);
    this.broadcastFn('crm_updated', { chatId });
    this.broadcastFn('logs_updated', {});
    return vItem;
  }

  async sendVoiceNoteToChat(chatId, buffer, originalName = 'nota-voz.ogg', senderRole = 'owner', pauseAi = true) {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('O WhatsApp não está conectado no momento.');
      }
    }

    // Converte SEMPRE para OGG/Opus nativo + extrai duração e 64 barras reais antes de enviar!
    const canonical = await convertToCanonicalWhatsAppVoice(buffer, originalName);
    const savedFilename = `${Date.now()}_${uid('crmvoz')}.ogg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, savedFilename), canonical.buffer);

    await this.sendCanonicalVoiceNote({
      chatId,
      oggBuffer: canonical.buffer,
      durationSec: canonical.durationSec,
      waveform: canonical.waveform
    });

    storage.data.stats.totalMediaSent += 1;
    storage.appendContactMessage(chatId, {
      role: senderRole,
      text: `🎤 [Nota de voz gravada/enviada (${canonical.durationSec}s)]`,
      mediaUrl: `/uploads/${savedFilename}`,
      durationSec: canonical.durationSec,
      waveform: canonical.waveform
    });
    if (pauseAi && senderRole === 'owner') {
      const activeBiz = storage.getBusiness();
      const mins = activeBiz?.lockUntilManualResume
        ? 'forever'
        : (Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60);
      storage.pauseContact(chatId, mins, 'Nota de voz enviada manualmente pelo painel');
    }
    storage.addLog('whatsapp', `Nota de voz nativa OGG/Opus (${canonical.durationSec}s) enviada para ${chatId}.`);
    this.broadcastFn('crm_updated', { chatId });
    this.broadcastFn('logs_updated', {});
    return { durationSec: canonical.durationSec, mediaUrl: `/uploads/${savedFilename}` };
  }

  async checkDueFollowUpsNow({ notifyOwnerWhatsapp = true } = {}) {
    const now = Date.now();
    const contacts = Object.values(storage.data.contacts || {});
    const triggered = [];

    for (const c of contacts) {
      if (!c.followUpAt || c.followUpNotifiedAt) continue;
      const dueMs = new Date(c.followUpAt).getTime();
      if (Number.isNaN(dueMs) || dueMs > now) continue;

      const notifiedAt = new Date().toISOString();
      storage.upsertContact(c.chatId, {
        followUpNotifiedAt: notifiedAt,
        unreadAlert: true
      });
      triggered.push(c);

      storage.addLog(
        'alert',
        `⏰ Hora do retorno agendado (Skill S19) com ${c.name} (+${c.phone || 'N/D'})!`
      );
      this.broadcastFn('followup_due', {
        chatId: c.chatId,
        contactName: c.name,
        phone: c.phone,
        followUpAt: c.followUpAt,
        summary: c.summary || ''
      });

      const handoffCfg = storage.data.settings.humanHandoff || {};
      if (
        notifyOwnerWhatsapp &&
        handoffCfg.notifyOwnerOnHandoff &&
        handoffCfg.ownerPersonalWhatsapp &&
        this.sock &&
        this.status === 'connected' &&
        !String(c.chatId).startsWith('demo_')
      ) {
        const ownerDigits = normalizePhoneDigits(handoffCfg.ownerPersonalWhatsapp);
        if (ownerDigits.length >= 10) {
          const fullOwner = ownerDigits.startsWith('55') ? ownerDigits : `55${ownerDigits}`;
          let targetJid = `${fullOwner}@s.whatsapp.net`;
          try {
            const check = await this.sock.onWhatsApp(fullOwner).catch(() => []);
            if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
              targetJid = check[0].jid;
            }
            const waLink = c.phone ? `https://wa.me/${c.phone.startsWith('55') ? c.phone : `55${c.phone}`}` : 'Abra no painel';
            const whenStr = new Date(c.followUpAt).toLocaleString('pt-BR');
            const alertText = [
              '⏰ *LEMBRETE DE RETORNO AGENDADO (SKILL S19)*',
              `*Contato:* ${c.name} (+${c.phone || 'N/D'})`,
              `*Horário combinado:* ${whenStr}`,
              c.summary ? `*Contexto:* ${c.summary}` : null,
              c.notes ? `*Observações:* ${c.notes}` : null,
              '',
              `*Chamar agora:* ${waLink}`,
              '_Nenhuma mensagem automática foi enviada ao cliente sem sua revisão._'
            ].filter(Boolean).join('\n');

            const sent = await this.sock.sendMessage(targetJid, { text: alertText });
            this.rememberBotMessage(sent);
          } catch (err) {
            storage.addLog('error', `Falha ao enviar lembrete S19 ao WhatsApp pessoal: ${err.message}`);
          }
        }
      }
    }

    if (triggered.length > 0) {
      storage.writeNow();
      this.broadcastFn('crm_updated', {});
      this.broadcastFn('logs_updated', {});
    }
    return triggered;
  }

  async sendTestAlertToOwner(ownerPhoneInput) {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('Conecte o WhatsApp primeiro na aba Conexão QR para testar o envio real.');
      }
    }
    const digits = normalizePhoneDigits(ownerPhoneInput || storage.data.settings.humanHandoff?.ownerPersonalWhatsapp);
    if (digits.length < 10) {
      throw new Error('Informe um número de WhatsApp válido com DDD (ex: 5586999999999).');
    }
    const fullDigits = digits.startsWith('55') ? digits : `55${digits}`;
    let targetJid = `${fullDigits}@s.whatsapp.net`;
    const check = await this.sock.onWhatsApp(fullDigits).catch(() => []);
    if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
      targetJid = check[0].jid;
    }

    const msg = [
      '✅ *TESTE DE ALERTA — ATENDENTE IA UNIVERSAL*',
      '',
      'Perfeito! Seu número pessoal está configurado corretamente.',
      'Sempre que um cliente fechar pedido, enviar comprovante ou pedir um humano, você receberá o resumo completo aqui!'
    ].join('\n');

    const sent = await this.sock.sendMessage(targetJid, { text: msg });
    this.rememberBotMessage(sent);
    return { targetJid };
  }

  async sendProactiveAiOpening(phoneInput, text, leadName = 'Lead Teste', voiceId = '') {
    if (!this.sock || this.status !== 'connected') {
      const ok = await this.waitUntilConnected(7000);
      if (!ok || !this.sock) {
        throw new Error('O WhatsApp ainda não está conectado.');
      }
    }
    let digits = normalizePhoneDigits(phoneInput);
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }
    let rawTargetJid = `${digits}@s.whatsapp.net`;
    const check = await this.sock.onWhatsApp(digits).catch(() => []);
    if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
      rawTargetJid = check[0].jid;
    }

    const targetJid = this.toStorageKey(rawTargetJid);
    const resolvedPhone = normalizePhoneDigits(rawTargetJid) || digits;
    storage.upsertContact(targetJid, {
      slotId: this.slotId,
      phone: resolvedPhone,
      name: leadName,
      stage: 'em_atendimento',
      pausedUntil: null,
      pauseReason: '',
      unreadAlert: false
    });

    if (text && text.trim()) {
      await this.sendHumanizedText(targetJid, text.trim());
      storage.appendContactMessage(targetJid, {
        role: 'assistant',
        text: text.trim()
      });
    }

    if (voiceId) {
      await this.sendLibraryVoiceToChat(targetJid, voiceId, {
        senderRole: 'assistant',
        pauseAi: false
      });
    }

    storage.data.stats.totalAiReplies += 1;
    storage.recordProactiveSend();
    storage.addLog('whatsapp', `[${this.getSlotConfig().label}] Abordagem ativa enviada para +${resolvedPhone} — IA pronta aguardando resposta!`);
    storage.writeNow();
    this.broadcastFn('crm_updated', { chatId: targetJid });
    this.broadcastFn('logs_updated', {});
    return { targetJid, resolvedPhone, slotId: this.slotId, slotLabel: this.getSlotConfig().label };
  }

  getProactiveQueueState() {
    storage.ensureDailyRollover();
    const dailyLimit = Number(storage.data.settings.antiBan?.dailyProactiveLimit || 25);
    const dailySent = Number(storage.data.stats.dailyProactiveSent || 0);
    return {
      running: this.proactiveQueueRunning && !this.proactiveQueuePaused,
      paused: this.proactiveQueuePaused,
      remaining: this.proactiveQueue.length,
      sentSession: this.proactiveSentCount,
      nextRunAt: this.proactiveNextRunAt,
      dailySent,
      dailyLimit,
      preview: this.proactiveQueue.slice(0, 8)
    };
  }

  emitProactiveQueueState() {
    storage.data.proactiveQueue = [...this.proactiveQueue];
    storage.saveSoon();
    this.broadcastFn('proactive_queue_state', this.getProactiveQueueState());
  }

  enqueueProactiveBatch(items = [], templateText = '') {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('Conecte o WhatsApp primeiro antes de iniciar a fila de abordagem ativa.');
    }
    const added = [];
    for (const raw of items) {
      const phone = normalizePhoneDigits(raw.phone || '');
      if (phone.length < 10) continue;
      if (storage.isContactIgnored(phone)) continue;
      if (this.proactiveQueue.some(q => q.phone === phone)) continue;
      const name = (raw.name || 'Contato').trim();
      const baseText = (raw.text || templateText || '').trim();
      if (!baseText) continue;
      const personalized = baseText
        .replace(/\{\{\s*nome\s*\}\}/gi, name !== 'Contato' ? name.split(' ')[0] : '')
        .replace(/\{\s*nome\s*\}/gi, name !== 'Contato' ? name.split(' ')[0] : '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const entry = { phone, name, text: personalized };
      this.proactiveQueue.push(entry);
      added.push(entry);
    }

    if (!added.length) {
      throw new Error('Nenhum contato válido novo encontrado (verifique DDD + número ou contatos bloqueados).');
    }

    this.proactiveQueuePaused = false;
    if (!this.proactiveQueueRunning) {
      this.proactiveQueueRunning = true;
      this.scheduleNextProactiveStep(1500);
    }
    this.emitProactiveQueueState();
    return this.getProactiveQueueState();
  }

  scheduleNextProactiveStep(delayMs) {
    if (this.proactiveQueueTimer) clearTimeout(this.proactiveQueueTimer);
    this.proactiveNextRunAt = Date.now() + delayMs;
    this.emitProactiveQueueState();
    this.proactiveQueueTimer = setTimeout(() => {
      this.proactiveQueueTimer = null;
      this.runNextProactiveItem().catch((err) => {
        storage.addLog('error', `Erro na fila de abordagem ativa: ${err.message}`);
        this.proactiveQueueRunning = false;
        this.proactiveNextRunAt = null;
        this.emitProactiveQueueState();
      });
    }, delayMs);
  }

  async runNextProactiveItem() {
    if (!this.proactiveQueueRunning || this.proactiveQueuePaused) return;
    if (!this.proactiveQueue.length) {
      this.proactiveQueueRunning = false;
      this.proactiveNextRunAt = null;
      storage.addLog('info', `Fila segura de abordagem ativa concluída (${this.proactiveSentCount} enviados na sessão).`);
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    storage.ensureDailyRollover();
    const dailyLimit = Number(storage.data.settings.antiBan?.dailyProactiveLimit || 25);
    const dailySent = Number(storage.data.stats.dailyProactiveSent || 0);
    if (dailySent >= dailyLimit) {
      this.proactiveQueuePaused = true;
      this.proactiveNextRunAt = null;
      storage.addLog('alert', `Fila de abordagem pausada automaticamente: teto diário seguro atingido (${dailySent}/${dailyLimit}).`);
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    if (!this.sock || this.status !== 'connected') {
      this.proactiveQueuePaused = true;
      this.proactiveNextRunAt = null;
      this.emitProactiveQueueState();
      return;
    }

    const next = this.proactiveQueue.shift();
    if (next && !storage.isContactIgnored(next.phone)) {
      try {
        await this.sendProactiveAiOpening(next.phone, next.text, next.name);
        this.proactiveSentCount += 1;
      } catch (err) {
        storage.addLog('error', `Falha ao abordar +${next.phone}: ${err.message}`);
      }
    }

    if (!this.proactiveQueue.length) {
      this.proactiveQueueRunning = false;
      this.proactiveNextRunAt = null;
      storage.addLog('info', 'Todos os contatos da fila de abordagem ativa foram processados!');
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    const minSec = Math.max(20, Number(storage.data.settings.antiBan?.proactiveMinDelaySec || 45));
    const maxSec = Math.max(minSec + 10, Number(storage.data.settings.antiBan?.proactiveMaxDelaySec || 110));
    const waitMs = (minSec + Math.floor(Math.random() * (maxSec - minSec + 1))) * 1000;
    this.scheduleNextProactiveStep(waitMs);
  }

  pauseProactiveQueue(paused = true) {
    this.proactiveQueuePaused = Boolean(paused);
    if (this.proactiveQueuePaused) {
      if (this.proactiveQueueTimer) {
        clearTimeout(this.proactiveQueueTimer);
        this.proactiveQueueTimer = null;
      }
      this.proactiveNextRunAt = null;
    } else if (this.proactiveQueue.length > 0) {
      this.proactiveQueueRunning = true;
      this.scheduleNextProactiveStep(2000);
    }
    this.emitProactiveQueueState();
    return this.getProactiveQueueState();
  }

  async setWhatsAppBlockStatus(chatId, blocked = true) {
    const key = storage.findSiblingContactKey(chatId) || chatId;
    const contact = storage.data.contacts[key];
    let targetJid = key;
    if (this.sock && this.status === 'connected' && !String(key).startsWith('demo_')) {
      if (String(key).endsWith('@lid') && contact?.phone) {
        const digits = normalizePhoneDigits(contact.phone);
        if (digits.length >= 10) {
          targetJid = `${digits.startsWith('55') ? digits : `55${digits}`}@s.whatsapp.net`;
        }
      }
      await this.sock.updateBlockStatus(targetJid, blocked ? 'block' : 'unblock');
    }
    const updated = storage.upsertContact(key, {
      waBlocked: Boolean(blocked),
      aiIgnored: blocked ? true : Boolean(contact?.aiIgnored)
    });
    storage.writeNow();
    this.broadcastFn('crm_updated', { chatId: key });
    return updated;
  }

  async sendContactVCardOnWhatsApp(targetChatId, cardContact = {}) {
    const targetKey = storage.findSiblingContactKey(targetChatId) || targetChatId;
    const displayName = String(cardContact.name || cardContact.phone || 'Contato').trim();
    const vcard = buildContactVCard(cardContact);
    let sentKey = null;

    if (this.sock && this.status === 'connected' && !String(targetKey).startsWith('demo_')) {
      const sent = await this.sock.sendMessage(targetKey, {
        contacts: {
          displayName,
          contacts: [{ vcard }]
        }
      });
      this.rememberBotMessage(sent);
      sentKey = sent?.key || null;
    }

    const phoneLabel = cardContact.phone ? ` (+${normalizePhoneDigits(cardContact.phone)})` : '';
    const updated = storage.appendContactMessage(targetKey, {
      role: 'owner',
      text: `🪪 Cartão de contato enviado: *${displayName}*${phoneLabel}`,
      waMsgId: sentKey?.id || undefined,
      waMsgKey: sentKey
        ? { id: sentKey.id, remoteJid: sentKey.remoteJid || targetKey, fromMe: true }
        : undefined,
      ack: 1
    });
    storage.writeNow();
    this.broadcastFn('crm_updated', { chatId: targetKey });
    return updated;
  }

  clearProactiveQueue() {
    if (this.orchestrator) return this.orchestrator.clearProactiveQueue();
    return { running: false, paused: false, remaining: 0 };
  }
}

/**
 * Orquestrador Multi-Chip (até 3 números simultâneos por conta: slot_1, slot_2, slot_3)
 * Compatível com execução no mesmo dispositivo (~140MB RAM total) OU distribuída entre múltiplos aparelhos!
 */
class WhatsAppMultiSlotManager {
  constructor() {
    this.broadcastFn = () => {};
    this.onStateChange = null;
    this.remoteOwnerAlertRelayFn = null; // Injetado pelo CloudWorker p/ repassar alerta ao Chip 1 quando estiver em outro aparelho
    this.knownCloudSlotPhones = new Set(); // Telefones conectados em outros aparelhos da mesma conta (Proteção Anti-Loop entre dispositivos)
    this.rotationCursor = 0;

    this.slots = {
      slot_1: new WhatsAppSlotEngine('slot_1', this),
      slot_2: new WhatsAppSlotEngine('slot_2', this),
      slot_3: new WhatsAppSlotEngine('slot_3', this)
    };

    // Fila Segura Anti-Ban de Abordagem Ativa centralizada com suporte a Rodízio Inteligente entre Chips
    this.proactiveQueue = Array.isArray(storage.data.proactiveQueue) ? [...storage.data.proactiveQueue] : [];
    this.proactiveChannelMode = 'auto_rotate';
    this.proactiveQueueRunning = false;
    this.proactiveQueuePaused = this.proactiveQueue.length > 0;
    this.proactiveQueueTimer = null;
    this.proactiveNextRunAt = null;
    this.proactiveSentCount = 0;

    // Vigia centralizado de Retornos Agendados (Skill S19 — roda 1 vez p/ todos os chips e alerta pelo Chip 1)
    this.followUpTimer = setInterval(() => {
      this.checkDueFollowUpsNow().catch(() => {});
    }, 45_000);
    if (this.followUpTimer.unref) this.followUpTimer.unref();
  }

  getSlot(slotId = 'slot_1') {
    const clean = normalizeSlotId(slotId);
    return this.slots[clean] || this.slots.slot_1;
  }

  getSlotForChat(chatId = '') {
    const { slotId } = parseContactChannelKey(chatId);
    return this.getSlot(slotId);
  }

  getConnectedSlots() {
    return WA_SLOT_IDS.map((id) => this.slots[id]).filter((s) => s && s.status === 'connected' && s.sock);
  }

  getActiveLocalSlotIds() {
    return WA_SLOT_IDS.filter((id) => {
      const s = this.slots[id];
      return s && (s.status === 'connected' || s.status === 'connecting' || s.status === 'qr_ready' || s.hasSavedSession());
    });
  }

  setCloudPeerSlotPhones(phones = []) {
    this.knownCloudSlotPhones = new Set((phones || []).map((p) => normalizePhoneDigits(p)).filter(Boolean));
  }

  isAnyOwnSlotPhone(phone = '') {
    const digits = normalizePhoneDigits(phone);
    if (!isLikelyRealPhone(digits)) return false;
    for (const id of WA_SLOT_IDS) {
      const sp = this.slots[id]?.connectedUser?.phone;
      if (sp && phonesMatch(sp, digits)) return true;
    }
    for (const cp of this.knownCloudSlotPhones) {
      if (cp && phonesMatch(cp, digits)) return true;
    }
    return false;
  }

  findOtherConnectedSlotByPhone(currentSlotId, phone = '') {
    const digits = normalizePhoneDigits(phone);
    if (!isLikelyRealPhone(digits)) return null;
    for (const id of WA_SLOT_IDS) {
      if (id === currentSlotId) continue;
      const s = this.slots[id];
      if (s?.status === 'connected' && s.connectedUser?.phone && phonesMatch(s.connectedUser.phone, digits)) {
        return s;
      }
    }
    return null;
  }

  setBroadcaster(fn) {
    this.broadcastFn = fn;
    for (const id of WA_SLOT_IDS) {
      this.slots[id].setBroadcaster(fn);
    }
  }

  setStateChangeHook(fn) {
    this.onStateChange = fn;
  }

  setRemoteOwnerAlertRelay(fn) {
    this.remoteOwnerAlertRelayFn = fn;
  }

  setAuthDir(userBaseAuthDir) {
    if (!userBaseAuthDir) return;
    // Slot 1 mantém exatamente a raiz userBaseAuthDir para 100% de retrocompatibilidade sem reconectar QR!
    this.slots.slot_1.setAuthDir(userBaseAuthDir);
    this.slots.slot_2.setAuthDir(path.join(userBaseAuthDir, 'slot_2'));
    this.slots.slot_3.setAuthDir(path.join(userBaseAuthDir, 'slot_3'));
  }

  get status() {
    if (this.getConnectedSlots().length > 0) return 'connected';
    for (const id of WA_SLOT_IDS) {
      if (this.slots[id].status === 'qr_ready') return 'qr_ready';
    }
    for (const id of WA_SLOT_IDS) {
      if (this.slots[id].status === 'connecting') return 'connecting';
    }
    return 'disconnected';
  }

  emitState(event = 'wa_state') {
    const pub = this.getPublicState();
    this.broadcastFn(event, pub);
    if (this.onStateChange) {
      try { this.onStateChange(pub); } catch {}
    }
  }

  getPublicState() {
    const slotsState = {};
    for (const id of WA_SLOT_IDS) {
      slotsState[id] = this.slots[id].getPublicState();
    }
    const primary =
      slotsState.slot_1.status === 'connected'
        ? slotsState.slot_1
        : (WA_SLOT_IDS.map((id) => slotsState[id]).find((s) => s.status === 'connected') || slotsState.slot_1);

    return {
      status: primary.status,
      qrDataUrl: slotsState.slot_1.qrDataUrl,
      pairingCode: slotsState.slot_1.pairingCode,
      connectedUser: primary.connectedUser,
      lastError: slotsState.slot_1.lastError,
      botEnabled: storage.data.settings.botEnabled,
      connectedCount: WA_SLOT_IDS.filter((id) => slotsState[id].status === 'connected').length,
      slots: slotsState,
      proactive: this.getProactiveQueueState()
    };
  }

  hasSavedSession(slotId = null) {
    if (slotId) return this.getSlot(slotId).hasSavedSession();
    return WA_SLOT_IDS.some((id) => this.slots[id].hasSavedSession());
  }

  async autoRestoreIfSessionExists(maxSlots = 3) {
    const allowedIds = WA_SLOT_IDS.slice(0, Math.max(1, Math.min(3, Number(maxSlots) || 3)));
    for (const id of allowedIds) {
      const s = this.slots[id];
      if (s.hasSavedSession() && s.status !== 'connected' && s.status !== 'connecting') {
        s.connect(null).catch((err) => {
          console.error(`[WA ${id}] Erro ao restaurar sessão salva:`, err.message);
        });
      }
    }
  }

  async connect(pairingPhone = null, slotId = 'slot_1') {
    const slot = this.getSlot(slotId);
    await slot.connect(pairingPhone);
    return this.getPublicState();
  }

  async disconnect(clearSession = true, slotId = 'slot_1') {
    const slot = this.getSlot(slotId);
    await slot.disconnect(clearSession);
    return this.getPublicState();
  }

  async disconnectOnly(slotId = null) {
    if (slotId) {
      await this.getSlot(slotId).disconnectOnly();
      return;
    }
    await Promise.all(WA_SLOT_IDS.map((id) => this.slots[id].disconnectOnly().catch(() => {})));
  }

  async syncAllConversationsFromPhone({ force = false, waitMs = 6500, slotId = null } = {}) {
    if (slotId) {
      return this.getSlot(slotId).syncAllConversationsFromPhone({ force, waitMs });
    }
    const connected = this.getConnectedSlots();
    if (!connected.length) {
      return this.slots.slot_1.syncAllConversationsFromPhone({ force, waitMs });
    }
    let totalContacts = 0;
    for (const s of connected) {
      const r = await s.syncAllConversationsFromPhone({ force, waitMs }).catch(() => ({ totalContacts: 0 }));
      totalContacts = Math.max(totalContacts, Number(r?.totalContacts) || 0);
    }
    return { ok: true, totalContacts: Object.keys(storage.data.contacts || {}).length };
  }

  async fetchOlderMessagesForChat(chatId, count = 50) {
    return this.getSlotForChat(chatId).fetchOlderMessagesForChat(chatId, count);
  }

  async sendManualOwnerMessage(chatId, text, pauseAi = true, opts = {}) {
    const targetSlot = opts?.slotId ? this.getSlot(opts.slotId) : this.getSlotForChat(chatId);
    const scopedChatId = buildContactChannelKey(targetSlot.slotId, chatId);
    return targetSlot.sendManualOwnerMessage(scopedChatId, text, pauseAi, opts);
  }

  async reactToWhatsappMessage(chatId, msgId, emoji = '') {
    return this.getSlotForChat(chatId).reactToWhatsappMessage(chatId, msgId, emoji);
  }

  async editWhatsappMessage(chatId, msgId, newText = '') {
    return this.getSlotForChat(chatId).editWhatsappMessage(chatId, msgId, newText);
  }

  async deleteWhatsappMessageForEveryone(chatId, msgId) {
    return this.getSlotForChat(chatId).deleteWhatsappMessageForEveryone(chatId, msgId);
  }

  async forwardCrmMessage(fromChatId, msgId, toChatIdOrPhone) {
    return this.getSlotForChat(toChatIdOrPhone).forwardCrmMessage(fromChatId, msgId, toChatIdOrPhone);
  }

  async sendCatalogMediaFile(chatId, item, senderRole = 'assistant') {
    return this.getSlotForChat(chatId).sendCatalogMediaFile(chatId, item, senderRole);
  }

  async sendPixPayloadToChat(chatId, profile, requestedAmount = null, senderRole = 'assistant', contactLabel = '') {
    return this.getSlotForChat(chatId).sendPixPayloadToChat(chatId, profile, requestedAmount, senderRole, contactLabel);
  }

  async sendManualAttachment(params = {}) {
    const slot = this.getSlotForChat(params.chatId);
    return slot.sendManualAttachment({ ...params, chatId: buildContactChannelKey(slot.slotId, params.chatId) });
  }

  async sendCanonicalVoiceNote(params = {}) {
    const slot = this.getSlotForChat(params.chatId);
    return slot.sendCanonicalVoiceNote({ ...params, chatId: buildContactChannelKey(slot.slotId, params.chatId) });
  }

  async sendLibraryVoiceToChat(chatId, voiceId, opts = {}) {
    const slot = this.getSlotForChat(chatId);
    return slot.sendLibraryVoiceToChat(buildContactChannelKey(slot.slotId, chatId), voiceId, opts);
  }

  async sendVoiceNoteToChat(chatId, buffer, originalName = 'nota-voz.ogg', senderRole = 'owner', pauseAi = true) {
    const slot = this.getSlotForChat(chatId);
    return slot.sendVoiceNoteToChat(buildContactChannelKey(slot.slotId, chatId), buffer, originalName, senderRole, pauseAi);
  }

  async setWhatsAppBlockStatus(chatId, blocked = true) {
    return this.getSlotForChat(chatId).setWhatsAppBlockStatus(chatId, blocked);
  }

  async sendContactVCardOnWhatsApp(targetChatId, cardContact = {}) {
    return this.getSlotForChat(targetChatId).sendContactVCardOnWhatsApp(targetChatId, cardContact);
  }

  /**
   * Regra Centralizada do Usuário:
   * Alertas ao WhatsApp pessoal saem SEMPRE pelo Chip 1 Principal!
   * 1) Se Chip 1 estiver conectado neste aparelho -> envia direto pelo Chip 1.
   * 2) Se Chip 1 estiver conectado em outro aparelho online da mesma conta -> repassa via Cloud Relay (6s timeout).
   * 3) Se Chip 1 estiver desconectado -> usa o chip local conectado como backup automático para nunca perder um fechamento!
   */
  async deliverOwnerAlertCentralized({ fromSlotId = 'slot_1', ownerPhoneDigits, alertText }) {
    if (this.slots.slot_1.status === 'connected' && this.slots.slot_1.sock) {
      return this.slots.slot_1.sendDirectAlertText(ownerPhoneDigits, alertText);
    }
    if (this.remoteOwnerAlertRelayFn) {
      try {
        const relayed = await this.remoteOwnerAlertRelayFn({ ownerPhoneDigits, alertText });
        if (relayed) return relayed;
      } catch {}
    }
    const fallbackSlot =
      (this.slots[fromSlotId]?.status === 'connected' && this.slots[fromSlotId]) ||
      this.getConnectedSlots()[0];
    if (!fallbackSlot) {
      throw new Error('Nenhum chip WhatsApp conectado para entregar o alerta ao seu número pessoal.');
    }
    return fallbackSlot.sendDirectAlertText(ownerPhoneDigits, alertText);
  }

  async sendTestAlertToOwner(ownerPhoneInput, preferredSlotId = 'slot_1') {
    const digits = normalizePhoneDigits(ownerPhoneInput || storage.data.settings.humanHandoff?.ownerPersonalWhatsapp);
    if (digits.length < 10) {
      throw new Error('Informe um número de WhatsApp válido com DDD (ex: 5586999999999).');
    }
    const fullDigits = digits.startsWith('55') ? digits : `55${digits}`;
    const msg = [
      '✅ *TESTE DE ALERTA — ZAP-IA STUDIO MULTI-CHIP*',
      '',
      'Perfeito! Seu número pessoal está configurado corretamente.',
      'Todos os avisos de fechamento dos seus Chips conectados chegarão centralizados aqui!'
    ].join('\n');

    const slot =
      (this.slots.slot_1.status === 'connected' && this.slots.slot_1) ||
      (this.slots[preferredSlotId]?.status === 'connected' && this.slots[preferredSlotId]) ||
      this.getConnectedSlots()[0];
    if (!slot) {
      throw new Error('Conecte pelo menos um Chip WhatsApp primeiro para testar o envio real.');
    }
    await slot.sendDirectAlertText(fullDigits, msg);
    storage.addLog('whatsapp', `Teste de alerta enviado com sucesso pelo ${slot.getSlotConfig().label} para +${fullDigits}!`);
    return { sentTo: fullDigits, sentViaSlot: slot.slotId };
  }

  async checkDueFollowUpsNow({ notifyOwnerWhatsapp = true } = {}) {
    const now = trueNowMs();
    const contacts = Object.values(storage.data.contacts || {});
    const triggered = [];

    for (const c of contacts) {
      if (!c.followUpAt || c.followUpNotifiedAt) continue;
      const dueMs = new Date(c.followUpAt).getTime();
      if (Number.isNaN(dueMs) || dueMs > now) continue;

      const notifiedAt = trueNowIso();
      storage.upsertContact(c.chatId, {
        followUpNotifiedAt: notifiedAt,
        unreadAlert: true
      });
      triggered.push(c);

      const cSlot = this.getSlotForChat(c.chatId);
      storage.addLog(
        'alert',
        `⏰ Hora do retorno agendado (Skill S19 · ${cSlot.getSlotConfig().label}) com ${c.name} (+${c.phone || 'N/D'})!`
      );
      this.broadcastFn('followup_due', {
        chatId: c.chatId,
        slotId: cSlot.slotId,
        contactName: c.name,
        phone: c.phone,
        followUpAt: c.followUpAt,
        summary: c.summary || ''
      });

      const handoffCfg = storage.data.settings.humanHandoff || {};
      if (notifyOwnerWhatsapp && handoffCfg.notifyOwnerOnHandoff && handoffCfg.ownerPersonalWhatsapp && !String(c.chatId).startsWith('demo_')) {
        const ownerDigits = normalizePhoneDigits(handoffCfg.ownerPersonalWhatsapp);
        if (ownerDigits.length >= 10) {
          const fullOwner = ownerDigits.startsWith('55') ? ownerDigits : `55${ownerDigits}`;
          const waLink = c.phone ? `https://wa.me/${c.phone.startsWith('55') ? c.phone : `55${c.phone}`}` : 'Abra no painel';
          const whenStr = new Date(c.followUpAt).toLocaleString('pt-BR');
          const alertText = [
            '⏰ *LEMBRETE DE RETORNO AGENDADO (SKILL S19)*',
            `*Canal da Conversa:* ${cSlot.getSlotDisplayBadge()}`,
            `*Contato:* ${c.name} (+${c.phone || 'N/D'})`,
            `*Horário combinado:* ${whenStr}`,
            c.summary ? `*Contexto:* ${c.summary}` : null,
            c.notes ? `*Observações:* ${c.notes}` : null,
            '',
            `*Chamar agora:* ${waLink}`,
            '_Nenhuma mensagem automática foi enviada ao cliente sem sua revisão._'
          ].filter(Boolean).join('\n');

          try {
            await this.deliverOwnerAlertCentralized({
              fromSlotId: cSlot.slotId,
              ownerPhoneDigits: fullOwner,
              alertText
            });
          } catch (err) {
            storage.addLog('error', `Falha ao enviar lembrete S19 ao WhatsApp pessoal: ${err.message}`);
          }
        }
      }
    }

    if (triggered.length > 0) {
      storage.writeNow();
      this.broadcastFn('crm_updated', {});
      this.broadcastFn('logs_updated', {});
    }
    return triggered;
  }

  pickSlotForProactive(channelMode = 'auto_rotate') {
    const connected = this.getConnectedSlots();
    if (!connected.length) {
      throw new Error('Conecte pelo menos 1 Chip de WhatsApp antes de disparar abordagens ativas.');
    }
    if (channelMode && channelMode !== 'auto_rotate' && WA_SLOT_IDS.includes(channelMode)) {
      const requested = this.slots[channelMode];
      if (!requested || requested.status !== 'connected' || !requested.sock) {
        throw new Error(`O ${requested?.getSlotConfig().label || channelMode} não está conectado neste aparelho.`);
      }
      return requested;
    }
    // Rodízio Inteligente Anti-Ban entre todos os chips conectados!
    const picked = connected[this.rotationCursor % connected.length];
    this.rotationCursor = (this.rotationCursor + 1) % 100000;
    return picked;
  }

  async sendProactiveAiOpening(phoneInput, text, leadName = 'Lead Teste', voiceId = '', channelMode = 'auto_rotate') {
    const slot = this.pickSlotForProactive(channelMode);
    return slot.sendProactiveAiOpening(phoneInput, text, leadName, voiceId);
  }

  getProactiveQueueState() {
    storage.ensureDailyRollover();
    const dailyLimit = Number(storage.data.settings.antiBan?.dailyProactiveLimit || 25);
    const dailySent = Number(storage.data.stats.dailyProactiveSent || 0);
    return {
      running: this.proactiveQueueRunning && !this.proactiveQueuePaused,
      paused: this.proactiveQueuePaused,
      channelMode: this.proactiveChannelMode || 'auto_rotate',
      remaining: this.proactiveQueue.length,
      sentSession: this.proactiveSentCount,
      nextRunAt: this.proactiveNextRunAt,
      dailySent,
      dailyLimit,
      preview: this.proactiveQueue.slice(0, 8)
    };
  }

  emitProactiveQueueState() {
    storage.data.proactiveQueue = [...this.proactiveQueue];
    storage.saveSoon();
    this.broadcastFn('proactive_queue_state', this.getProactiveQueueState());
  }

  enqueueProactiveBatch(items = [], templateText = '', channelMode = 'auto_rotate') {
    const connected = this.getConnectedSlots();
    if (!connected.length) {
      throw new Error('Conecte pelo menos um Chip WhatsApp antes de iniciar a fila de abordagem ativa.');
    }
    if (channelMode && channelMode !== 'auto_rotate' && WA_SLOT_IDS.includes(channelMode)) {
      if (this.slots[channelMode]?.status !== 'connected') {
        throw new Error(`O ${this.slots[channelMode]?.getSlotConfig().label || channelMode} não está conectado neste aparelho.`);
      }
    }
    this.proactiveChannelMode = channelMode || 'auto_rotate';
    const added = [];
    for (const raw of items) {
      const phone = normalizePhoneDigits(raw.phone || '');
      if (phone.length < 10) continue;
      if (storage.isContactIgnored(phone) || this.isAnyOwnSlotPhone(phone)) continue;
      if (this.proactiveQueue.some((q) => q.phone === phone)) continue;
      const name = (raw.name || 'Contato').trim();
      const baseText = (raw.text || templateText || '').trim();
      if (!baseText) continue;
      const personalized = baseText
        .replace(/\{\{\s*nome\s*\}\}/gi, name !== 'Contato' ? name.split(' ')[0] : '')
        .replace(/\{\s*nome\s*\}/gi, name !== 'Contato' ? name.split(' ')[0] : '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const entry = {
        phone,
        name,
        text: personalized,
        channelMode: raw.channelMode || this.proactiveChannelMode
      };
      this.proactiveQueue.push(entry);
      added.push(entry);
    }

    if (!added.length) {
      throw new Error('Nenhum contato válido novo encontrado (verifique DDD + número ou contatos bloqueados).');
    }

    this.proactiveQueuePaused = false;
    if (!this.proactiveQueueRunning) {
      this.proactiveQueueRunning = true;
      this.scheduleNextProactiveStep(1500);
    }
    this.emitProactiveQueueState();
    return this.getProactiveQueueState();
  }

  scheduleNextProactiveStep(delayMs) {
    if (this.proactiveQueueTimer) clearTimeout(this.proactiveQueueTimer);
    this.proactiveNextRunAt = Date.now() + delayMs;
    this.emitProactiveQueueState();
    this.proactiveQueueTimer = setTimeout(() => {
      this.proactiveQueueTimer = null;
      this.runNextProactiveItem().catch((err) => {
        storage.addLog('error', `Erro na fila de abordagem ativa: ${err.message}`);
        this.proactiveQueueRunning = false;
        this.proactiveNextRunAt = null;
        this.emitProactiveQueueState();
      });
    }, delayMs);
  }

  async runNextProactiveItem() {
    if (!this.proactiveQueueRunning || this.proactiveQueuePaused) return;
    if (!this.proactiveQueue.length) {
      this.proactiveQueueRunning = false;
      this.proactiveNextRunAt = null;
      storage.addLog('info', `Fila segura de abordagem ativa concluída (${this.proactiveSentCount} enviados na sessão).`);
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    storage.ensureDailyRollover();
    const connectedCount = Math.max(1, this.getConnectedSlots().length);
    const baseDailyLimit = Number(storage.data.settings.antiBan?.dailyProactiveLimit || 25);
    // Com Rodízio Anti-Ban entre múltiplos chips, escala a capacidade segura proporcionalmente aos chips online!
    const effectiveDailyLimit =
      this.proactiveChannelMode === 'auto_rotate' ? baseDailyLimit * connectedCount : baseDailyLimit;
    const dailySent = Number(storage.data.stats.dailyProactiveSent || 0);
    if (dailySent >= effectiveDailyLimit) {
      this.proactiveQueuePaused = true;
      this.proactiveNextRunAt = null;
      storage.addLog('alert', `Fila de abordagem pausada automaticamente: teto diário seguro atingido (${dailySent}/${effectiveDailyLimit}).`);
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    if (!this.getConnectedSlots().length) {
      this.proactiveQueuePaused = true;
      this.proactiveNextRunAt = null;
      this.emitProactiveQueueState();
      return;
    }

    const next = this.proactiveQueue.shift();
    if (next && !storage.isContactIgnored(next.phone) && !this.isAnyOwnSlotPhone(next.phone)) {
      try {
        await this.sendProactiveAiOpening(next.phone, next.text, next.name, '', next.channelMode || this.proactiveChannelMode);
        this.proactiveSentCount += 1;
      } catch (err) {
        storage.addLog('error', `Falha ao abordar +${next.phone}: ${err.message}`);
      }
    }

    if (!this.proactiveQueue.length) {
      this.proactiveQueueRunning = false;
      this.proactiveNextRunAt = null;
      storage.addLog('info', `Fila segura de abordagem ativa concluída (${this.proactiveSentCount} enviados na sessão).`);
      this.emitProactiveQueueState();
      this.broadcastFn('logs_updated', {});
      return;
    }

    const minSec = Math.max(20, Number(storage.data.settings.antiBan?.proactiveMinDelaySec || 45));
    const maxSec = Math.max(minSec + 10, Number(storage.data.settings.antiBan?.proactiveMaxDelaySec || 110));
    // Com múltiplos chips no rodízio, divide o intervalo de espera pelo nº de chips conectados (respeitando piso de 18s)
    const rawWaitSec = minSec + Math.floor(Math.random() * (maxSec - minSec + 1));
    const effectiveWaitSec =
      this.proactiveChannelMode === 'auto_rotate' && connectedCount > 1
        ? Math.max(18, Math.round(rawWaitSec / connectedCount))
        : rawWaitSec;
    this.scheduleNextProactiveStep(effectiveWaitSec * 1000);
  }

  pauseProactiveQueue(paused = true) {
    this.proactiveQueuePaused = Boolean(paused);
    if (this.proactiveQueuePaused) {
      if (this.proactiveQueueTimer) {
        clearTimeout(this.proactiveQueueTimer);
        this.proactiveQueueTimer = null;
      }
      this.proactiveNextRunAt = null;
    } else if (this.proactiveQueue.length > 0 && !this.proactiveQueueRunning) {
      this.proactiveQueueRunning = true;
      this.scheduleNextProactiveStep(1500);
    } else if (this.proactiveQueue.length > 0 && !this.proactiveQueueTimer) {
      this.scheduleNextProactiveStep(1500);
    }
    this.emitProactiveQueueState();
    return this.getProactiveQueueState();
  }

  clearProactiveQueue() {
    if (this.proactiveQueueTimer) {
      clearTimeout(this.proactiveQueueTimer);
      this.proactiveQueueTimer = null;
    }
    this.proactiveQueue = [];
    this.proactiveQueueRunning = false;
    this.proactiveQueuePaused = false;
    this.proactiveNextRunAt = null;
    this.emitProactiveQueueState();
    return this.getProactiveQueueState();
  }
}

export const whatsappManager = new WhatsAppMultiSlotManager();

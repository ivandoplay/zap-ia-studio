import fs from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers,
  MEDIA_PATH_MAP
} from '@whiskeysockets/baileys';
import { AUTH_DIR, UPLOADS_DIR, storage, normalizePhoneDigits, uid } from './storage.js';
import { generateSmartReply, buildExecutiveHandoffDossier } from './aiEngine.js';
import { formatPixMessageWithQr } from './pix.js';
import { convertToCanonicalWhatsAppVoice, WHATSAPP_VOICE_MIMETYPE, isNativeOggOpus } from './audioProcessor.js';
import { ensureLocalMediaCached } from './supabaseCloud.js';

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
  if (message.ephemeralMessage?.message) return unwrapMessageContent(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessageContent(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessageContent(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) return unwrapMessageContent(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessageContent(message.documentWithCaptionMessage.message);
  return message;
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

class WhatsAppManager {
  constructor() {
    this.sock = null;
    this.authDir = AUTH_DIR;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedUser = null;
    this.lastError = null;
    this.broadcastFn = () => {};
    this.onStateChange = null;

    this.sentByBotIds = new Set();
    this.lidToPhoneMap = new Map(); // LID JID -> Phone digits (3-layer fallback pattern)
    this.debounceQueues = new Map(); // chatId -> { timer, texts, media, keys, pushName, phone }
    this.chatProcessingLocks = new Map(); // chatId -> Promise (evita respostas concorrentes na mesma conversa)
    this.rateTracker = new Map(); // chatId -> timestamps[]
    this.offHoursNotified = new Map(); // chatId -> timestamp
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    // Fila Segura Anti-Ban de Abordagem Ativa (M01–M13) — persistida em disco contra reinícios
    this.proactiveQueue = Array.isArray(storage.data.proactiveQueue) ? [...storage.data.proactiveQueue] : [];
    this.proactiveQueueRunning = false;
    this.proactiveQueuePaused = this.proactiveQueue.length > 0;
    this.proactiveQueueTimer = null;
    this.proactiveNextRunAt = null;
    this.proactiveSentCount = 0;

    this.loadLidMappingsFromDisk();

    // Vigia automático de Retornos Agendados (Skill S19 — alerta o dono na hora marcada sem incomodar o cliente sozinho)
    this.followUpTimer = setInterval(() => {
      this.checkDueFollowUpsNow().catch(() => {});
    }, 45_000);
    if (this.followUpTimer.unref) this.followUpTimer.unref();
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
      const files = fs.readdirSync(dir).filter(f => f.startsWith('lid-mapping-') && f.endsWith('.json'));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const val = JSON.parse(raw);
        if (typeof val === 'string') {
          const key = file.replace('lid-mapping-', '').replace('.json', '');
          if (key.includes('_reverse')) {
            const lidNum = key.replace('_reverse', '');
            this.lidToPhoneMap.set(`${lidNum}@lid`, normalizePhoneDigits(val));
          } else {
            this.lidToPhoneMap.set(`${normalizePhoneDigits(val)}@lid`, normalizePhoneDigits(key));
          }
        }
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

    return normalizePhoneDigits(remoteJid);
  }

  setBroadcaster(fn) {
    this.broadcastFn = fn;
  }

  emitState(event = 'wa_state') {
    const pub = this.getPublicState();
    this.broadcastFn(event, pub);
    if (this.onStateChange) {
      try { this.onStateChange(pub); } catch {}
    }
  }

  getPublicState() {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      pairingCode: this.pairingCode,
      connectedUser: this.connectedUser,
      lastError: this.lastError,
      botEnabled: storage.data.settings.botEnabled,
      proactive: this.getProactiveQueueState()
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

  async connect(pairingPhone = null) {
    if (this.sock && this.status === 'connected') {
      return this.getPublicState();
    }

    // Se já havia um socket pendente (ex: QR aberto ou tentativa anterior) e uma nova conexão foi pedida, encerra limpo
    if (this.sock && (pairingPhone || this.status === 'qr_ready')) {
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    } else if (this.sock && this.status === 'connecting' && !pairingPhone) {
      return this.getPublicState();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
    if (pairingPhone) this.pairingCode = null;
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
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir || AUTH_DIR);
      let version = [2, 3000, 1023223821];
      try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
      } catch {
        // Mantém versão fallback caso offline
      }

      const sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      this.sock = sock;
      let pairingRequested = false;

      sock.ev.on('creds.update', saveCreds);

      const ingestContactMappings = (contacts = []) => {
        for (const c of contacts) {
          const lid = c?.lid || (c?.id?.endsWith('@lid') ? c.id : '');
          const pn = c?.phoneNumber || (c?.id?.endsWith('@s.whatsapp.net') ? c.id : '');
          if (lid && pn) {
            this.lidToPhoneMap.set(lid, normalizePhoneDigits(pn));
          }
        }
      };

      sock.ev.on('contacts.upsert', ingestContactMappings);
      sock.ev.on('contacts.update', ingestContactMappings);

      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Se o usuário pediu Código de 8 Dígitos, solicita na chegada do evento QR (padrão oficial baileys.wiki)
          if (cleanPairingDigits.length >= 10 && !sock.authState.creds.registered && !pairingRequested) {
            pairingRequested = true;
            try {
              const rawCode = await sock.requestPairingCode(cleanPairingDigits);
              const formatted = rawCode?.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
              this.pairingCode = formatted;
              this.qrDataUrl = null;
              this.status = 'qr_ready';
              this.emitState();
              storage.addLog('whatsapp', `Código de pareamento gerado para +${cleanPairingDigits}: ${formatted}`);
              if (resolvePairingWait) resolvePairingWait();
            } catch (err) {
              this.lastError = `Erro ao gerar código de 8 dígitos: ${err.message}`;
              this.emitState();
              if (resolvePairingWait) resolvePairingWait();
            }
          } else if (!this.pairingCode) {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
            this.status = 'qr_ready';
            this.emitState();
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.reconnectAttempts = 0;
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.lastError = null;
          this.loadLidMappingsFromDisk();
          this.connectedUser = {
            id: sock.user?.id || '',
            phone: normalizePhoneDigits(sock.user?.id || ''),
            name: sock.user?.name || 'WhatsApp Conectado'
          };
          storage.addLog('whatsapp', `WhatsApp conectado com sucesso! (${this.connectedUser.phone})`);
          this.emitState();
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          this.sock = null;
          this.qrDataUrl = null;
          this.connectedUser = null;

          if (loggedOut) {
            this.status = 'disconnected';
            this.pairingCode = null;
            this.lastError = 'Sessão desconectada pelo celular. Clique em Conectar WhatsApp para gerar um novo QR Code.';
            this.clearAuthFolder();
            storage.addLog('alert', 'Sessão encerrada pelo aparelho celular.');
            this.emitState();
          } else {
            this.status = 'connecting';
            this.lastError = isRestartRequired
              ? 'Finalizando pareamento seguro com o aparelho...'
              : 'Reconectando ao WhatsApp...';
            this.emitState();
            // Reconexão imediata (450ms) após código 515 de pareamento; caso contrário, backoff exponencial seguro (3.5s -> máx 45s)
            this.reconnectAttempts = isRestartRequired ? 0 : Math.min(8, (this.reconnectAttempts || 0) + 1);
            const delayMs = isRestartRequired
              ? 450
              : Math.min(45000, Math.round(3500 * Math.pow(1.65, this.reconnectAttempts - 1)));
            this.reconnectTimer = setTimeout(() => {
              this.connect().catch(() => {});
            }, delayMs);
          }
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          this.handleIncomingRawMessage(msg).catch(err => {
            console.error('[WA] Erro ao processar mensagem:', err);
            storage.addLog('error', `Erro ao processar mensagem: ${err.message}`);
          });
        }
      });
    } catch (err) {
      this.status = 'disconnected';
      this.lastError = err.message;
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
        fs.rmSync(dir, { recursive: true, force: true });
      }
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error('[WA] Erro ao limpar auth:', err.message);
    }
  }

  async disconnect(clearSession = true) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (this.sock) {
        if (clearSession) {
          await this.sock.logout().catch(() => {});
        } else {
          this.sock.end(undefined);
        }
      }
    } catch {}
    this.sock = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedUser = null;
    if (clearSession) {
      this.clearAuthFolder();
    }
    storage.addLog('whatsapp', 'WhatsApp desconectado pelo painel.');
    this.emitState();
    return this.getPublicState();
  }

  async handleIncomingRawMessage(msg) {
    const remoteJid = msg?.key?.remoteJid;
    if (!remoteJid) return;

    // 1. Ignorar Grupos, Status, Broadcasts e Canais
    if (
      remoteJid === 'status@broadcast' ||
      remoteJid.endsWith('@g.us') ||
      remoteJid.endsWith('@broadcast') ||
      remoteJid.endsWith('@newsletter')
    ) {
      return;
    }

    const unwrapped = unwrapMessageContent(msg.message);
    if (!unwrapped) return;

    // Ignorar mensagens de protocolo/reação pura sem conteúdo
    if (unwrapped.protocolMessage || unwrapped.reactionMessage) return;

    const bestPhone = this.resolvePhoneFromMessage(msg);
    const pushName = msg.pushName || '';

    const textContent = (
      unwrapped.conversation ||
      unwrapped.extendedTextMessage?.text ||
      unwrapped.imageMessage?.caption ||
      unwrapped.videoMessage?.caption ||
      unwrapped.documentMessage?.caption ||
      ''
    ).trim();

    const hasAudio = Boolean(unwrapped.audioMessage);
    const hasImage = Boolean(unwrapped.imageMessage || unwrapped.stickerMessage);
    const hasVideo = Boolean(unwrapped.videoMessage);
    const hasAnyDoc = Boolean(unwrapped.documentMessage);
    const hasPdfDoc = Boolean(
      unwrapped.documentMessage &&
      (unwrapped.documentMessage.mimetype?.includes('pdf') || /\.pdf$/i.test(unwrapped.documentMessage.fileName || ''))
    );

    if (!textContent && !hasAudio && !hasImage && !hasVideo && !hasAnyDoc) return;

    // 2. Verificar se a mensagem foi enviada pelo PRÓPRIO DONO no celular (fromMe)
    if (msg.key.fromMe) {
      if (this.sentByBotIds.has(msg.key.id)) {
        return; // Foi enviada pelo próprio robô, ignora!
      }
      // Foi enviada manualmente pelo dono no celular/WhatsApp Web!
      storage.appendContactMessage(remoteJid, {
        role: 'owner',
        text: textContent || '[Mídia enviada manualmente por você]'
      });

      if (storage.data.settings.humanHandoff?.pauseOnOwnerReply) {
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
            ? `IA travada permanentemente para ${bestPhone} (você assumiu a conversa — "ok" não reabre sozinho).`
            : `IA pausada por ${mins} min para ${bestPhone} (você assumiu a conversa).`
        );
      }
      this.broadcastFn('crm_updated', { chatId: remoteJid });
      return;
    }

    // 3. Registrar mensagem recebida do cliente no CRM (já salvando áudio, imagem, vídeo e QUALQUER arquivo enviado p/ ouvir, ver e baixar no CRM!)
    storage.data.stats.totalIncoming += 1;
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

    const contact = storage.upsertContact(remoteJid, {
      phone: bestPhone,
      name: pushName || storage.data.contacts[remoteJid]?.name || `Cliente ${bestPhone.slice(-4)}`
    });

    let downloadedMedia = null;
    let inboundMediaUrl = null;
    let inboundMediaName = null;
    let inboundMediaMime = null;
    let inboundMediaSize = 0;

    if ((hasAudio || hasImage || hasVideo || hasAnyDoc) && !storage.isContactIgnored(bestPhone) && !storage.isContactIgnored(remoteJid)) {
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

    storage.appendContactMessage(remoteJid, {
      role: 'user',
      text: displayLabel,
      ...(inboundMediaUrl ? { mediaUrl: inboundMediaUrl } : {}),
      ...(inboundMediaName ? { mediaName: inboundMediaName } : {}),
      ...(inboundMediaMime ? { mediaMime: inboundMediaMime } : {}),
      ...(inboundMediaSize ? { mediaSize: inboundMediaSize } : {})
    });
    this.broadcastFn('crm_updated', { chatId: remoteJid });

    // 4. Checar chave geral do Robô
    if (!storage.data.settings.botEnabled) {
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
    if (!this.sock || this.status !== 'connected') return;
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
    if (!this.sock || !item) return;
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
    if (!this.sock || !profile?.pix?.enabled || !profile?.pix?.key) return null;
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

    // Enviar Dossiê Executivo de 3 Linhas (Skill #2) para o WhatsApp pessoal do dono
    if (handoffCfg.notifyOwnerOnHandoff && handoffCfg.ownerPersonalWhatsapp && this.sock && this.status === 'connected') {
      const ownerDigits = normalizePhoneDigits(handoffCfg.ownerPersonalWhatsapp);
      if (ownerDigits.length >= 10) {
        const fullOwnerDigits = ownerDigits.startsWith('55') ? ownerDigits : `55${ownerDigits}`;
        const ownerJid = `${fullOwnerDigits}@s.whatsapp.net`;
        const waLink = phone ? `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}` : 'Abra no painel';

        const headerTitle = silentPause
          ? '🔕 *PAUSA SILENCIOSA — DOSSIÊ P/ REVISÃO*'
          : '🚨 *PASSAGEM HUMANA — DOSSIÊ EXECUTIVO*';
        const lockNote = pausedUntil === 'forever'
          ? '_Atendimento automático travado nesta conversa ("ok" do cliente não reabre sozinho)._'
          : `_Atendimento automático pausado por ${pauseMins} min nesta conversa para você assumir._`;

        const alertText = [
          headerTitle,
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
          let targetJid = ownerJid;
          const check = await this.sock.onWhatsApp(fullOwnerDigits).catch(() => []);
          if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
            targetJid = check[0].jid;
          }
          const sentAlert = await this.sock.sendMessage(targetJid, { text: alertText });
          this.rememberBotMessage(sentAlert);
          storage.addLog('whatsapp', `Resumo enviado para o seu WhatsApp pessoal (+${fullOwnerDigits})!`);
        } catch (err) {
          storage.addLog('error', `Não foi possível enviar alerta ao WhatsApp pessoal: ${err.message}`);
        }
      }
    }
  }

  async sendManualOwnerMessage(chatId, text, pauseAi = true) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('O WhatsApp não está conectado no momento.');
    }
    const sent = await this.sock.sendMessage(chatId, { text });
    this.rememberBotMessage(sent);
    storage.appendContactMessage(chatId, {
      role: 'owner',
      text
    });
    if (pauseAi) {
      const activeBiz = storage.getBusiness();
      const mins = activeBiz?.lockUntilManualResume
        ? 'forever'
        : (Number(storage.data.settings.humanHandoff?.pauseDurationMinutes) || 60);
      storage.pauseContact(chatId, mins, 'Mensagem manual enviada pelo painel');
    }
    this.broadcastFn('crm_updated', { chatId });
    return true;
  }

  /**
   * Envia imagem, vídeo ou documento/arquivo avulso pelo compositor do Inbox 360º.
   */
  async sendManualAttachment({ chatId, buffer, mimeType = 'image/jpeg', fileName = 'anexo', caption = '', mediaUrl = '', pauseAi = true }) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('O WhatsApp não está conectado no momento.');
    }
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

    const sent = await this.sock.sendMessage(chatId, payload);
    this.rememberBotMessage(sent);
    storage.data.stats.totalMediaSent += 1;
    storage.appendContactMessage(chatId, {
      role: 'owner',
      text: caption || (isImage ? '[Imagem enviada]' : isVideo ? `[Vídeo enviado: ${fileName}]` : `[Arquivo enviado: ${fileName}]`),
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
      storage.pauseContact(chatId, mins, 'Anexo enviado manualmente pelo painel');
    }
    this.broadcastFn('crm_updated', { chatId });
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
      throw new Error('O WhatsApp não está conectado no momento.');
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
      throw new Error('O WhatsApp não está conectado no momento.');
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
      throw new Error('Conecte o WhatsApp primeiro na aba Conexão QR para testar o envio real.');
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
      throw new Error('O WhatsApp ainda não está conectado.');
    }
    let digits = normalizePhoneDigits(phoneInput);
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }
    let targetJid = `${digits}@s.whatsapp.net`;
    const check = await this.sock.onWhatsApp(digits).catch(() => []);
    if (Array.isArray(check) && check[0]?.exists && check[0]?.jid) {
      targetJid = check[0].jid;
    }

    const resolvedPhone = normalizePhoneDigits(targetJid) || digits;
    storage.upsertContact(targetJid, {
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
    storage.addLog('whatsapp', `Abordagem ativa enviada para +${resolvedPhone} (${targetJid}) — IA pronta aguardando resposta!`);
    storage.writeNow();
    this.broadcastFn('crm_updated', { chatId: targetJid });
    this.broadcastFn('logs_updated', {});
    return { targetJid, resolvedPhone };
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

export const whatsappManager = new WhatsAppManager();

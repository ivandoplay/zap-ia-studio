import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'url';
import { NICHE_TEMPLATES } from './templates.js';
import { trueNowIso, trueNowMs } from './trueClock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const IS_VERCEL_RUNTIME = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const BUNDLED_DATA_DIR = path.join(ROOT_DIR, 'data');
export const DATA_DIR = IS_VERCEL_RUNTIME ? '/tmp/zapia_data' : BUNDLED_DATA_DIR;
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const AUTH_DIR = path.join(DATA_DIR, 'wa_auth');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Cache de mídia da nuvem é separado por conta; nomes legados não são prova de posse.
export function tenantCloudMediaCachePath(filename, userId) {
  const name = path.basename(String(filename || ''));
  const id = String(userId || '');
  if (!id || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) return null;
  const owner = crypto.createHash('sha256').update(id).digest('hex');
  return path.join(UPLOADS_DIR, '.cloud-cache', owner, name);
}

for (const dir of [DATA_DIR, UPLOADS_DIR, AUTH_DIR]) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {}
}

export const tenantStorageContext = new AsyncLocalStorage();

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export const WA_SLOT_IDS = ['slot_1', 'slot_2', 'slot_3'];

export function normalizeSlotId(slotId = 'slot_1') {
  const s = String(slotId || '').trim().toLowerCase();
  return WA_SLOT_IDS.includes(s) ? s : 'slot_1';
}

export function parseContactChannelKey(contactKey = '') {
  const raw = String(contactKey || '').trim();
  const m = raw.match(/^(slot_[123])::(.+)$/i);
  if (m) {
    const slotId = normalizeSlotId(m[1]);
    const rawJid = m[2];
    return {
      slotId,
      rawJid,
      compositeKey: slotId === 'slot_1' ? rawJid : `${slotId}::${rawJid}`
    };
  }
  return {
    slotId: 'slot_1',
    rawJid: raw,
    compositeKey: raw
  };
}

export function buildContactChannelKey(slotId = 'slot_1', rawJid = '') {
  const cleanSlot = normalizeSlotId(slotId);
  const parsed = parseContactChannelKey(rawJid);
  const baseJid = parsed.rawJid;
  if (!baseJid) return '';
  return cleanSlot === 'slot_1' ? baseJid : `${cleanSlot}::${baseJid}`;
}

export function normalizeWaSlotsSettings(raw = {}) {
  const defaults = {
    slot_1: { label: 'Chip 1', aiEnabled: true },
    slot_2: { label: 'Chip 2', aiEnabled: true },
    slot_3: { label: 'Chip 3', aiEnabled: true }
  };
  const out = {};
  for (const slotId of WA_SLOT_IDS) {
    const src = raw && typeof raw[slotId] === 'object' ? raw[slotId] : {};
    const numIdx = slotId.slice(-1);
    out[slotId] = {
      label: String(src.label || defaults[slotId].label).trim().slice(0, 28) || `Chip ${numIdx}`,
      aiEnabled: src.aiEnabled !== false
    };
  }
  return out;
}

export function normalizePhoneDigits(raw = '') {
  return String(raw)
    .replace(/^slot_[123]::/i, '')
    .replace(/@.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
}

export function extractPhoneFromJidIfPn(jid = '') {
  const s = String(jid || '').replace(/^slot_[123]::/i, '');
  if (!s || s.endsWith('@lid') || s.endsWith('@g.us') || s.endsWith('@newsletter') || s.endsWith('@broadcast')) {
    return '';
  }
  return normalizePhoneDigits(s);
}

/**
 * Compara dois números de telefone brasileiros tolerando presença/ausência do DDI 55 e 9º dígito móvel.
 * Ignora identificadores puros de @lid.
 */
export function isLikelyRealPhone(digits = '') {
  if (String(digits || '').endsWith('@lid')) return false;
  const d = normalizePhoneDigits(digits);
  if (d.length >= 10 && d.length <= 13) return true;
  return false;
}

export function phonesMatch(phoneA = '', phoneB = '') {
  const a = normalizePhoneDigits(phoneA);
  const b = normalizePhoneDigits(phoneB);
  if (!isLikelyRealPhone(a) || !isLikelyRealPhone(b)) return false;
  if (a === b) return true;
  const dddA = a.startsWith('55') && a.length >= 12 ? a.slice(2, 4) : a.slice(0, 2);
  const dddB = b.startsWith('55') && b.length >= 12 ? b.slice(2, 4) : b.slice(0, 2);
  const tailA = a.slice(-8);
  const tailB = b.slice(-8);
  return dddA === dddB && tailA === tailB;
}

export function normalizeCatalogItem(item = {}) {
  const mediaFiles = Array.isArray(item.mediaFiles)
    ? item.mediaFiles.filter(Boolean)
    : (item.mediaFile ? [item.mediaFile] : []);
  return {
    id: item.id || uid('item'),
    name: item.name || 'Item',
    category: item.category || 'Produto',
    price: item.price || '',
    description: item.description || '',
    paymentLink: item.paymentLink || '',
    mediaFiles,
    mediaFile: mediaFiles[0] || null,
    active: item.active !== false
  };
}

export function normalizeVoiceLibraryItem(v = {}) {
  const waveform = Array.isArray(v.waveform) && v.waveform.length === 64
    ? v.waveform.map(n => Math.max(0, Math.min(100, Math.round(Number(n) || 0))))
    : new Array(64).fill(25);
  return {
    id: v.id || uid('aud'),
    name: String(v.name || 'Áudio Estratégico').trim(),
    whenToUse: String(v.whenToUse || '').trim(),
    linkedMessageCode: String(v.linkedMessageCode || '').trim(),
    transcription: String(v.transcription || '').trim(),
    aiEnabled: v.aiEnabled !== false,
    filename: v.filename || '',
    url: v.url || (v.filename ? `/uploads/${v.filename}` : ''),
    mimeType: 'audio/ogg; codecs=opus',
    durationSec: Math.max(1, Math.round(Number(v.durationSec) || 1)),
    waveform,
    sizeBytes: Number(v.sizeBytes) || 0,
    sentCount: Number(v.sentCount) || 0,
    createdAt: v.createdAt || new Date().toISOString(),
    updatedAt: v.updatedAt || new Date().toISOString()
  };
}

export function normalizeQuickReplyItem(q = {}) {
  const cleanShortcut = String(q.shortcut || 'atalho')
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '') || 'atalho';
  return {
    id: q.id || uid('qr'),
    shortcut: cleanShortcut,
    title: String(q.title || cleanShortcut).trim(),
    text: String(q.text || '').trim()
  };
}

export function createDefaultQuickReplies() {
  return [
    {
      id: 'qr_boasvindas',
      shortcut: 'boasvindas',
      title: 'Boas-vindas Rápida',
      text: 'Olá! Tudo bem? Vi sua mensagem aqui agora e já assumi seu atendimento pessoalmente. Como posso te ajudar?'
    },
    {
      id: 'qr_horario',
      shortcut: 'horario',
      title: 'Horário de Atendimento',
      text: 'Nosso horário de atendimento é de segunda a sábado, das 08h às 18h. Qualquer dúvida pode deixar aqui que já te retorno!'
    },
    {
      id: 'qr_proposta',
      shortcut: 'proposta',
      title: 'Alinhamento de Proposta',
      text: 'Perfeito! Vou separar as condições certinhas para o seu cenário e já te mando aqui em seguida.'
    },
    {
      id: 'qr_pix',
      shortcut: 'pix',
      title: 'Confirmação de PIX',
      text: 'Assim que finalizar o PIX, pode me mandar o comprovante aqui mesmo na conversa para eu liberar tudo pra você!'
    },
    {
      id: 'qr_retorno',
      shortcut: 'retorno',
      title: 'Retorno de Acompanhamento',
      text: 'Oi! Passando rapidinho como combinamos para saber se conseguiu ver nossa última conversa ou se ficou alguma dúvida.'
    }
  ];
}

export function normalizeCustomTagItem(raw = {}) {
  const name = String(raw.name || '').trim().slice(0, 32) || 'Etiqueta';
  const colorRaw = String(raw.color || '#10b981').trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw.toLowerCase() : '#10b981';
  return {
    id: raw.id || `tag_${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 20) || uid('t')}`,
    name,
    color
  };
}

export function createDefaultCustomTags() {
  return [
    { id: 'tag_quente', name: 'Quente', color: '#ef4444' },
    { id: 'tag_orcamento', name: 'Orçamento', color: '#f59e0b' },
    { id: 'tag_vip', name: 'VIP', color: '#8b5cf6' },
    { id: 'tag_retorno', name: 'Retorno', color: '#3b82f6' },
    { id: 'tag_fechado', name: 'Fechado', color: '#10b981' },
    { id: 'tag_duvida', name: 'Dúvida', color: '#06b6d4' }
  ];
}

export function createBusinessFromTemplate(tpl = NICHE_TEMPLATES[0]) {
  const p = tpl.profile;
  return {
    id: 'business_unico',
    name: p.name,
    niche: p.niche,
    icon: tpl.icon || '🚗',
    assistantName: p.assistantName || 'Assistente',
    soloIdentity: Boolean(p.soloIdentity),
    tone: p.tone || 'consultivo',
    trainingPackId: p.trainingPackId || null,
    lockUntilManualResume: Boolean(p.lockUntilManualResume),
    promptShieldEnabled: true,
    companySummary: p.companySummary || '',
    goldenRules: p.goldenRules || '',
    deliveryAndPayment: p.deliveryAndPayment || '',
    extraInstructions: p.extraInstructions || '',
    faqs: (p.faqs || []).map(f => ({ id: f.id || uid('faq'), question: f.question, answer: f.answer })),
    knowledgeDocs: [],
    voiceLibrary: [],
    quickReplies: createDefaultQuickReplies(),
    customTags: createDefaultCustomTags(),
    catalog: (p.sampleCatalog || []).map(item => normalizeCatalogItem({
      id: uid('item'),
      name: item.name,
      category: item.category || 'Produto',
      price: item.price || '',
      description: item.description || '',
      paymentLink: item.paymentLink || '',
      mediaFiles: [],
      active: true
    })),
    pix: {
      enabled: false,
      keyType: 'aleatoria',
      key: '',
      receiverName: '',
      bankName: '',
      city: 'BRASIL',
      instructions: 'Envie o comprovante aqui na conversa assim que finalizar o pagamento!',
      includeCopyPaste: true,
      sendQrImage: true
    },
    updatedAt: trueNowIso()
  };
}

function normalizeBusinessObject(raw = {}, fallback = createBusinessFromTemplate(NICHE_TEMPLATES[0])) {
  return {
    ...fallback,
    ...raw,
    id: 'business_unico',
    promptShieldEnabled: raw.promptShieldEnabled !== false,
    pix: {
      ...fallback.pix,
      ...(raw.pix || {}),
      sendQrImage: raw.pix?.sendQrImage !== false,
      includeCopyPaste: raw.pix?.includeCopyPaste !== false
    },
    faqs: Array.isArray(raw.faqs) ? raw.faqs : fallback.faqs,
    knowledgeDocs: Array.isArray(raw.knowledgeDocs) ? raw.knowledgeDocs : [],
    voiceLibrary: Array.isArray(raw.voiceLibrary)
      ? raw.voiceLibrary.filter(Boolean).map(normalizeVoiceLibraryItem)
      : [],
    quickReplies: Array.isArray(raw.quickReplies) && raw.quickReplies.length > 0
      ? raw.quickReplies.filter(Boolean).map(normalizeQuickReplyItem)
      : (fallback.quickReplies || createDefaultQuickReplies()),
    customTags: Array.isArray(raw.customTags) && raw.customTags.length > 0
      ? raw.customTags.filter(Boolean).map(normalizeCustomTagItem)
      : (fallback.customTags || createDefaultCustomTags()),
    catalog: Array.isArray(raw.catalog) ? raw.catalog.map(normalizeCatalogItem) : fallback.catalog,
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

/**
 * Unifica contatos duplicados quando uma conversa ativa começa em @s.whatsapp.net e a resposta
 * entra via @lid (padrão WhatsApp Baileys v7), preservando histórico, tags, pausas e notas em 1 único card.
 */
function deduplicateContactsMap(rawContacts = {}) {
  const entries = Object.entries(rawContacts || {}).map(([k, c]) => {
    const parsedKey = parseContactChannelKey(c?.chatId || k);
    const effectiveSlot = c?.slotId ? normalizeSlotId(c.slotId) : parsedKey.slotId;
    const canonicalKey = buildContactChannelKey(effectiveSlot, parsedKey.rawJid);
    return {
      tags: [],
      sentVoiceIds: [],
      followUpAt: null,
      ...c,
      slotId: effectiveSlot,
      chatId: canonicalKey
    };
  });

  const mergedByKey = [];
  // Índices mantêm exatamente o primeiro item correspondente da implementação anterior,
  // sem comparar cada ficha contra todas as outras a cada sincronização.
  const jidIndex = new Map();
  const phoneIndex = new Map();
  const phoneSignature = (phone) => {
    if (!isLikelyRealPhone(phone)) return '';
    const d = normalizePhoneDigits(phone);
    const ddd = d.startsWith('55') && d.length >= 12 ? d.slice(2, 4) : d.slice(0, 2);
    return `${ddd}:${d.slice(-8)}`;
  };
  const indexKey = (slot, value) => `${slot}\u0000${value}`;
  const updateIndex = (map, key, index, add) => {
    if (!key) return;
    let indices = map.get(key);
    if (add) {
      if (!indices) map.set(key, indices = new Set());
      indices.add(index);
    } else if (indices) {
      indices.delete(index);
      if (!indices.size) map.delete(key);
    }
  };
  const indexItem = (entry, index, add) => {
    const slot = normalizeSlotId(entry.slotId || parseContactChannelKey(entry.chatId).slotId);
    updateIndex(jidIndex, indexKey(slot, entry.chatId), index, add);
    const phone = phoneSignature(entry.phone);
    if (phone) updateIndex(phoneIndex, indexKey(slot, phone), index, add);
  };
  const firstIndex = (indices) => {
    let first = Infinity;
    if (indices) for (const index of indices) if (index < first) first = index;
    return first;
  };
  for (const item of entries) {
    const itemSlot = normalizeSlotId(item.slotId || parseContactChannelKey(item.chatId).slotId);
    const phone = phoneSignature(item.phone);
    const matchIndex = Math.min(
      firstIndex(jidIndex.get(indexKey(itemSlot, item.chatId))),
      phone ? firstIndex(phoneIndex.get(indexKey(itemSlot, phone))) : Infinity
    );
    const existingIdx = Number.isFinite(matchIndex) ? matchIndex : -1;

    if (existingIdx === -1) {
      const added = { ...item, slotId: itemSlot };
      mergedByKey.push(added);
      indexItem(added, mergedByKey.length - 1, true);
      continue;
    }

    const prev = mergedByKey[existingIdx];
    const itemRaw = parseContactChannelKey(item.chatId).rawJid;
    const prevRaw = parseContactChannelKey(prev.chatId).rawJid;
    // Prefere o JID @lid dentro do mesmo chip quando ambos existem para o mesmo número real
    const preferItemJid = itemRaw.endsWith('@lid') && !prevRaw.endsWith('@lid');
    const canonicalJid = buildContactChannelKey(itemSlot, preferItemJid ? itemRaw : prevRaw);

    // Mescla mensagens ordenadas por horário sem duplicar waMsgId ou texto+role próximos
    const combinedMsgs = [...(prev.messages || []), ...(item.messages || [])]
      .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    const dedupedMsgs = [];
    const seenWaIds = new Set();
    for (const m of combinedMsgs) {
      if (m?.waMsgId) {
        if (seenWaIds.has(m.waMsgId)) continue;
        seenWaIds.add(m.waMsgId);
      }
      const dup = !m?.waMsgId && dedupedMsgs.some(
        dm => dm.role === m.role && dm.text === m.text &&
          Math.abs(new Date(dm.timestamp || 0).getTime() - new Date(m.timestamp || 0).getTime()) < 5000
      );
      if (!dup) dedupedMsgs.push(m);
    }

    const stageRank = { novo: 0, qualificando: 1, em_atendimento: 2, concluido: 3, aguardando_humano: 4 };
    const bestStage = (stageRank[item.stage] || 0) >= (stageRank[prev.stage] || 0) ? item.stage : prev.stage;
    const mergedTags = Array.from(new Set([...(prev.tags || []), ...(item.tags || [])]));
    const mergedSentVoiceIds = Array.from(new Set([...(prev.sentVoiceIds || []), ...(item.sentVoiceIds || [])]));
    const mergeById = (a = [], b = []) => {
      const m = new Map();
      for (const x of [...a, ...b]) if (x?.id) m.set(x.id, x);
      return Array.from(m.values());
    };
    const mergedTasks = mergeById(prev.tasks, item.tasks);
    const mergedSched = mergeById(prev.scheduledMessages, item.scheduledMessages);
    const bestPausedUntil = prev.pausedUntil === 'forever' || item.pausedUntil === 'forever'
      ? 'forever'
      : (item.pausedUntil || prev.pausedUntil || null);

    // Prefere nome real salvo na agenda / pushName ao invés de número cru (+55...) ou rótulo genérico
    const pickName = (n) => {
      const s = String(n || '').trim();
      if (!s) return false;
      if (/^(Cliente|Contato|Contato WhatsApp|WhatsApp)\b/i.test(s)) return false;
      if (/Teste Lojista/i.test(s)) return false;
      if (/^\+?\d{7,}$/.test(s.replace(/[\s()-]/g, ''))) return false;
      if (s.includes('@lid') || s.includes('@s.whatsapp.net')) return false;
      return true;
    };
    const bestName = pickName(prev.name) ? prev.name : (pickName(item.name) ? item.name : (prev.name || item.name));

    const latestClearedAt =
      (item.historyClearedAt || '') >= (prev.historyClearedAt || '')
        ? (item.historyClearedAt || prev.historyClearedAt || null)
        : (prev.historyClearedAt || null);
    const clearedMs = latestClearedAt ? new Date(latestClearedAt).getTime() || 0 : 0;
    const filteredDeduped = clearedMs
      ? dedupedMsgs.filter((m) => (new Date(m?.timestamp || 0).getTime() || 0) > clearedMs)
      : dedupedMsgs;

    indexItem(prev, existingIdx, false);
    mergedByKey[existingIdx] = {
      ...prev,
      ...item,
      slotId: itemSlot,
      chatId: canonicalJid,
      phone: isLikelyRealPhone(item.phone) ? item.phone : prev.phone,
      name: prev.savedContact ? (prev.name || bestName) : (item.savedContact ? (item.name || bestName) : bestName),
      savedContact: Boolean(prev.savedContact || item.savedContact),
      waBlocked: Boolean(prev.waBlocked || item.waBlocked),
      historyClearedAt: latestClearedAt,
      avatarUrl: item.avatarUrl || prev.avatarUrl || '',
      company: item.company || prev.company || '',
      email: item.email || prev.email || '',
      docNumber: item.docNumber || prev.docNumber || '',
      city: item.city || prev.city || '',
      leadSource: item.leadSource || prev.leadSource || '',
      dealValue: Number(item.dealValue) || Number(prev.dealValue) || 0,
      dealStatus: item.dealStatus && item.dealStatus !== 'open' ? item.dealStatus : (prev.dealStatus || 'open'),
      lostReason: item.lostReason || prev.lostReason || '',
      aiIgnored: Boolean(prev.aiIgnored || item.aiIgnored),
      tasks: mergedTasks,
      scheduledMessages: mergedSched,
      stage: bestStage,
      tags: mergedTags,
      sentVoiceIds: mergedSentVoiceIds,
      followUpAt: item.followUpAt || prev.followUpAt || null,
      pausedUntil: bestPausedUntil,
      pauseReason: item.pauseReason || prev.pauseReason || '',
      summary: item.summary || prev.summary || '',
      notes: [prev.notes, item.notes].filter(Boolean).join('\n').trim(),
      unreadAlert: Boolean(prev.unreadAlert || item.unreadAlert),
      messages: filteredDeduped.slice(-120),
      lastMessageAt:
        new Date(item.lastMessageAt || 0).getTime() >= new Date(prev.lastMessageAt || 0).getTime()
          ? item.lastMessageAt
          : prev.lastMessageAt
    };
    indexItem(mergedByKey[existingIdx], existingIdx, true);
  }

  return Object.fromEntries(mergedByKey.map(c => [c.chatId, c]));
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultDatabase() {
  // CÉREBRO ÚNICO: já vem direto com o treinamento Lizandro Celestino (v.turbo), sem múltiplos perfis concorrentes!
  const defaultBusiness = createBusinessFromTemplate(NICHE_TEMPLATES[0]);

  return {
    settings: {
      botEnabled: true,
      securityPin: '',
      branding: {
        appName: 'Ienvia',
        appSubtitle: 'Atendente Universal',
        soundAlertOnHandoff: true
      },
      ai: {
        provider: 'gemini',
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        geminiKeyPool: '',
        geminiModel: 'gemini-3.5-flash-lite',
        autoFallbackProvider: 'groq',
        promptShieldEnabled: true,
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        openaiModel: 'gpt-4o-mini',
        groqApiKey: process.env.GROQ_API_KEY || '',
        groqModel: 'llama-3.3-70b-versatile',
        openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
        openrouterModel: 'deepseek/deepseek-chat',
        temperature: 0.35,
        maxHistoryMessages: 20
      },
      antiBan: {
        debounceSeconds: 6,
        simulateTyping: true,
        minTypingMs: 1800,
        maxTypingMs: 5200,
        readDelayMs: 1000,
        splitLongMessages: true,
        maxRepliesPerMinutePerContact: 6,
        dailyProactiveLimit: 25,
        proactiveMinDelaySec: 45,
        proactiveMaxDelaySec: 110
      },
      humanHandoff: {
        pauseOnOwnerReply: true,
        pauseDurationMinutes: 60,
        ownerPersonalWhatsapp: '',
        notifyOwnerOnHandoff: true
      },
      schedule: {
        mode: 'always',
        startHour: '08:00',
        endHour: '18:00',
        workDays: [1, 2, 3, 4, 5, 6],
        timezone: 'America/Fortaleza',
        offHoursReplyMessage: 'Olá! Nosso atendimento funciona de Segunda a Sábado, das 08h às 18h. Assim que abrirmos já te respondemos!'
      },
      waSlots: normalizeWaSlotsSettings(),
      ignoredContacts: [],
      deletedChatTombstones: {}
    },
    business: defaultBusiness,
    contacts: {},
    proactiveQueue: [],
    simulatorHistory: [],
    stats: {
      totalIncoming: 0,
      totalAiReplies: 0,
      totalAudiosProcessed: 0,
      totalImagesProcessed: 0,
      totalMediaSent: 0,
      totalPixSent: 0,
      totalHandoffs: 0,
      dailyDate: getTodayIsoDate(),
      dailyAiCalls: 0,
      dailyProactiveSent: 0,
      avgLatencyMs: 0,
      latencySamples: 0,
      autoFallbacksTriggered: 0,
      blockedInjections: 0
    },
    logs: []
  };
}

export function createCleanBusinessForNewTenant(displayName = 'Meu Negócio') {
  return {
    id: 'business_unico',
    name: displayName || 'Meu Negócio',
    niche: 'Atendimento & Vendas',
    icon: '💬',
    assistantName: 'Equipe Comercial',
    tone: 'consultivo',
    trainingPackId: null,
    lockUntilManualResume: false,
    promptShieldEnabled: true,
    companySummary: 'Descreva aqui o que sua empresa vende, diferenciais, público atendido e região de atuação.',
    goldenRules: [
      '1. Responda sempre como pessoa real da equipe comercial (jamais diga que é IA, robô ou assistente virtual).',
      '2. Seja objetivo, cordial e use apenas fatos confirmados sobre nossos produtos e serviços.',
      '3. Quando não tiver certeza de valores personalizados, prazos ou negociações especiais, chame um atendente humano com [[CHAMAR_HUMANO:Dúvida comercial específica]].'
    ].join('\n'),
    deliveryAndPayment: 'Informe aqui formas de pagamento aceitas, prazos e condições de entrega ou agendamento.',
    extraInstructions: '',
    faqs: [],
    knowledgeDocs: [],
    voiceLibrary: [],
    quickReplies: createDefaultQuickReplies(),
    catalog: [],
    pix: {
      enabled: false,
      keyType: 'aleatoria',
      key: '',
      receiverName: '',
      bankName: '',
      city: 'BRASIL',
      instructions: 'Envie o comprovante aqui na conversa assim que finalizar o pagamento!',
      includeCopyPaste: true,
      sendQrImage: true
    },
    updatedAt: trueNowIso()
  };
}

export function createCleanDatabaseForNewTenant(displayName = 'Meu Negócio') {
  const base = createDefaultDatabase();
  // Contas novas de clientes começam 100% limpas e sem chaves de terceiros
  base.business = createCleanBusinessForNewTenant(displayName);
  base.settings.ai.geminiApiKey = '';
  base.settings.ai.geminiKeyPool = '';
  base.settings.ai.openaiApiKey = '';
  base.settings.ai.groqApiKey = '';
  base.settings.ai.openrouterApiKey = '';
  base.settings.humanHandoff.ownerPersonalWhatsapp = '';
  base.customPacks = {};
  return base;
}

export class Storage {
  constructor(options = {}) {
    this.inMemory = Boolean(options.inMemory);
    this.isCloudTenant = Boolean(options.isCloudTenant);
    this.userId = options.userId || null;
    this.username = options.username || null;
    this.userRole = options.userRole || 'master';
    this.dbFile = options.dbFile || DB_FILE;
    this.onMutate = typeof options.onMutate === 'function' ? options.onMutate : null;
    this.workspaceDirty = false;
    this.dirtyContactIds = new Set();
    this.deletedContactIds = new Set();
    this.saveTimer = null;

    if (this.inMemory) {
      this.data = this.hydrateFromSnapshot(options.initialData || createDefaultDatabase(), options.fallbackClean);
      this.initialContactKeys = new Set(Object.keys(this.data.contacts || {}));
    } else {
      this.data = this.load();
      this.initialContactKeys = new Set(Object.keys(this.data.contacts || {}));
    }
  }

  hydrateFromSnapshot(parsed = {}, fallbackClean = false) {
    const defaults = fallbackClean ? createCleanDatabaseForNewTenant() : createDefaultDatabase();
    const business = normalizeBusinessObject(parsed.business || defaults.business, defaults.business);
    const contacts = deduplicateContactsMap(parsed.contacts || {});
    const cleanSettings = {
      ...defaults.settings,
      ...(parsed.settings || {}),
      branding: { ...defaults.settings.branding, ...(parsed.settings?.branding || {}) },
      ai: { ...defaults.settings.ai, ...(parsed.settings?.ai || {}) },
      antiBan: { ...defaults.settings.antiBan, ...(parsed.settings?.antiBan || {}) },
      humanHandoff: { ...defaults.settings.humanHandoff, ...(parsed.settings?.humanHandoff || {}) },
      schedule: { ...defaults.settings.schedule, ...(parsed.settings?.schedule || {}) },
      waSlots: normalizeWaSlotsSettings(parsed.settings?.waSlots)
    };
    delete cleanSettings.activeProfileId;

    return {
      settings: cleanSettings,
      business,
      contacts,
      customPacks: parsed.customPacks && typeof parsed.customPacks === 'object' ? parsed.customPacks : {},
      proactiveQueue: Array.isArray(parsed.proactiveQueue) ? parsed.proactiveQueue : [],
      simulatorHistory: Array.isArray(parsed.simulatorHistory) ? parsed.simulatorHistory : [],
      stats: { ...defaults.stats, ...(parsed.stats || {}) },
      logs: Array.isArray(parsed.logs) ? parsed.logs : []
    };
  }

  load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf-8');
        const parsed = JSON.parse(raw);
        const defaults = createDefaultDatabase();

        // Migração automática e limpa de qualquer estrutura antiga multi-perfil para Cérebro Único (business)
        let sourceBusiness = parsed.business || null;
        if (!sourceBusiness && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          const activeId = parsed.settings?.activeProfileId;
          sourceBusiness =
            parsed.profiles.find(p => p.id === activeId) ||
            parsed.profiles.find(p => p.trainingPackId === 'lizandro-v-turbo' || p.id === 'prof_lizandro_turbo') ||
            parsed.profiles[0];
        }

        const business = normalizeBusinessObject(sourceBusiness || defaults.business, defaults.business);
        const contacts = deduplicateContactsMap(parsed.contacts || {});

        const cleanSettings = {
          ...defaults.settings,
          ...(parsed.settings || {}),
          branding: { ...defaults.settings.branding, ...(parsed.settings?.branding || {}) },
          ai: { ...defaults.settings.ai, ...(parsed.settings?.ai || {}) },
          antiBan: { ...defaults.settings.antiBan, ...(parsed.settings?.antiBan || {}) },
          humanHandoff: { ...defaults.settings.humanHandoff, ...(parsed.settings?.humanHandoff || {}) },
          schedule: { ...defaults.settings.schedule, ...(parsed.settings?.schedule || {}) },
          waSlots: normalizeWaSlotsSettings(parsed.settings?.waSlots)
        };
        delete cleanSettings.activeProfileId;

        const migrated = {
          settings: cleanSettings,
          business,
          contacts,
          customPacks: parsed.customPacks && typeof parsed.customPacks === 'object' ? parsed.customPacks : {},
          proactiveQueue: Array.isArray(parsed.proactiveQueue) ? parsed.proactiveQueue : [],
          simulatorHistory: Array.isArray(parsed.simulatorHistory) ? parsed.simulatorHistory : [],
          stats: { ...defaults.stats, ...(parsed.stats || {}) },
          logs: Array.isArray(parsed.logs) ? parsed.logs : []
        };

        // Se havia perfis antigos ou contatos duplicados, persiste já limpo no disco
        if (parsed.profiles || Object.keys(parsed.contacts || {}).length !== Object.keys(contacts).length) {
          this.writeNow(migrated);
        }
        return migrated;
      }
    } catch (err) {
      console.error('[Storage] Erro ao ler database.json, iniciando padrão:', err.message);
    }
    const initial = createDefaultDatabase();
    initial.customPacks = {};
    this.writeNow(initial);
    return initial;
  }

  ensureDailyRollover() {
    const today = getTodayIsoDate();
    if (this.data.stats.dailyDate !== today) {
      this.data.stats.dailyDate = today;
      this.data.stats.dailyAiCalls = 0;
      this.data.stats.dailyProactiveSent = 0;
      this.saveSoon();
    }
  }

  recordAiTelemetry({ latencyMs = 0, usedFallback = false, blockedInjection = false } = {}) {
    this.ensureDailyRollover();
    if (blockedInjection) {
      this.data.stats.blockedInjections = (this.data.stats.blockedInjections || 0) + 1;
      this.saveSoon();
      return;
    }
    this.data.stats.dailyAiCalls = (this.data.stats.dailyAiCalls || 0) + 1;
    if (usedFallback) {
      this.data.stats.autoFallbacksTriggered = (this.data.stats.autoFallbacksTriggered || 0) + 1;
    }
    if (latencyMs > 0) {
      const prevSamples = Number(this.data.stats.latencySamples || 0);
      const prevAvg = Number(this.data.stats.avgLatencyMs || 0);
      const nextSamples = Math.min(200, prevSamples + 1);
      this.data.stats.avgLatencyMs = Math.round(((prevAvg * prevSamples) + latencyMs) / (prevSamples + 1));
      this.data.stats.latencySamples = nextSamples;
    }
    this.saveSoon();
  }

  recordProactiveSend() {
    this.ensureDailyRollover();
    this.data.stats.dailyProactiveSent = (this.data.stats.dailyProactiveSent || 0) + 1;
    this.saveSoon();
  }

  markWorkspaceDirty() {
    this.workspaceDirty = true;
    if (this.onMutate) {
      try { this.onMutate(this); } catch {}
    }
  }

  writeNow(payload = this.data) {
    this.workspaceDirty = true;
    if (this.onMutate && payload === this.data) {
      try { this.onMutate(this); } catch {}
    }
    if (this.inMemory) return;
    const serialized = JSON.stringify(payload, null, 2);
    const tmpFile = `${this.dbFile}.tmp`;
    try {
      fs.writeFileSync(tmpFile, serialized, 'utf-8');
      try {
        fs.renameSync(tmpFile, this.dbFile);
      } catch (renameErr) {
        // Fallback para Windows (EPERM/EBUSY quando Windows Defender/Indexer escaneia o arquivo)
        fs.writeFileSync(this.dbFile, serialized, 'utf-8');
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (err) {
      console.error('[Storage] Falha ao salvar database.json:', err.message);
    }
  }

  saveSoon() {
    this.workspaceDirty = true;
    if (this.onMutate) {
      try { this.onMutate(this); } catch {}
    }
    if (this.inMemory) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeNow();
    }, 250);
  }

  addLog(type, message, meta = {}) {
    const entry = {
      id: uid('log'),
      type,
      message,
      meta,
      timestamp: trueNowIso()
    };
    this.data.logs.unshift(entry);
    if (this.data.logs.length > 150) {
      this.data.logs.length = 150;
    }
    this.saveSoon();
    return entry;
  }

  /**
   * Retorna o Cérebro Único do sistema (sem múltiplos perfis concorrentes).
   */
  getBusiness() {
    if (!this.data.business) {
      this.data.business = createBusinessFromTemplate(NICHE_TEMPLATES[0]);
    }
    return this.data.business;
  }

  // Alias mantido por compatibilidade interna
  getActiveProfile() {
    return this.getBusiness();
  }

  /**
   * Substitui os textos de treinamento do Cérebro Único por um modelo pronto (sob confirmação explícita),
   * preservando o PIX já configurado caso o usuário não queira perdê-lo.
   */
  applyTemplateToBusiness(templateId, keepCatalogAndPix = true) {
    const tpl = NICHE_TEMPLATES.find(t => t.id === templateId) || NICHE_TEMPLATES[0];
    const fresh = createBusinessFromTemplate(tpl);
    const current = this.getBusiness();
    this.data.business = {
      ...fresh,
      pix: keepCatalogAndPix && current.pix?.key ? current.pix : fresh.pix,
      catalog: keepCatalogAndPix && current.catalog?.length ? current.catalog : fresh.catalog,
      voiceLibrary: keepCatalogAndPix && current.voiceLibrary?.length ? current.voiceLibrary : [],
      updatedAt: trueNowIso()
    };
    this.writeNow();
    return this.data.business;
  }

  getQuickReplies() {
    const biz = this.getBusiness();
    if (!Array.isArray(biz.quickReplies) || biz.quickReplies.length === 0) {
      biz.quickReplies = createDefaultQuickReplies();
    }
    return biz.quickReplies;
  }

  saveQuickReply(rawItem = {}) {
    const biz = this.getBusiness();
    biz.quickReplies = this.getQuickReplies();
    const normalized = normalizeQuickReplyItem(rawItem);
    const idx = biz.quickReplies.findIndex((q) => q.id === normalized.id || q.shortcut === normalized.shortcut);
    if (idx >= 0) {
      biz.quickReplies[idx] = { ...biz.quickReplies[idx], ...normalized, id: biz.quickReplies[idx].id };
    } else {
      biz.quickReplies.push(normalized);
    }
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return normalized;
  }

  deleteQuickReply(id) {
    const biz = this.getBusiness();
    biz.quickReplies = this.getQuickReplies();
    const idx = biz.quickReplies.findIndex((q) => q.id === id);
    if (idx === -1) return null;
    const [removed] = biz.quickReplies.splice(idx, 1);
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return removed;
  }

  getCustomTags() {
    const biz = this.getBusiness();
    if (!Array.isArray(biz.customTags) || biz.customTags.length === 0) {
      biz.customTags = createDefaultCustomTags();
    }
    return biz.customTags;
  }

  saveCustomTag(rawTag = {}) {
    const biz = this.getBusiness();
    biz.customTags = this.getCustomTags();
    const normalized = normalizeCustomTagItem(rawTag);
    const idx = biz.customTags.findIndex(
      (t) => t.id === normalized.id || t.name.toLowerCase() === normalized.name.toLowerCase()
    );
    if (idx >= 0) {
      const oldName = biz.customTags[idx].name;
      biz.customTags[idx] = { ...biz.customTags[idx], ...normalized, id: biz.customTags[idx].id };
      if (oldName !== normalized.name) {
        for (const c of Object.values(this.data.contacts || {})) {
          if (Array.isArray(c.tags) && c.tags.includes(oldName)) {
            c.tags = c.tags.map((t) => (t === oldName ? normalized.name : t));
            this.dirtyContactIds.add(c.chatId);
          }
        }
      }
    } else {
      biz.customTags.push(normalized);
    }
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return normalized;
  }

  deleteCustomTag(idOrName) {
    const biz = this.getBusiness();
    biz.customTags = this.getCustomTags();
    const idx = biz.customTags.findIndex((t) => t.id === idOrName || t.name === idOrName);
    if (idx === -1) return null;
    const [removed] = biz.customTags.splice(idx, 1);
    for (const c of Object.values(this.data.contacts || {})) {
      if (Array.isArray(c.tags) && c.tags.includes(removed.name)) {
        c.tags = c.tags.filter((t) => t !== removed.name);
        this.dirtyContactIds.add(c.chatId);
      }
    }
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return removed;
  }

  getVoiceLibrary() {
    const biz = this.getBusiness();
    biz.voiceLibrary = Array.isArray(biz.voiceLibrary) ? biz.voiceLibrary : [];
    return biz.voiceLibrary;
  }

  saveVoiceLibraryItem(rawItem = {}) {
    const biz = this.getBusiness();
    biz.voiceLibrary = Array.isArray(biz.voiceLibrary) ? biz.voiceLibrary : [];
    const idx = biz.voiceLibrary.findIndex(v => v.id === rawItem.id);
    const prev = idx >= 0 ? biz.voiceLibrary[idx] : {};
    const normalized = normalizeVoiceLibraryItem({
      ...prev,
      ...rawItem,
      createdAt: prev.createdAt || rawItem.createdAt || trueNowIso(),
      updatedAt: trueNowIso()
    });
    if (idx >= 0) {
      biz.voiceLibrary[idx] = normalized;
    } else {
      biz.voiceLibrary.push(normalized);
    }
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return normalized;
  }

  deleteVoiceLibraryItem(id) {
    const biz = this.getBusiness();
    biz.voiceLibrary = Array.isArray(biz.voiceLibrary) ? biz.voiceLibrary : [];
    const idx = biz.voiceLibrary.findIndex(v => v.id === id);
    if (idx === -1) return null;
    const [removed] = biz.voiceLibrary.splice(idx, 1);
    biz.updatedAt = new Date().toISOString();
    this.writeNow();
    return removed;
  }

  recordVoiceSentToContact(chatId, voiceId) {
    if (!voiceId) return;
    const biz = this.getBusiness();
    const vItem = (biz.voiceLibrary || []).find(v => v.id === voiceId);
    if (vItem) {
      vItem.sentCount = (Number(vItem.sentCount) || 0) + 1;
    }
    if (chatId) {
      const key = this.findSiblingContactKey(chatId) || chatId;
      const existing = this.data.contacts[key];
      const prevIds = Array.isArray(existing?.sentVoiceIds) ? existing.sentVoiceIds : [];
      if (!prevIds.includes(voiceId)) {
        this.upsertContact(key, { sentVoiceIds: [...prevIds, voiceId] });
      }
    }
    this.saveSoon();
  }

  isContactIgnored(phoneOrJid = '') {
    const raw = String(phoneOrJid || '');
    if (raw && this.data.contacts?.[raw]?.aiIgnored) return true;
    const sibKey = raw ? this.findSiblingContactKey(raw) : null;
    if (sibKey && this.data.contacts?.[sibKey]?.aiIgnored) return true;
    const digits = normalizePhoneDigits(phoneOrJid);
    if (!digits) return false;
    const list = this.data.settings.ignoredContacts || [];
    return list.some(item => {
      const ignoredDigits = normalizePhoneDigits(item.phone);
      if (!ignoredDigits) return false;
      if (digits === ignoredDigits) return true;
      return phonesMatch(digits, ignoredDigits);
    });
  }

  findSiblingContactKey(chatId, phone = '') {
    const { slotId, compositeKey } = parseContactChannelKey(chatId);
    if (this.data.contacts[compositeKey]) return compositeKey;
    const checkPhone = phone || extractPhoneFromJidIfPn(compositeKey);
    if (!isLikelyRealPhone(checkPhone)) return null;
    for (const [existingJid, c] of Object.entries(this.data.contacts)) {
      const existingSlot = normalizeSlotId(c?.slotId || parseContactChannelKey(existingJid).slotId);
      if (existingSlot !== slotId) continue;
      if (!String(existingJid).endsWith('@lid') || isLikelyRealPhone(c.phone)) {
        if (phonesMatch(c.phone, checkPhone)) {
          return existingJid;
        }
      }
    }
    return null;
  }

  isGenericContactName(name = '', ownerName = '') {
    const clean = String(name || '').trim();
    if (!clean) return true;
    if (clean === 'Cliente' || /^Cliente\s+\d+$/i.test(clean) || /^Contato\s+\+?\d+$/i.test(clean) || /^\+?\d{8,}$/.test(clean)) {
      return true;
    }
    if (ownerName && clean.toLowerCase() === String(ownerName).trim().toLowerCase()) {
      return true;
    }
    return false;
  }

  upsertContact(rawChatIdInput, patch = {}, opts = {}) {
    const parsedInput = parseContactChannelKey(rawChatIdInput);
    const slotId = normalizeSlotId(patch.slotId || opts.slotId || parsedInput.slotId);
    const chatId = buildContactChannelKey(slotId, parsedInput.rawJid);
    const jidPhone = extractPhoneFromJidIfPn(chatId);
    const existingDirect = this.data.contacts[chatId];
    const existingValidPhone = existingDirect && isLikelyRealPhone(existingDirect.phone) && !String(existingDirect.phone).endsWith('@lid')
      ? existingDirect.phone
      : '';
    const candidatePhone = isLikelyRealPhone(patch.phone)
      ? normalizePhoneDigits(patch.phone)
      : (existingValidPhone || jidPhone);

    let targetKey = chatId;

    // Unifica automaticamente qualquer card duplicado do mesmo telefone DENTRO DO MESMO CHIP (@s.whatsapp.net <-> @lid)
    if (isLikelyRealPhone(candidatePhone)) {
      for (const [otherKey, otherCard] of Object.entries(this.data.contacts)) {
        if (otherKey === chatId) continue;
        const otherSlot = normalizeSlotId(otherCard?.slotId || parseContactChannelKey(otherKey).slotId);
        if (otherSlot !== slotId) continue;
        if (!phonesMatch(otherCard.phone, candidatePhone)) continue;

        const preferNew = String(chatId).endsWith('@lid') && !String(otherKey).endsWith('@lid');
        const winnerKey = preferNew ? chatId : otherKey;
        const loserKey = preferNew ? otherKey : chatId;
        const winnerBase = this.data.contacts[winnerKey] || otherCard;
        const loserBase = this.data.contacts[loserKey];

        if (loserBase) {
          const mergedMap = deduplicateContactsMap({
            [winnerKey]: { ...winnerBase, slotId, chatId: winnerKey, phone: candidatePhone },
            [loserKey]: { ...loserBase, slotId, chatId: loserKey, phone: candidatePhone }
          });
          const mergedCard = Object.values(mergedMap)[0];
          delete this.data.contacts[loserKey];
          this.deletedContactIds.add(loserKey);
          this.dirtyContactIds.delete(loserKey);
          if (mergedCard) {
            targetKey = mergedCard.chatId;
            this.data.contacts[targetKey] = mergedCard;
          }
        } else if (!this.data.contacts[winnerKey] && preferNew) {
          delete this.data.contacts[otherKey];
          this.deletedContactIds.add(otherKey);
          this.dirtyContactIds.delete(otherKey);
          this.data.contacts[chatId] = { ...otherCard, slotId, chatId, phone: candidatePhone };
          targetKey = chatId;
        } else {
          targetKey = winnerKey;
        }
        break;
      }
    }

    const fallbackPhoneLabel = candidatePhone ? `+${candidatePhone}` : 'Contato WhatsApp';
    const existing = this.data.contacts[targetKey] || {
      slotId,
      chatId: targetKey,
      phone: candidatePhone || '',
      name: patch.name || fallbackPhoneLabel,
      avatarUrl: patch.avatarUrl || '',
      company: '',
      email: '',
      docNumber: '',
      city: '',
      leadSource: '',
      dealValue: 0,
      dealStatus: 'open',
      lostReason: '',
      aiIgnored: false,
      tasks: [],
      scheduledMessages: [],
      stage: 'novo',
      pausedUntil: null,
      pauseReason: '',
      summary: '',
      notes: '',
      tags: [],
      sentVoiceIds: [],
      internalNotesList: [],
      followUpAt: null,
      followUpNotifiedAt: null,
      unreadAlert: false,
      unreadCount: 0,
      archived: false,
      pinned: false,
      createdAt: patch.createdAt || trueNowIso(),
      lastMessageAt: patch.lastMessageAt || trueNowIso(),
      messages: []
    };

    const nextFollowUpAt = patch.followUpAt !== undefined ? (patch.followUpAt || null) : (existing.followUpAt || null);
    const followUpChanged = patch.followUpAt !== undefined && nextFollowUpAt !== (existing.followUpAt || null);
    const ownerSelfName = opts.ownerSelfName || '';

    const chosenName = (() => {
      if (patch.forceName && String(patch.name || '').trim()) {
        return String(patch.name).trim();
      }
      // Se o contato já foi salvo manualmente pelo dono, preserva o nome salvo!
      if (existing.savedContact && !this.isGenericContactName(existing.name, ownerSelfName)) {
        return existing.name;
      }
      if (patch.name && !this.isGenericContactName(patch.name, ownerSelfName)) {
        if (this.isGenericContactName(existing.name, ownerSelfName) || opts.preferAddressBookName) {
          return String(patch.name).trim();
        }
      } else if (this.isGenericContactName(existing.name, ownerSelfName) && candidatePhone) {
        return `+${candidatePhone}`;
      }
      return existing.name;
    })();

    // Protege lastMessageAt para nunca regredir caso chegue um evento antigo de histórico
    let chosenLastMessageAt = existing.lastMessageAt;
    if (patch.lastMessageAt) {
      const prevTs = new Date(existing.lastMessageAt || 0).getTime() || 0;
      const nextTs = new Date(patch.lastMessageAt).getTime() || 0;
      if (patch.forceLastMessageAt || (existing.messages?.length || 0) === 0 || nextTs >= prevTs) {
        chosenLastMessageAt = patch.lastMessageAt;
      }
    }

    const { forceName: _fn, forceLastMessageAt: _fl, ...cleanPatch } = patch;
    const nextSavedContact = patch.savedContact !== undefined
      ? Boolean(patch.savedContact)
      : (Boolean(existing.savedContact) || Boolean(patch.forceName));

    // Recriar ou salvar a ficha pode liberar o tombstone da conversa, mas não
    // pode liberar mensagens históricas anteriores à exclusão. Transfere a
    // barreira temporal para a ficha antes de remover o tombstone.
    const explicitSave = Boolean(patch.forceName || patch.savedContact);
    const deletionFloorMs = explicitSave
      ? Math.max(
          this.getDeletedChatTombstoneMs(targetKey, candidatePhone || existing.phone || ''),
          this.getDeletedChatTombstoneMs(chatId, candidatePhone || existing.phone || '')
        )
      : 0;
    const requestedHistoryClearedAt = patch.historyClearedAt !== undefined ? patch.historyClearedAt : (existing.historyClearedAt || null);
    const historyFloorMs = Math.max(new Date(requestedHistoryClearedAt || 0).getTime() || 0, deletionFloorMs ? deletionFloorMs + 2000 : 0);
    if (explicitSave) {
      this.clearDeletedChatTombstone(targetKey, candidatePhone || existing.phone || '');
    }

    const updated = {
      ...existing,
      ...cleanPatch,
      chatId: targetKey,
      savedContact: nextSavedContact,
      waBlocked: patch.waBlocked !== undefined ? Boolean(patch.waBlocked) : Boolean(existing.waBlocked),
      historyClearedAt: historyFloorMs ? new Date(historyFloorMs).toISOString() : requestedHistoryClearedAt,
      avatarUrl: patch.avatarUrl !== undefined ? String(patch.avatarUrl || '') : (existing.avatarUrl || ''),
      company: patch.company !== undefined ? String(patch.company || '').trim() : (existing.company || ''),
      email: patch.email !== undefined ? String(patch.email || '').trim() : (existing.email || ''),
      docNumber: patch.docNumber !== undefined ? String(patch.docNumber || '').trim() : (existing.docNumber || ''),
      city: patch.city !== undefined ? String(patch.city || '').trim() : (existing.city || ''),
      leadSource: patch.leadSource !== undefined ? String(patch.leadSource || '').trim() : (existing.leadSource || ''),
      dealValue: patch.dealValue !== undefined ? Math.max(0, Number(patch.dealValue) || 0) : Math.max(0, Number(existing.dealValue) || 0),
      dealStatus: patch.dealStatus !== undefined
        ? (['open', 'won', 'lost'].includes(patch.dealStatus) ? patch.dealStatus : 'open')
        : (existing.dealStatus || 'open'),
      lostReason: patch.lostReason !== undefined ? String(patch.lostReason || '').trim() : (existing.lostReason || ''),
      aiIgnored: patch.aiIgnored !== undefined ? Boolean(patch.aiIgnored) : Boolean(existing.aiIgnored),
      tasks: Array.isArray(patch.tasks) ? patch.tasks : (existing.tasks || []),
      scheduledMessages: Array.isArray(patch.scheduledMessages) ? patch.scheduledMessages : (existing.scheduledMessages || []),
      tags: Array.isArray(patch.tags) ? patch.tags : (existing.tags || []),
      sentVoiceIds: Array.isArray(patch.sentVoiceIds) ? patch.sentVoiceIds : (existing.sentVoiceIds || []),
      internalNotesList: Array.isArray(patch.internalNotesList)
        ? patch.internalNotesList
        : (existing.internalNotesList || []),
      unreadCount: patch.unreadCount !== undefined
        ? Math.max(0, Number(patch.unreadCount) || 0)
        : Math.max(0, Number(existing.unreadCount) || 0),
      archived: patch.archived !== undefined ? Boolean(patch.archived) : Boolean(existing.archived),
      pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : Boolean(existing.pinned),
      followUpAt: nextFollowUpAt,
      followUpNotifiedAt: followUpChanged
        ? null
        : (patch.followUpNotifiedAt !== undefined ? patch.followUpNotifiedAt : (existing.followUpNotifiedAt || null)),
      name: chosenName,
      phone: candidatePhone || existing.phone || '',
      lastMessageAt: chosenLastMessageAt
    };

    this.data.contacts[targetKey] = updated;
    this.deletedContactIds.delete(targetKey);
    this.dirtyContactIds.add(targetKey);
    if (!opts.deferSave) {
      this.saveSoon();
    }
    return updated;
  }

  recordDeletedChatTombstone(chatId = '', phone = '', floorMs = 0) {
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.settings.deletedChatTombstones || typeof this.data.settings.deletedChatTombstones !== 'object') {
      this.data.settings.deletedChatTombstones = {};
    }
    const { slotId, compositeKey } = parseContactChannelKey(chatId);
    const ts = new Date(Math.max(trueNowMs(), Number(floorMs) || 0)).toISOString();
    const map = this.data.settings.deletedChatTombstones;
    if (compositeKey) map[compositeKey] = ts;
    const digits = normalizePhoneDigits(phone || extractPhoneFromJidIfPn(compositeKey));
    if (digits && digits.length >= 8) {
      const telKey = slotId === 'slot_1' ? `tel:${digits}` : `${slotId}::tel:${digits}`;
      map[telKey] = ts;
    }
    // Não descartar exclusões antigas por contagem: isso permitiria que um
    // próximo lote de histórico recriasse conversas apagadas.
    this.workspaceDirty = true;
  }

  clearDeletedChatTombstone(chatId = '', phone = '') {
    const map = this.data.settings?.deletedChatTombstones;
    if (!map || typeof map !== 'object') return;
    const { slotId, compositeKey } = parseContactChannelKey(chatId);
    let changed = false;
    if (compositeKey && map[compositeKey]) {
      delete map[compositeKey];
      changed = true;
    }
    const digits = normalizePhoneDigits(phone || extractPhoneFromJidIfPn(compositeKey));
    const telKey = slotId === 'slot_1' ? `tel:${digits}` : `${slotId}::tel:${digits}`;
    if (digits && map[telKey]) {
      delete map[telKey];
      changed = true;
    }
    if (changed) this.workspaceDirty = true;
  }

  getDeletedChatTombstoneMs(chatId = '', phone = '') {
    const map = this.data.settings?.deletedChatTombstones;
    if (!map || typeof map !== 'object') return 0;
    const { slotId, compositeKey } = parseContactChannelKey(chatId);
    const t1 = compositeKey && map[compositeKey] ? new Date(map[compositeKey]).getTime() || 0 : 0;
    const digits = normalizePhoneDigits(phone || extractPhoneFromJidIfPn(compositeKey));
    const telKey = slotId === 'slot_1' ? `tel:${digits}` : `${slotId}::tel:${digits}`;
    const t2 = digits && map[telKey] ? new Date(map[telKey]).getTime() || 0 : 0;
    return Math.max(t1, t2);
  }

  clearContactMessages(chatId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    const lastExistingMs = Array.isArray(existing.messages) && existing.messages.length
      ? Math.max(0, ...existing.messages.map((m) => new Date(m?.timestamp || 0).getTime() || 0))
      : 0;
    const nowIso = new Date(Math.max(trueNowMs(), lastExistingMs + 1)).toISOString();
    existing.messages = [];
    existing.unreadCount = 0;
    existing.unreadAlert = false;
    existing.historyClearedAt = nowIso;
    existing.savedContact = true;
    this.dirtyContactIds.add(key);
    this.deletedContactIds.delete(key);
    this.writeNow();
    return existing;
  }

  deleteContact(chatId, opts = {}) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return false;
    const lastExistingMs = Array.isArray(existing.messages) && existing.messages.length
      ? Math.max(0, ...existing.messages.map((m) => new Date(m?.timestamp || 0).getTime() || 0))
      : (new Date(existing.lastMessageAt || 0).getTime() || 0);
    if (opts.recordTombstone !== false) {
      this.recordDeletedChatTombstone(key, existing.phone || '', lastExistingMs + 1);
      if (chatId && chatId !== key) this.recordDeletedChatTombstone(chatId, existing.phone || '', lastExistingMs + 1);
    }
    delete this.data.contacts[key];
    this.dirtyContactIds.delete(key);
    this.deletedContactIds.add(key);
    this.writeNow();
    return true;
  }

  markContactRead(chatId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    if ((Number(existing.unreadCount) || 0) === 0 && !existing.unreadAlert) {
      return existing;
    }
    return this.upsertContact(key, {
      unreadCount: 0,
      unreadAlert: false
    });
  }

  markContactUnread(chatId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    return this.upsertContact(key, {
      unreadCount: Math.max(1, Number(existing.unreadCount) || 0),
      archived: false
    });
  }

  findMessageInContact(chatId, msgIdOrWaId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const contact = this.data.contacts[key];
    if (!contact || !Array.isArray(contact.messages)) return { contact: null, msg: null };
    const msg = contact.messages.find(
      (m) => (m.id && m.id === msgIdOrWaId) || (m.waMsgId && m.waMsgId === msgIdOrWaId)
    );
    return { contact, msg: msg || null };
  }

  applyMessageReaction(chatId, msgIdOrWaId, emoji = '', actor = 'owner') {
    const { contact, msg } = this.findMessageInContact(chatId, msgIdOrWaId);
    if (!contact || !msg) return null;
    const cleanEmoji = String(emoji || '').trim();
    const reactions = typeof msg.reactions === 'object' && msg.reactions && !Array.isArray(msg.reactions)
      ? { ...msg.reactions }
      : {};
    if (!cleanEmoji || reactions[actor] === cleanEmoji) {
      delete reactions[actor];
    } else {
      reactions[actor] = cleanEmoji;
    }
    msg.reactions = reactions;
    this.dirtyContactIds.add(contact.chatId);
    this.saveSoon();
    return contact;
  }

  applyMessageEdit(chatId, msgIdOrWaId, newText = '') {
    const { contact, msg } = this.findMessageInContact(chatId, msgIdOrWaId);
    if (!contact || !msg) return null;
    const clean = String(newText || '').trim();
    if (!clean) return contact;
    msg.text = clean;
    msg.editedAt = new Date().toISOString();
    this.dirtyContactIds.add(contact.chatId);
    this.saveSoon();
    return contact;
  }

  applyMessageDelete(chatId, msgIdOrWaId) {
    const { contact, msg } = this.findMessageInContact(chatId, msgIdOrWaId);
    if (!contact || !msg) return null;
    msg.deletedForEveryone = true;
    msg.deletedAt = new Date().toISOString();
    msg.text = '🚫 Mensagem apagada';
    delete msg.mediaUrl;
    this.dirtyContactIds.add(contact.chatId);
    this.saveSoon();
    return contact;
  }

  applyMessageAck(chatId, waMsgId, ackLevel = 1) {
    const { contact, msg } = this.findMessageInContact(chatId, waMsgId);
    if (!contact || !msg) return null;
    const nextAck = Math.max(Number(msg.ack) || 0, Number(ackLevel) || 0);
    if (nextAck === (Number(msg.ack) || 0)) return contact;
    msg.ack = nextAck;
    this.dirtyContactIds.add(contact.chatId);
    this.saveSoon();
    return contact;
  }

  addContactTask(chatId, text = '') {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.upsertContact(key, {}, { deferSave: true });
    const nextTasks = [
      ...(existing.tasks || []),
      { id: uid('task'), text: clean.slice(0, 180), done: false, createdAt: new Date().toISOString() }
    ].slice(-50);
    return this.upsertContact(key, { tasks: nextTasks });
  }

  toggleContactTask(chatId, taskId, done) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    const nextTasks = (existing.tasks || []).map((t) =>
      t.id === taskId ? { ...t, done: done !== undefined ? Boolean(done) : !t.done } : t
    );
    return this.upsertContact(key, { tasks: nextTasks });
  }

  deleteContactTask(chatId, taskId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    const nextTasks = (existing.tasks || []).filter((t) => t.id !== taskId);
    return this.upsertContact(key, { tasks: nextTasks });
  }

  addScheduledMessage(chatId, { text = '', sendAt = '' } = {}) {
    const cleanText = String(text || '').trim();
    const dt = new Date(sendAt);
    if (!cleanText || Number.isNaN(dt.getTime())) return null;
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.upsertContact(key, {}, { deferSave: true });
    const entry = {
      id: uid('sched'),
      text: cleanText,
      sendAt: dt.toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    const nextSched = [...(existing.scheduledMessages || []), entry]
      .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime())
      .slice(-40);
    return this.upsertContact(key, { scheduledMessages: nextSched });
  }

  cancelScheduledMessage(chatId, schedId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    const nextSched = (existing.scheduledMessages || []).filter((s) => s.id !== schedId);
    return this.upsertContact(key, { scheduledMessages: nextSched });
  }

  markScheduledMessageResult(chatId, schedId, { status = 'sent', error = '' } = {}) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    const nextSched = (existing.scheduledMessages || []).map((s) =>
      s.id === schedId
        ? { ...s, status, sentAt: new Date().toISOString(), error: error || '' }
        : s
    );
    return this.upsertContact(key, { scheduledMessages: nextSched });
  }

  addInternalNote(chatId, { text = '', author = 'Equipe' } = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return null;
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.upsertContact(key, {});
    const noteId = uid('inote');
    const lastNoteBaseMs = Array.isArray(existing.messages) && existing.messages.length
      ? Math.max(0, ...existing.messages.map((m) => new Date(m?.timestamp || 0).getTime() || 0))
      : 0;
    const clearedNoteMs = existing.historyClearedAt ? (new Date(existing.historyClearedAt).getTime() || 0) : 0;
    const createdAt = new Date(Math.max(trueNowMs(), clearedNoteMs + 1000, lastNoteBaseMs + 10)).toISOString();
    const noteEntry = {
      id: noteId,
      text: cleanText,
      author: String(author || 'Equipe').trim(),
      createdAt
    };
    const nextNotes = [...(existing.internalNotesList || []), noteEntry].slice(-50);
    existing.internalNotesList = nextNotes;
    existing.messages.push({
      id: noteId,
      role: 'internal_note',
      author: noteEntry.author,
      text: cleanText,
      timestamp: createdAt
    });
    if (existing.messages.length > 120) {
      existing.messages = existing.messages.slice(-120);
    }
    this.dirtyContactIds.add(existing.chatId);
    this.saveSoon();
    return existing;
  }

  deleteInternalNote(chatId, noteId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    const existing = this.data.contacts[key];
    if (!existing) return null;
    existing.internalNotesList = (existing.internalNotesList || []).filter((n) => n.id !== noteId);
    existing.messages = (existing.messages || []).filter((m) => m.id !== noteId);
    this.dirtyContactIds.add(existing.chatId);
    this.saveSoon();
    return existing;
  }

  appendContactMessage(chatId, msgObj, opts = {}) {
    const candidatePhone = msgObj?.phone || extractPhoneFromJidIfPn(chatId);
    const prevKey = this.findSiblingContactKey(chatId, candidatePhone) || chatId;
    const prev = this.data.contacts[prevKey];
    const isHistorical = Boolean(opts.historical || msgObj?.historical);
    const isIncomingUser = msgObj?.role === 'user' && !msgObj?.skipUnread && !isHistorical;
    const isManualOwner = msgObj?.role === 'owner' && !isHistorical;

    const rawCandidateMs =
      msgObj?.timestamp && !Number.isNaN(new Date(msgObj.timestamp).getTime())
        ? new Date(msgObj.timestamp).getTime()
        : trueNowMs();

    // Proteção Causal Anti-Clock-Skew (ex.: Dual-Boot Windows + Linux/antiX com BIOS em UTC-3):
    // Toda mensagem AO VIVO (!isHistorical) nunca pode nascer antes de historyClearedAt nem antes da última mensagem da conversa!
    const clearedFloorMs = !isHistorical && prev?.historyClearedAt
      ? (new Date(prev.historyClearedAt).getTime() || 0) + 1000
      : 0;
    const lastExistingFloorMs = !isHistorical && Array.isArray(prev?.messages) && prev.messages.length > 0
      ? Math.max(0, ...prev.messages.map((m) => new Date(m?.timestamp || 0).getTime() || 0)) + 10
      : 0;
    const effectiveMsgMs = isHistorical
      ? rawCandidateMs
      : Math.max(rawCandidateMs, trueNowMs(), clearedFloorMs, lastExistingFloorMs);
    const msgIso = new Date(effectiveMsgMs).toISOString();

    // Checa duplicidade ANTES de incrementar contador de não-lidas!
    if (prev && Array.isArray(prev.messages) && prev.messages.length > 0) {
      if (msgObj?.waMsgId) {
        const dupById = prev.messages.find((m) => m.waMsgId && m.waMsgId === msgObj.waMsgId);
        if (dupById) {
          if (msgObj.mediaUrl && !dupById.mediaUrl) {
            dupById.mediaUrl = msgObj.mediaUrl;
            dupById.mediaName = msgObj.mediaName || dupById.mediaName;
            dupById.mediaMime = msgObj.mediaMime || dupById.mediaMime;
            dupById.mediaSize = msgObj.mediaSize || dupById.mediaSize;
            this.dirtyContactIds.add(prev.chatId);
            if (!opts.deferSave) this.saveSoon();
          }
          return prev;
        }
      } else {
        const msgMs = new Date(msgIso).getTime();
        const dupFuzzy = prev.messages.some(
          (m) =>
            m.role === msgObj?.role &&
            m.text === msgObj?.text &&
            Math.abs(new Date(m.timestamp || 0).getTime() - msgMs) < 3500
        );
        if (dupFuzzy) return prev;
      }
    }

    const nextPatch = {
      lastMessageAt: msgIso
    };
    if (candidatePhone) nextPatch.phone = candidatePhone;
    if (msgObj?.contactName) nextPatch.name = msgObj.contactName;
    if (isIncomingUser) {
      nextPatch.unreadCount = Math.max(0, Number(prev?.unreadCount) || 0) + 1;
      nextPatch.archived = false;
    } else if (isManualOwner) {
      nextPatch.unreadCount = 0;
    }

    const contact = this.upsertContact(chatId, nextPatch, {
      deferSave: true,
      ownerSelfName: opts.ownerSelfName || ''
    });

    const { skipUnread: _su, historical: _hi, phone: _ph, contactName: _cn, ...cleanMsg } = msgObj || {};
    contact.messages.push({
      id: uid('msg'),
      ...cleanMsg,
      timestamp: msgIso
    });

    // Mantém ordem estritamente cronológica caso mensagens de histórico entrem fora de ordem
    if (contact.messages.length > 1) {
      const n = contact.messages.length;
      const prevTs = new Date(contact.messages[n - 2]?.timestamp || 0).getTime();
      const curTs = new Date(msgIso).getTime();
      if (curTs < prevTs) {
        contact.messages.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
      }
    }

    if (contact.messages.length > 120) {
      contact.messages = contact.messages.slice(-120);
    }

    // Recalcula lastMessageAt com base na mensagem real mais recente da conversa
    const realMsgs = contact.messages.filter((m) => m.role !== 'internal_note');
    if (realMsgs.length > 0) {
      const latestMsgIso = realMsgs[realMsgs.length - 1].timestamp;
      if (latestMsgIso && new Date(latestMsgIso).getTime() > new Date(contact.lastMessageAt || 0).getTime()) {
        contact.lastMessageAt = latestMsgIso;
      }
    }

    this.dirtyContactIds.add(contact.chatId);
    if (!opts.deferSave) {
      this.saveSoon();
    }
    return contact;
  }

  isContactPaused(chatId, phone = '') {
    const key = this.findSiblingContactKey(chatId, phone) || chatId;
    const contact = this.data.contacts[key];
    if (!contact || !contact.pausedUntil) return false;
    if (contact.pausedUntil === 'forever') return true;
    const untilMs = new Date(contact.pausedUntil).getTime();
    if (Number.isNaN(untilMs)) return false;
    if (trueNowMs() < untilMs) return true;
    contact.pausedUntil = null;
    contact.pauseReason = '';
    this.saveSoon();
    return false;
  }

  pauseContact(chatId, minutes = 60, reason = 'Pausado manualmente', phone = '') {
    const key = this.findSiblingContactKey(chatId, phone) || chatId;
    const pausedUntil = minutes === 'forever'
      ? 'forever'
      : new Date(trueNowMs() + Number(minutes) * 60 * 1000).toISOString();
    return this.upsertContact(key, {
      pausedUntil,
      pauseReason: reason
    });
  }

  resumeContact(chatId, phone = '') {
    const key = this.findSiblingContactKey(chatId, phone) || chatId;
    return this.upsertContact(key, {
      pausedUntil: null,
      pauseReason: '',
      unreadAlert: false,
      stage: this.data.contacts[key]?.stage === 'aguardando_humano'
        ? 'em_atendimento'
        : (this.data.contacts[key]?.stage || 'em_atendimento')
    });
  }

  exportFullSystemSnapshot() {
    const biz = this.getBusiness();
    const embeddedVoiceFiles = {};
    for (const v of (biz.voiceLibrary || [])) {
      if (!v?.filename) continue;
      const scopedFp = v.url && /^https?:\/\//i.test(v.url)
        ? tenantCloudMediaCachePath(v.filename, this.userId)
        : null;
      // Preserva backups de arquivos legados enquanto dá preferência ao cache
      // que foi baixado para esta conta.
      const fp = scopedFp && fs.existsSync(scopedFp) ? scopedFp : path.join(UPLOADS_DIR, v.filename);
      if (fs.existsSync(fp)) {
        try {
          const st = fs.statSync(fp);
          if (st.size <= 8 * 1024 * 1024) {
            embeddedVoiceFiles[v.filename] = fs.readFileSync(fp).toString('base64');
          }
        } catch {}
      }
    }
    return {
      zapiaBackupVersion: '2.2',
      exportedAt: new Date().toISOString(),
      settings: this.data.settings,
      business: biz,
      contacts: this.data.contacts,
      stats: this.data.stats,
      embeddedVoiceFiles
    };
  }

  importFullSystemSnapshot(parsed = {}) {
    if (!parsed || typeof parsed !== 'object' || (!parsed.business && !parsed.contacts && !parsed.settings)) {
      throw new Error('Arquivo JSON inválido: não parece ser um backup do Ienvia.');
    }
    if (parsed.embeddedVoiceFiles && typeof parsed.embeddedVoiceFiles === 'object') {
      const SAFE_VOICE_EXT = /\.(ogg|opus|mp3|m4a|wav|webm|aac)$/i;
      let totalVoiceBytes = 0;
      for (const [fn, b64] of Object.entries(parsed.embeddedVoiceFiles)) {
        const safeFn = path.basename(String(fn || ''));
        if (!safeFn || !SAFE_VOICE_EXT.test(safeFn) || typeof b64 !== 'string') continue;
        try {
          const buf = Buffer.from(b64, 'base64');
          totalVoiceBytes += buf.length;
          if (totalVoiceBytes > 35 * 1024 * 1024) break;
          fs.writeFileSync(path.join(UPLOADS_DIR, safeFn), buf);
        } catch {}
      }
    }
    const defaults = createDefaultDatabase();
    const curAi = this.data.settings?.ai || {};
    const incAi = parsed.settings?.ai || {};

    // Se o backup vier com chaves vazias, preserva as chaves já ativas no aparelho atual
    const mergedAi = {
      ...defaults.settings.ai,
      ...curAi,
      ...incAi,
      geminiApiKey: incAi.geminiApiKey || curAi.geminiApiKey || '',
      geminiKeyPool: incAi.geminiKeyPool || curAi.geminiKeyPool || '',
      openaiApiKey: incAi.openaiApiKey || curAi.openaiApiKey || '',
      groqApiKey: incAi.groqApiKey || curAi.groqApiKey || '',
      openrouterApiKey: incAi.openrouterApiKey || curAi.openrouterApiKey || ''
    };

    const nextSettings = {
      ...defaults.settings,
      ...this.data.settings,
      ...(parsed.settings || {}),
      branding: { ...defaults.settings.branding, ...(this.data.settings?.branding || {}), ...(parsed.settings?.branding || {}) },
      ai: mergedAi,
      antiBan: { ...defaults.settings.antiBan, ...(this.data.settings?.antiBan || {}), ...(parsed.settings?.antiBan || {}) },
      humanHandoff: {
        ...defaults.settings.humanHandoff,
        ...(this.data.settings?.humanHandoff || {}),
        ...(parsed.settings?.humanHandoff || {}),
        ownerPersonalWhatsapp: parsed.settings?.humanHandoff?.ownerPersonalWhatsapp || this.data.settings?.humanHandoff?.ownerPersonalWhatsapp || ''
      },
      schedule: { ...defaults.settings.schedule, ...(this.data.settings?.schedule || {}), ...(parsed.settings?.schedule || {}) }
    };
    delete nextSettings.activeProfileId;

    const rawContacts = Array.isArray(parsed.contacts)
      ? Object.fromEntries(parsed.contacts.filter(c => c?.chatId).map(c => [c.chatId, c]))
      : (parsed.contacts || this.data.contacts || {});

    this.data.settings = nextSettings;
    if (parsed.business) {
      this.data.business = normalizeBusinessObject(parsed.business, this.getBusiness());
    }
    this.data.contacts = deduplicateContactsMap(rawContacts);
    for (const cid of Object.keys(this.data.contacts)) {
      this.dirtyContactIds.add(cid);
    }
    if (parsed.stats) {
      this.data.stats = { ...defaults.stats, ...this.data.stats, ...parsed.stats };
    }
    this.writeNow();
    return {
      contactsCount: Object.keys(this.data.contacts).length,
      businessName: this.data.business.name
    };
  }
}

export function buildContactVCard(contact = {}) {
  const esc = (v = '') => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').trim();
  const fullName = String(contact.name || contact.phone || 'Contato WhatsApp').trim();
  const digits = normalizePhoneDigits(contact.phone || extractPhoneFromJidIfPn(contact.chatId || ''));
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(fullName)}`,
    `N:${esc(fullName)};;;;`
  ];
  if (digits) {
    lines.push(`TEL;TYPE=CELL;waid=${digits}:+${digits}`);
  }
  if (contact.company) lines.push(`ORG:${esc(contact.company)}`);
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(contact.email)}`);
  if (contact.city) lines.push(`ADR;TYPE=WORK:;;;${esc(contact.city)};;;Brasil`);
  const noteParts = [
    contact.leadSource ? `Origem: ${contact.leadSource}` : '',
    contact.docNumber ? `Doc: ${contact.docNumber}` : '',
    contact.notes ? String(contact.notes).trim() : ''
  ].filter(Boolean);
  if (noteParts.length) lines.push(`NOTE:${esc(noteParts.join(' | '))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function mergeContactMessagesUnion(authoritativeMsgs = [], rescueMsgs = [], historyClearedAt = null) {
  const clearedMs = historyClearedAt ? new Date(historyClearedAt).getTime() || 0 : 0;
  const keepAfterClear = (m) => {
    if (!clearedMs) return true;
    const ts = new Date(m?.timestamp || 0).getTime() || 0;
    return ts > clearedMs;
  };
  const authArr = (Array.isArray(authoritativeMsgs) ? authoritativeMsgs.filter(Boolean) : []).filter(keepAfterClear);
  const rescArr = (Array.isArray(rescueMsgs) ? rescueMsgs.filter(Boolean) : []).filter(keepAfterClear);
  if (rescArr.length === 0) return authArr.slice(-120);

  const merged = authArr.map((m) => ({ ...m }));
  const byWaId = new Map();
  const byId = new Map();
  const bySig = new Map();

  const buildSig = (m) => {
    const tsSec = Math.round((new Date(m.timestamp || 0).getTime() || 0) / 2500);
    return `${m.role || ''}|${String(m.text || '').trim()}|${tsSec}`;
  };

  for (const m of merged) {
    if (m.waMsgId) byWaId.set(m.waMsgId, m);
    if (m.id) byId.set(m.id, m);
    bySig.set(buildSig(m), m);
  }

  let added = 0;
  for (const r of rescArr) {
    // Notas internas respeitam exclusões feitas pelo painel; todas as mensagens reais (user/assistant/owner) nunca são perdidas!
    if (r.role === 'internal_note') continue;

    const existing =
      (r.waMsgId && byWaId.get(r.waMsgId)) ||
      (r.id && byId.get(r.id)) ||
      bySig.get(buildSig(r));

    if (existing) {
      if (r.waMsgId && !existing.waMsgId) existing.waMsgId = r.waMsgId;
      if (r.waMsgKey && !existing.waMsgKey) existing.waMsgKey = r.waMsgKey;
      if (r.quoted && !existing.quoted) existing.quoted = r.quoted;
      if (r.ack && (!existing.ack || Number(r.ack) > Number(existing.ack))) existing.ack = Number(r.ack);
      if (r.reactions && typeof r.reactions === 'object') {
        existing.reactions = { ...(r.reactions || {}), ...(existing.reactions || {}) };
      }
      if (r.deletedForEveryone && !existing.deletedForEveryone) {
        existing.deletedForEveryone = true;
        existing.deletedAt = r.deletedAt || new Date().toISOString();
        existing.text = '🚫 Mensagem apagada';
        delete existing.mediaUrl;
      } else if (
        r.editedAt &&
        (!existing.editedAt || new Date(r.editedAt).getTime() > new Date(existing.editedAt).getTime()) &&
        !existing.deletedForEveryone
      ) {
        existing.text = r.text;
        existing.editedAt = r.editedAt;
      }
      if (
        !existing.deletedForEveryone &&
        r.mediaUrl &&
        /^https?:\/\//i.test(r.mediaUrl) &&
        (!existing.mediaUrl || existing.mediaUrl.startsWith('/uploads/'))
      ) {
        existing.mediaUrl = r.mediaUrl;
      }
      continue;
    }

    const clone = { ...r };
    merged.push(clone);
    if (clone.waMsgId) byWaId.set(clone.waMsgId, clone);
    if (clone.id) byId.set(clone.id, clone);
    bySig.set(buildSig(clone), clone);
    added += 1;
  }

  if (added > 0) {
    merged.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.timestamp || 0).getTime() || 0;
      return ta - tb;
    });
  }

  return merged.slice(-120);
}

export const localStorageInstance = new Storage();

export const storage = new Proxy(localStorageInstance, {
  get(target, prop) {
    const active = tenantStorageContext.getStore() || target;
    const val = active[prop];
    return typeof val === 'function' ? val.bind(active) : val;
  },
  set(target, prop, value) {
    const active = tenantStorageContext.getStore() || target;
    active[prop] = value;
    return true;
  }
});


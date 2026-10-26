import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'url';
import { NICHE_TEMPLATES } from './templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const IS_VERCEL_RUNTIME = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const BUNDLED_DATA_DIR = path.join(ROOT_DIR, 'data');
export const DATA_DIR = IS_VERCEL_RUNTIME ? '/tmp/zapia_data' : BUNDLED_DATA_DIR;
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const AUTH_DIR = path.join(DATA_DIR, 'wa_auth');
const DB_FILE = path.join(DATA_DIR, 'database.json');

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

export function normalizePhoneDigits(raw = '') {
  return String(raw).replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
}

/**
 * Compara dois números de telefone brasileiros tolerando presença/ausência do DDI 55 e 9º dígito móvel.
 * Ignora identificadores puros de @lid (>= 14 dígitos que não começam com 55+DDD válido).
 */
export function isLikelyRealPhone(digits = '') {
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

export function createBusinessFromTemplate(tpl = NICHE_TEMPLATES[0]) {
  const p = tpl.profile;
  return {
    id: 'business_unico',
    name: p.name,
    niche: p.niche,
    icon: tpl.icon || '🚗',
    assistantName: p.assistantName || 'Assistente',
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
    updatedAt: new Date().toISOString()
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
    catalog: Array.isArray(raw.catalog) ? raw.catalog.map(normalizeCatalogItem) : fallback.catalog,
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

/**
 * Unifica contatos duplicados quando uma conversa ativa começa em @s.whatsapp.net e a resposta
 * entra via @lid (padrão WhatsApp Baileys v7), preservando histórico, tags, pausas e notas em 1 único card.
 */
function deduplicateContactsMap(rawContacts = {}) {
  const entries = Object.entries(rawContacts || {}).map(([k, c]) => ({
    tags: [],
    sentVoiceIds: [],
    followUpAt: null,
    ...c,
    chatId: c?.chatId || k
  }));

  const mergedByKey = [];
  for (const item of entries) {
    const existingIdx = mergedByKey.findIndex(other =>
      other.chatId === item.chatId ||
      (isLikelyRealPhone(other.phone) && isLikelyRealPhone(item.phone) && phonesMatch(other.phone, item.phone))
    );

    if (existingIdx === -1) {
      mergedByKey.push(item);
      continue;
    }

    const prev = mergedByKey[existingIdx];
    // Prefere o JID @lid quando ambos existem para o mesmo número real, pois o WhatsApp entrega respostas nele
    const preferItemJid = item.chatId.endsWith('@lid') && !prev.chatId.endsWith('@lid');
    const canonicalJid = preferItemJid ? item.chatId : prev.chatId;

    // Mescla mensagens ordenadas por horário sem duplicar texto+role próximos
    const combinedMsgs = [...(prev.messages || []), ...(item.messages || [])]
      .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    const dedupedMsgs = [];
    for (const m of combinedMsgs) {
      const dup = dedupedMsgs.some(
        dm => dm.role === m.role && dm.text === m.text &&
          Math.abs(new Date(dm.timestamp || 0).getTime() - new Date(m.timestamp || 0).getTime()) < 5000
      );
      if (!dup) dedupedMsgs.push(m);
    }

    const stageRank = { novo: 0, em_atendimento: 1, concluido: 2, aguardando_humano: 3 };
    const bestStage = (stageRank[item.stage] || 0) >= (stageRank[prev.stage] || 0) ? item.stage : prev.stage;
    const mergedTags = Array.from(new Set([...(prev.tags || []), ...(item.tags || [])]));
    const mergedSentVoiceIds = Array.from(new Set([...(prev.sentVoiceIds || []), ...(item.sentVoiceIds || [])]));
    const bestPausedUntil = prev.pausedUntil === 'forever' || item.pausedUntil === 'forever'
      ? 'forever'
      : (item.pausedUntil || prev.pausedUntil || null);

    // Prefere nome real recebido via pushName ao invés de rótulo genérico de teste
    const pickName = (n) => n && !/^Cliente\b/i.test(n) && !/Teste Lojista/i.test(n);
    const bestName = pickName(item.name) ? item.name : (pickName(prev.name) ? prev.name : (item.name || prev.name));

    mergedByKey[existingIdx] = {
      ...prev,
      ...item,
      chatId: canonicalJid,
      phone: isLikelyRealPhone(item.phone) ? item.phone : prev.phone,
      name: bestName,
      stage: bestStage,
      tags: mergedTags,
      sentVoiceIds: mergedSentVoiceIds,
      followUpAt: item.followUpAt || prev.followUpAt || null,
      pausedUntil: bestPausedUntil,
      pauseReason: item.pauseReason || prev.pauseReason || '',
      summary: item.summary || prev.summary || '',
      notes: [prev.notes, item.notes].filter(Boolean).join('\n').trim(),
      unreadAlert: Boolean(prev.unreadAlert || item.unreadAlert),
      messages: dedupedMsgs.slice(-80),
      lastMessageAt:
        new Date(item.lastMessageAt || 0).getTime() >= new Date(prev.lastMessageAt || 0).getTime()
          ? item.lastMessageAt
          : prev.lastMessageAt
    };
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
        appName: 'ZAP-IA Studio',
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
      ignoredContacts: []
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
    updatedAt: new Date().toISOString()
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
      schedule: { ...defaults.settings.schedule, ...(parsed.settings?.schedule || {}) }
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
          schedule: { ...defaults.settings.schedule, ...(parsed.settings?.schedule || {}) }
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
      timestamp: new Date().toISOString()
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
      updatedAt: new Date().toISOString()
    };
    this.writeNow();
    return this.data.business;
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
      createdAt: prev.createdAt || rawItem.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
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
    if (this.data.contacts[chatId]) return chatId;
    const checkPhone = phone || normalizePhoneDigits(chatId);
    if (!isLikelyRealPhone(checkPhone)) return null;
    for (const [existingJid, c] of Object.entries(this.data.contacts)) {
      if (phonesMatch(c.phone, checkPhone)) {
        return existingJid;
      }
    }
    return null;
  }

  upsertContact(chatId, patch = {}) {
    const candidatePhone = patch.phone || this.data.contacts[chatId]?.phone || normalizePhoneDigits(chatId);
    let targetKey = chatId;

    // Se já existia um card do mesmo telefone em outro formato (@s.whatsapp.net <-> @lid), unifica em 1 único card!
    const siblingKey = this.findSiblingContactKey(chatId, candidatePhone);
    if (siblingKey && siblingKey !== chatId) {
      const sibling = this.data.contacts[siblingKey];
      // Se o novo evento veio por @lid, migra a chave canônica para o @lid (onde o WhatsApp responde)
      if (chatId.endsWith('@lid') && !siblingKey.endsWith('@lid')) {
        delete this.data.contacts[siblingKey];
        this.deletedContactIds.add(siblingKey);
        this.dirtyContactIds.delete(siblingKey);
        this.data.contacts[chatId] = { ...sibling, chatId };
        targetKey = chatId;
      } else {
        targetKey = siblingKey;
      }
    }

    const existing = this.data.contacts[targetKey] || {
      chatId: targetKey,
      phone: isLikelyRealPhone(candidatePhone) ? candidatePhone : normalizePhoneDigits(targetKey),
      name: patch.name || 'Cliente',
      stage: 'novo',
      pausedUntil: null,
      pauseReason: '',
      summary: '',
      notes: '',
      tags: [],
      sentVoiceIds: [],
      followUpAt: null,
      followUpNotifiedAt: null,
      unreadAlert: false,
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      messages: []
    };

    const nextFollowUpAt = patch.followUpAt !== undefined ? (patch.followUpAt || null) : (existing.followUpAt || null);
    const followUpChanged = patch.followUpAt !== undefined && nextFollowUpAt !== (existing.followUpAt || null);

    const updated = {
      ...existing,
      ...patch,
      chatId: targetKey,
      tags: Array.isArray(patch.tags) ? patch.tags : (existing.tags || []),
      sentVoiceIds: Array.isArray(patch.sentVoiceIds) ? patch.sentVoiceIds : (existing.sentVoiceIds || []),
      followUpAt: nextFollowUpAt,
      followUpNotifiedAt: followUpChanged
        ? null
        : (patch.followUpNotifiedAt !== undefined ? patch.followUpNotifiedAt : (existing.followUpNotifiedAt || null)),
      name: patch.name && patch.name !== 'Cliente' && !/^Cliente \d+$/i.test(patch.name) ? patch.name : existing.name,
      phone: isLikelyRealPhone(patch.phone) ? patch.phone : (existing.phone || normalizePhoneDigits(targetKey))
    };

    this.data.contacts[targetKey] = updated;
    this.deletedContactIds.delete(targetKey);
    this.dirtyContactIds.add(targetKey);
    this.saveSoon();
    return updated;
  }

  deleteContact(chatId) {
    const key = this.findSiblingContactKey(chatId) || chatId;
    if (!this.data.contacts[key]) return false;
    delete this.data.contacts[key];
    this.dirtyContactIds.delete(key);
    this.deletedContactIds.add(key);
    this.writeNow();
    return true;
  }

  appendContactMessage(chatId, msgObj) {
    const contact = this.upsertContact(chatId, {
      lastMessageAt: new Date().toISOString()
    });
    contact.messages.push({
      id: uid('msg'),
      timestamp: new Date().toISOString(),
      ...msgObj
    });
    if (contact.messages.length > 80) {
      contact.messages = contact.messages.slice(-80);
    }
    this.dirtyContactIds.add(contact.chatId);
    this.saveSoon();
    return contact;
  }

  isContactPaused(chatId, phone = '') {
    const key = this.findSiblingContactKey(chatId, phone) || chatId;
    const contact = this.data.contacts[key];
    if (!contact || !contact.pausedUntil) return false;
    if (contact.pausedUntil === 'forever') return true;
    const untilMs = new Date(contact.pausedUntil).getTime();
    if (Number.isNaN(untilMs)) return false;
    if (Date.now() < untilMs) return true;
    contact.pausedUntil = null;
    contact.pauseReason = '';
    this.saveSoon();
    return false;
  }

  pauseContact(chatId, minutes = 60, reason = 'Pausado manualmente', phone = '') {
    const key = this.findSiblingContactKey(chatId, phone) || chatId;
    const pausedUntil = minutes === 'forever'
      ? 'forever'
      : new Date(Date.now() + Number(minutes) * 60 * 1000).toISOString();
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
      const fp = path.join(UPLOADS_DIR, v.filename);
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
      throw new Error('Arquivo JSON inválido: não parece ser um backup do ZAP-IA Studio.');
    }
    if (parsed.embeddedVoiceFiles && typeof parsed.embeddedVoiceFiles === 'object') {
      for (const [fn, b64] of Object.entries(parsed.embeddedVoiceFiles)) {
        const safeFn = path.basename(String(fn || ''));
        if (!safeFn || typeof b64 !== 'string') continue;
        try {
          fs.writeFileSync(path.join(UPLOADS_DIR, safeFn), Buffer.from(b64, 'base64'));
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


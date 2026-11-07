import {createOverviewParityRouter} from './dashboard/parity.js';
import {createAccountsRouter} from './accounts/router.js';
import {createAccountsFileRepository} from './accounts/repository.js';
import {createSecuritySettingsRouter} from './security-settings/router.js';
import {createSecuritySettingsFileRepository} from './security-settings/repository.js';
import {createAiSettingsRouter} from './ai-settings/router.js';
import {createAiSettingsFileRepository} from './ai-settings/repository.js';
import {createSimulatorRouter} from './simulator/router.js';
import {createSimulatorFileRepository} from './simulator/repository.js';
import {createResourceRouter} from './resources/router.js';
import {createResourceFileRepository} from './resources/repository.js';
import {createTrainingRouter} from './training/router.js';
import {createTrainingFileRepository} from './training/repository.js';
import {createWorkspaceDraftCloudRepository} from './workspaceDrafts/cloudRepository.js';
import {createDraftSecrets} from './draftSecrets.js';
import {createCampaignRunner} from './campaigns/runner.js';
import {createAccountPlan} from '../public/v2/assets/accounts-domain.js';
import {previewTrainingRuntime} from './training/runtimePreview.js';
import {previewTrainingImport} from './training/importPreview.js';
import { composeConnectionState } from './dashboard/connections.js';
import { createDashboardRouter } from './dashboard/router.js';
import { createConnectionsRouter } from './connections/router.js';
import {createChannelsRouter} from './channels/router.js';
import {createConversationsV3Router} from './crm/conversationsV3.js';
import {createConversationsCommandsRouter} from './crm/conversationsCommands.js';
import {createCampaignRouter} from './campaigns/router.js';
import {createCrmRouter} from './crm/router.js';
import {validateLegacyApiReferences} from './channels/legacyIdentity.js';
import {validateConnectionControl} from './connections/controls.js';
import 'dotenv/config';
import dns from 'node:dns';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer } from 'ws';

// Corrige falhas de DNS/IPv6 ("TypeError: fetch failed") em redes móveis 4G/5G e Wi-Fi no Android Termux e Windows
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// Silencia logs internos ruidosos da criptografia libsignal (rotação normal de chaves Signal que polui o terminal)
(function suppressNoisyLibsignalLogs() {
  const NOISY_SIGNAL_PREFIXES = [
    'Closing session:',
    'Opening session:',
    'Removing old closed session:',
    'Session already closed',
    'Closing open session in favor of incoming prekey bundle'
  ];
  const isNoisySignalArg = (firstArg) => {
    if (typeof firstArg !== 'string') return false;
    return NOISY_SIGNAL_PREFIXES.some((p) => firstArg.startsWith(p));
  };
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origLog = console.log.bind(console);
  console.info = (...args) => {
    if (isNoisySignalArg(args[0])) return;
    origInfo(...args);
  };
  console.warn = (...args) => {
    if (isNoisySignalArg(args[0])) return;
    origWarn(...args);
  };
  console.log = (...args) => {
    if (isNoisySignalArg(args[0])) return;
    origLog(...args);
  };
})();

import {
  ROOT_DIR,
  UPLOADS_DIR,
  WA_SLOT_IDS,
  normalizeSlotId,
  parseContactChannelKey,
  buildContactChannelKey,
  normalizeWaSlotsSettings,
  storage,
  tenantStorageContext,
  uid,
  normalizePhoneDigits,
  isLikelyRealPhone,
  normalizeCatalogItem,
  buildContactVCard
} from './storage.js';
import { trueNowIso } from './trueClock.js';
import { NICHE_TEMPLATES } from './templates.js';
import { buildSystemPrompt, generateSmartReply, parseGeminiKeyPool, transcribeVoiceBufferWithAi, analyzeCrmFunnelCoach, campanhaTemChave, gerarVariacoesParaCampanha } from './aiEngine.js';
import { formatPixMessageWithQr } from './pix.js';
import { convertToCanonicalWhatsAppVoice, resolveFfmpegPath } from './audioProcessor.js';
import { createZipBuffer, extractZipBuffer } from './zipReader.js';
import { verifySignedManifest } from './updateSignature.js';
import { UPDATE_PUBLIC_KEY } from './updatePublicKey.js';
import { recoverInterruptedUpdate } from './updateTransaction.js';
import { isTrustedBrowserOrigin, rejectUntrustedBrowserRequest } from './browserOrigin.js';
import { IS_VERCEL, MEDIA_BUCKET, SUPABASE_URL, SUPABASE_ANON_KEY, isCloudConfigured } from './cloudConfig.js';
import { scopedSendChatId } from './cloudSendScope.js';
import { importarDestinatarios } from './campanhaImportacao.js';
import { importarXlsx } from './campanhaXlsx.js';
import { criarCampanha, editarCampanha, controlarCampanha, detalharCampanha, resolverIncertezaCampanha, listarDestinatariosCampanha, removerDestinatarioCampanha } from './campanhaApi.js';
import { criarServicoMediaCampanha, limparUploadsExpirados } from './campanhaMediaPrivada.js';
import { createCampaignScheduler } from './campaigns/scheduling.js';
import { criarProxyMediaCampanha } from './campanhaProxyRemoto.js';
import { getSafeCommandStatus } from './commandStatus.js';
// Não iniciar o WhatsApp sobre uma atualização incompleta. Falhas de recuperação
// interrompem o processo, em vez de abrir o motor com arquivos inconsistentes.
if (!IS_VERCEL) recoverInterruptedUpdate(ROOT_DIR);
const { whatsappManager } = IS_VERCEL
  ? { whatsappManager: null }
  : await import('./whatsappManager.js');
import {
  changeOwnPassword,
  buildCloudMultiSlotWaState,
  clampMaxWaSlots,
  cloudWorker,
  createManagedUser,
  deleteManagedUser,
  dispatchCommandToWorker,
  ensureLocalMediaCached,
  getAdminClient,
  getOrCreateDeviceIdentity,
  listManagedUsers,
  renameLocalDeviceIdentity,
  loadTenantContextAsMasterSupport,
  loadTenantContextFromCloud,
  refreshCloudSession,
  signInWithUsernamePassword,
  updateManagedUser,
  uploadMediaBufferToCloud,
  verifyCloudAccessToken
} from './supabaseCloud.js';
import {
  importTrainingZipBuffer,
  importTrainingUniversal,
  listTrainingPacks,
  getTrainingPack,
  summarizePack,
  getFullTrainingPackDetails,
  saveApprovedMessage,
  deleteApprovedMessage,
  savePackSkill,
  deletePackSkill,
  exportProfileBundleZip
} from './trainingPackEngine.js';
import { evolutionApiWebhookRouter } from './evolutionApiWebhook.js';
import { evolutionApiCloudRouter, getEvolutionApiSlotStatus, getEvolutionApiContacts, getEvolutionApiChats, sendEvolutionApiText, sendEvolutionApiMedia, sendEvolutionApiContact, reactEvolutionApiMessage, editEvolutionApiMessage, deleteEvolutionApiMessage, markEvolutionApiRead, blockEvolutionApiContact, requestEvolutionApiHistory } from './evolutionApiCloud.js';
import { mergeEvolutionApiHistoryPage } from './evolutionApiHistory.js';

export const app = express();
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '4.9.0';
  } catch {
    return '4.9.0';
  }
})();
const server = IS_VERCEL ? null : http.createServer(app);
const wss = IS_VERCEL ? null : new WebSocketServer({ server, path: '/ws' });

// CORS sozinho não impede um formulário externo de executar ações no motor.
// Recusamos a requisição antes de processar a rota, inclusive para uploads.
app.use((req, res, next) => {
  if ((req.path === '/api' || req.path.startsWith('/api/') || req.path === '/uploads' || req.path.startsWith('/uploads/')) &&
      rejectUntrustedBrowserRequest(req, { cloud: IS_VERCEL })) {
    return res.status(403).json({ ok: false, error: 'Origem do navegador não autorizada.' });
  }
  next();
});
app.use(cors((req, cb) => cb(null, {
  origin: req.headers.origin && isTrustedBrowserOrigin(req.headers.origin, req.headers.host, { cloud: IS_VERCEL }) ? req.headers.origin : false,
  credentials: false
})));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.vercel.app https://*.e2b.app http://localhost:* http://127.0.0.1:*");
  if (IS_VERCEL) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Servir arquivos estáticos (incluindo manifest.json e sw.js livres de auth p/ Chrome PWA)
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  },
  express.static(UPLOADS_DIR)
);
// Healthcheck para monitoramento (Docker / Oracle Cloud)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ======================== WEBHOOK EVOLUTION GO ========================
// Recebe mensagens do Evolution API → IA do Ienvia Motor → resposta.
// Montado antes de /api de auth: o webhook valida seu segredo próprio, não uma sessão de usuário.
app.use('/api/evolution-webhook', evolutionApiWebhookRouter);

app.get(['/venda', '/venda.html'], (req, res) => res.redirect(302, `${IS_VERCEL ? '/' : '/vitrine'}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
app.get(['/painel', '/app'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', 'painel.html'));
});
app.get(['/visao-geral', '/visao-geral/'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', 'v2', 'index.html'));
});
app.get(['/contas','/contas/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/accounts.html'));});
app.get(['/configuracoes','/configuracoes/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/security-settings.html'));});
app.get(['/inteligencia-artificial','/inteligencia-artificial/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/ai-settings.html'));});
app.get(['/simulador','/simulador/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/simulator.html'));});
app.get(['/catalogo','/catalogo/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/catalog.html'));});
app.get(['/audios','/audios/'],(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.join(ROOT_DIR,'public/v2/audios.html'));});
app.get(['/treinamento','/treinamento/'],(_req,res)=>{res.setHeader('Cache-Control','no-store, private');res.sendFile(path.join(ROOT_DIR,'public','v2','training.html'));});
app.get(['/campanhas','/campanhas/'],(_req,res)=>{res.setHeader('Cache-Control','no-store, private');res.sendFile(path.join(ROOT_DIR,'public','v2','campaigns.html'));});
app.get(['/conversas','/conversas/'],(_req,res)=>{res.setHeader('Cache-Control','no-store, private');res.sendFile(path.join(ROOT_DIR,'public','v2','conversations.html'));});
app.get(['/historico','/historico/'],(_req,res)=>{res.setHeader('Cache-Control','no-store, private');res.sendFile(path.join(ROOT_DIR,'public','v2','history.html'));});
app.get(['/canais','/canais/','/instancias','/instancias/'],(_req,res)=>{res.setHeader('Cache-Control','no-cache');res.sendFile(path.join(ROOT_DIR,'public','v2','channels.html'));});
app.get(['/conexoes', '/conexoes/'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', 'v2', 'connections.html'));
});
app.get('/vitrine', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});
if (!IS_VERCEL) {
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ROOT_DIR, 'public', 'painel.html'));
  });
}
app.use(
  express.static(path.join(ROOT_DIR, 'public'), {
    etag: true,
    setHeaders: (res, filePath) => {
      if (/\.(html|js|css|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT_DIR, 'public', IS_VERCEL ? 'index.html' : 'painel.html'));
});

// Upload em disco para Catálogo (até 5 Fotos/PDFs por item — whitelist estrita anti-XSS)
const ALLOWED_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.ogg', '.opus', '.mp3', '.m4a', '.wav', '.webm']);
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      const safeExt = ALLOWED_UPLOAD_EXTS.has(ext) ? ext : '.bin';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Upload em memória para Documentos, Pacotes .ZIP e Microfone/Mídia no Simulador
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024 }
});

function broadcast(event, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

if (whatsappManager) {
  whatsappManager.setBroadcaster(broadcast);
}
if (!IS_VERCEL) {
  cloudWorker.bindRuntime({ whatsappManager, broadcast });
}

if (wss) {
  wss.on('connection', (ws, req) => {
    // Proteção Anti-CSWSH (Cross-Site WebSocket Hijacking) contra sites externos acessando ws://localhost:3000/ws
    if (!isTrustedBrowserOrigin(req.headers?.origin || '', req.headers?.host || '', { cloud: false })) {
      ws.close(4003, 'Untrusted origin');
      return;
    }
    const configuredPin = String(storage.data.settings.securityPin || '').trim();
    if (configuredPin) {
      const urlObj = new URL(req.url || '/ws', 'http://localhost');
      const qsPin = urlObj.searchParams.get('pin') || '';
      if (!safeComparePin(configuredPin, qsPin)) {
        ws.close(4001, 'PIN required');
        return;
      }
    }
    ws.send(JSON.stringify({
      event: 'wa_state',
      payload: whatsappManager.getPublicState(),
      ts: Date.now()
    }));
    ws.send(JSON.stringify({
      event: 'proactive_queue_state',
      payload: whatsappManager.getProactiveQueueState(),
      ts: Date.now()
    }));
  });
}

// ======================== AUTENTICAÇÃO NUVEM (SUPABASE RLS) + PIN LOCAL ========================

const pinRateTracker = new Map(); // ip -> { fails, blockedUntil }
function recordRateFailure(key, entry) {
  if (pinRateTracker.size >= 2000 && !pinRateTracker.has(key)) {
    const now = Date.now();
    for (const [k, v] of pinRateTracker) {
      if (!v || (v.blockedUntil > 0 && v.blockedUntil < now)) pinRateTracker.delete(k);
    }
    if (pinRateTracker.size >= 2000) {
      const oldestKey = pinRateTracker.keys().next().value;
      if (oldestKey) pinRateTracker.delete(oldestKey);
    }
  }
  pinRateTracker.set(key, entry);
}

function safeComparePin(expected = '', given = '') {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(given || ''), 'utf8');
  if (a.length === 0) return true;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.query?.token) {
    return String(req.query.token).trim();
  }
  return '';
}

app.get('/api/auth/status', async (req, res) => {
  const token = extractBearerToken(req);
  if (IS_VERCEL) {
    if (token) {
      try {
        const verified = await verifyCloudAccessToken(token);
        if (verified) {
          return res.json({
            ok: true,
            mode: 'vercel_cloud',
            cloudLoginRequired: false,
            pinRequired: false,
            currentUser: {
              id: verified.authUser.id,
              username: verified.profile.username,
              displayName: verified.profile.display_name || verified.profile.username,
              role: verified.profile.role || 'user'
            },
            branding: { appName: 'Ienvia', appSubtitle: 'Atendente Universal Cloud' }
          });
        }
      } catch (err) {
        const temporaryError = err.code === 'ACCOUNT_PROFILE_UNAVAILABLE';
        return res.status(temporaryError ? 503 : 200).json({
          ok: !temporaryError,
          mode: 'vercel_cloud',
          cloudLoginRequired: true,
          temporaryError,
          blockedError: temporaryError || err.code === 'ACCOUNT_BLOCKED' || err.code === 'ACCOUNT_NOT_REGISTERED' ? err.message : null,
          pinRequired: false,
          branding: { appName: 'Ienvia', appSubtitle: 'Atendente Universal Cloud' }
        });
      }
    }
    return res.json({
      ok: true,
      mode: 'vercel_cloud',
      cloudLoginRequired: true,
      pinRequired: false,
      branding: { appName: 'Ienvia', appSubtitle: 'Atendente Universal Cloud' }
    });
  }

  // Modo Motor Local (Termux / Windows PC)
  const workerSt = cloudWorker.getStatus();
  const pinEnabled = Boolean(String(storage.data.settings.securityPin || '').trim());
  if (workerSt.configured && !workerSt.loggedIn) {
    return res.json({
      ok: true,
      mode: 'local_worker',
      cloudLoginRequired: true,
      workerStatus: workerSt,
      pinRequired: false,
      branding: storage.data.settings.branding || { appName: 'Ienvia', appSubtitle: 'Motor WhatsApp Local' }
    });
  }

  res.json({
    ok: true,
    mode: 'local_worker',
    cloudLoginRequired: false,
    currentUser: workerSt.user || null,
    workerStatus: workerSt,
    pinRequired: pinEnabled,
    branding: storage.data.settings.branding || { appName: 'Ienvia', appSubtitle: 'Atendente Universal' }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'local';
  const entry = pinRateTracker.get(`login_${ip}`) || { fails: 0, blockedUntil: 0 };
  if (entry.blockedUntil > Date.now()) {
    const secs = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
    return res.status(429).json({ ok: false, error: `Muitas tentativas. Aguarde ${secs}s para tentar novamente.` });
  }

  try {
    const { username, password } = req.body || {};
    const authRes = await signInWithUsernamePassword(username, password);
    pinRateTracker.delete(`login_${ip}`);

    // Se estiver rodando localmente no Termux/PC, já conecta também o Motor WhatsApp em segundo plano a esta conta!
    if (!IS_VERCEL && isCloudConfigured()) {
      await cloudWorker.loginWorkerWithCredentials(username, password);
    }

    return res.json({
      ok: true,
      mode: IS_VERCEL ? 'vercel_cloud' : 'local_worker',
      session: authRes.session,
      user: authRes.user
    });
  } catch (err) {
    if (err.code === 'ACCOUNT_PROFILE_UNAVAILABLE') {
      return res.status(503).json({ ok: false, error: err.message });
    }
    entry.fails += 1;
    if (entry.fails >= 6) {
      entry.blockedUntil = Date.now() + 60_000;
      entry.fails = 0;
    }
    recordRateFailure(`login_${ip}`, entry);
    return res.status(401).json({ ok: false, error: err.message || 'Usuário ou senha inválidos.' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await refreshCloudSession(req.body?.refreshToken);
    return res.json({ ok: true, ...out });
  } catch (err) {
    if (err.code === 'ACCOUNT_PROFILE_UNAVAILABLE') {
      return res.status(503).json({ ok: false, error: err.message, retrySession: err.retrySession });
    }
    return res.status(401).json({ ok: false, authRequired: true, error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    if (!IS_VERCEL && req.body?.logoutWorker !== false) {
      await cloudWorker.logoutWorker();
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/verify-pin', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'local';
  const entry = pinRateTracker.get(ip) || { fails: 0, blockedUntil: 0 };
  if (entry.blockedUntil > Date.now()) {
    const secs = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
    return res.status(429).json({ ok: false, error: `Muitas tentativas incorretas. Aguarde ${secs}s para tentar novamente.` });
  }

  const configuredPin = String(storage.data.settings.securityPin || '').trim();
  const given = String(req.body?.pin || '').trim();
  if (!configuredPin || safeComparePin(configuredPin, given)) {
    pinRateTracker.delete(ip);
    return res.json({ ok: true });
  }

  entry.fails += 1;
  if (entry.fails >= 5) {
    entry.blockedUntil = Date.now() + 60_000;
    entry.fails = 0;
  }
  recordRateFailure(ip, entry);
  return res.status(401).json({ ok: false, error: 'PIN incorreto.' });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractActAsUserId(req) {
  const raw = String(req.headers['x-zapia-act-as'] || req.query?.actAs || '').trim();
  return raw || '';
}

function attachAtomicCloudFlush(res, tenantStore) {
  let flushed = false;
  const ensureFlushed = async () => {
    if (flushed) return;
    flushed = true;
    await tenantStore.flushCloud();
  };

  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  res.json = (body) => {
    ensureFlushed()
      .then(() => origJson(body))
      .catch((e) => {
        console.error('[CloudFlush] Erro ao salvar estado:', e.message);
        res.status(503);
        origJson({ ok: false, error: 'Não foi possível salvar na nuvem. Tente novamente.' });
      });
    return res;
  };

  res.send = (body) => {
    if (flushed) return origSend(body);
    ensureFlushed()
      .then(() => origSend(body))
      .catch((e) => {
        console.error('[CloudFlush] Erro ao salvar estado:', e.message);
        res.status(503);
        origJson({ ok: false, error: 'Não foi possível salvar na nuvem. Tente novamente.' });
      });
    return res;
  };
}

// Rotas do dashboard que também precisam do workspace do tenant (contatos vivos).
const CONVERSATIONS_WORKSPACE_ROUTE = /^\/conversations-v3(?:\/|$)/;
const WORKSPACE_ONLY_ROUTE = /^\/(?:training-v2|resources-v2|simulator-v2|ai-settings-v2|security-settings-v2|accounts-v2)(?:\/|$)/;
// O disparo do relógio de campanhas é autenticado por segredo próprio do cron, não por
// sessão de navegador: ele não pode entrar no fluxo de contexto por usuário.
// Dentro de `app.use('/api')` o Express entrega `req.path` já sem o prefixo "/api".
const CRON_PATH = /^\/campaigns-v2\/schedule\/tick$/;
const isDashboardRequest = (req) => /^\/(?:channels|conversations-v3|crm-v2|campaigns-v2|training-v2|resources-v2|simulator-v2|ai-settings-v2|security-settings-v2|accounts-v2)(?:\/|$)/.test(req.path)&&!CRON_PATH.test(req.path)||/^(?:\/dashboard\/(?:summary|appearance|parity)|\/connections\/(?:summary|configuration|pairing))\/?$/.test(req.path);
async function makeDashboardContext(verified, actAsUserId = '') {
  const profile = verified.profile;
  const viewer = { id: verified.authUser.id, displayName: profile.display_name || profile.displayName || profile.username || 'Minha conta', role: profile.role || 'user' };
  let target = { id: viewer.id, displayName: viewer.displayName, maxWaSlots: clampMaxWaSlots(profile.max_wa_slots ?? profile.maxWaSlots, profile.role) };
  let dataClient = verified.client;
  if (actAsUserId && actAsUserId !== viewer.id) {
    if (viewer.role !== 'master') throw Object.assign(new Error('Suporte permitido somente para master.'), { statusCode: 403 });
    if (!UUID_RE.test(actAsUserId)) throw Object.assign(new Error('Conta inválida.'), { statusCode: 400 });
    dataClient = getAdminClient();
    const result = await dataClient.from('zapia_users').select('user_id,display_name,username,role,max_wa_slots,is_active').eq('user_id', actAsUserId).maybeSingle();
    if (result.error) throw Object.assign(new Error('Não foi possível verificar a conta.'), { statusCode: 503 });
    if (!result.data?.is_active) throw Object.assign(new Error('Conta indisponível.'), { statusCode: 403 });
    target = { id: result.data.user_id, displayName: result.data.display_name || result.data.username, maxWaSlots: clampMaxWaSlots(result.data.max_wa_slots, result.data.role) };
  }
  return { mode: 'vercel_cloud', viewerClient: verified.client, dataClient, viewer, tenant: target, permissions: { master: viewer.role === 'master' } };
}

// Middleware Multi-Tenant Cloud + Modo Suporte 1-Clique (isola 100% dos dados por conta e sincroniza antes do término da Function)
app.use('/api', async (req, res, next) => {
  if (req.path === '/public/motor-update.zip' || req.path === '/public/version') {
    return next();
  }
  // Disparo do relógio de campanhas: autenticado pelo segredo do cron dentro do próprio
  // router de campanhas. Sem isso o middleware de sessão barraria o job antes de chegar lá.
  if (CRON_PATH.test(req.path)) return next();
  const actAsUserId = extractActAsUserId(req);

  if (IS_VERCEL) {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, authRequired: true, error: 'Faça login com seu usuário e senha.' });
    }
    try {
      const verified = await verifyCloudAccessToken(token);
      if (!verified) {
        return res.status(401).json({ ok: false, authRequired: true, error: 'Sessão expirada. Faça login novamente.' });
      }

      req.realMasterProfile = verified.profile;
      validateLegacyApiReferences(req.path,{body:req.body,query:req.query});
      if(req.method==='POST'){validateConnectionControl(req.path,req.body,{maxSlots:clampMaxWaSlots(verified.profile.max_wa_slots,verified.profile.role),support:!!actAsUserId&&actAsUserId!==verified.authUser.id});}
      if (req.path === '/wa/toggle-bot' && typeof req.body?.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled deve ser booleano (true ou false).' });
      if (isDashboardRequest(req)) {
        req.dashboardContext = await makeDashboardContext(verified, actAsUserId);
        // Abas sem conversa (Treinamento, Catálogo, IA, Segurança, Contas, Simulador) leem
        // business/settings reais: carregamos o workspace do tenant sem os contatos. O chat
        // continua carregando o workspace completo, com contatos, no bloco abaixo.
        if (WORKSPACE_ONLY_ROUTE.test(req.path) && !(actAsUserId && actAsUserId !== verified.authUser.id)) {
          const store = await loadTenantContextFromCloud(verified.client, verified.authUser, verified.profile, {withContacts: false});
          // Os routers das abas leem `req.dashboardContext.data`; o contexto do dashboard
          // sozinho não traz workspace, então anexamos aqui o dado real do tenant.
          req.dashboardContext = {
            ...req.dashboardContext,
            data: store.data,
            runtime: store.waRuntime || req.dashboardContext?.runtime,
            store,
            storage: store
          };
          req.cloudAuth = {client: verified.client, authUser: verified.authUser, profile: verified.profile, tenantStore: store, isRemoteImpersonation: false, impersonatedBy: null};
          attachAtomicCloudFlush(res, store);
          return tenantStorageContext.run(store, () => next());
        }
        // A caixa de Conversas da nuvem lê o CRM vivo (zapia_contacts), e não só a
        // projeção do dashboard. Carregamos o workspace do tenant para quem consome
        // contatos, mantendo o mesmo escopo de contato usado no envio.
        if (CONVERSATIONS_WORKSPACE_ROUTE.test(req.path)) {
          if (actAsUserId && actAsUserId !== verified.authUser.id) {
            if (!UUID_RE.test(actAsUserId)) throw Object.assign(new Error('Identificador de cliente inválido.'), { statusCode: 400 });
            const supportCtx = await loadTenantContextAsMasterSupport(actAsUserId);
            attachAtomicCloudFlush(res, supportCtx.tenantStore);
            return tenantStorageContext.run(supportCtx.tenantStore, () => next());
          }
          const tenantStore = await loadTenantContextFromCloud(verified.client, verified.authUser, verified.profile, {
            scopedContactId: scopedSendChatId(req.method, req.path)
          });
          req.cloudAuth = {
            client: verified.client,
            authUser: verified.authUser,
            profile: verified.profile,
            tenantStore,
            isRemoteImpersonation: false,
            impersonatedBy: null
          };
          attachAtomicCloudFlush(res, tenantStore);
          return tenantStorageContext.run(tenantStore, () => next());
        }
        return next();
      }

      if (actAsUserId && actAsUserId !== verified.authUser.id) {
        if (verified.profile?.role !== 'master') {
          return res.status(403).json({ ok: false, error: 'Modo Suporte permitido exclusivamente para a conta Admin Master.' });
        }
        if (!UUID_RE.test(actAsUserId)) {
          return res.status(400).json({ ok: false, error: 'Identificador de cliente inválido.' });
        }
        const supportCtx = await loadTenantContextAsMasterSupport(actAsUserId);
        req.cloudAuth = {
          client: supportCtx.adminClient,
          authUser: supportCtx.targetAuthUser,
          profile: supportCtx.targetProfile,
          tenantStore: supportCtx.tenantStore,
          isRemoteImpersonation: true,
          impersonatedBy: {
            id: verified.authUser.id,
            username: verified.profile.username,
            displayName: verified.profile.display_name || verified.profile.username
          }
        };
        attachAtomicCloudFlush(res, supportCtx.tenantStore);
        return tenantStorageContext.run(supportCtx.tenantStore, () => next());
      }

      // Estas operações não leem nem alteram o workspace; evitam carregar conversas privadas.
      if ((req.path === '/campaigns' || req.path.startsWith('/campaigns/')) ||
          req.path === '/evolution-cloud/campaign-send' ||
          (req.method === 'GET' && (req.path === '/cloud/realtime-config' || /^\/cloud\/commands\/[^/]+\/status\/?$/.test(req.path) || req.path === '/evolution-cloud/diagnostics/read-only'))) {
        req.cloudAuth = { client: verified.client, authUser: verified.authUser, profile: verified.profile, isRemoteImpersonation: false };
        return next();
      }
      const tenantStore = await loadTenantContextFromCloud(verified.client, verified.authUser, verified.profile, {
        scopedContactId: scopedSendChatId(req.method, req.path)
      });
      req.cloudAuth = {
        client: verified.client,
        authUser: verified.authUser,
        profile: verified.profile,
        tenantStore,
        isRemoteImpersonation: false,
        impersonatedBy: null
      };
      attachAtomicCloudFlush(res, tenantStore);
      return tenantStorageContext.run(tenantStore, () => next());
    } catch (err) {
      const status = err.statusCode || 401;
      return res.status(status).json({
        ok: false,
        authRequired: status === 401,
        error: err.message || 'Acesso negado.'
      });
    }
  }

  // Modo Local (Termux / Windows PC): exige login da conta se o modo nuvem estiver ativo
  const workerSt = cloudWorker.getStatus();
  if (workerSt.configured && !workerSt.loggedIn) {
    return res.status(401).json({ ok: false, authRequired: true, error: 'Conecte sua conta Ienvia para continuar.' });
  }

  const configuredPin = String(storage.data.settings.securityPin || '').trim();
  if (configuredPin) {
    const headerPin = String(req.headers['x-panel-pin'] || req.query?.pin || '').trim();
    if (!safeComparePin(configuredPin, headerPin)) {
      return res.status(401).json({ ok: false, pinRequired: true, error: 'Painel protegido por PIN.' });
    }
  }

  req.realMasterProfile = workerSt.user || { role: 'master' };
  {try{validateLegacyApiReferences(req.path,{body:req.body,query:req.query});if(req.method==='POST')validateConnectionControl(req.path,req.body,{maxSlots:workerSt.user?clampMaxWaSlots(workerSt.user.maxWaSlots??workerSt.user.max_wa_slots,workerSt.user.role):3,support:!!actAsUserId&&actAsUserId!==workerSt.user?.id});}catch(error){return res.status(error.statusCode||400).json({ok:false,error:error.message});}}
  if (req.path === '/wa/toggle-bot' && typeof req.body?.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled deve ser booleano (true ou false).' });
  if (isDashboardRequest(req) && actAsUserId && actAsUserId !== workerSt.user?.id) {
    try {
      if (!cloudWorker.client || !workerSt.user?.id) return res.status(403).json({ ok: false, error: 'Entre como master para usar suporte.' });
      req.dashboardContext = await makeDashboardContext({ client: cloudWorker.client, authUser: workerSt.user, profile: workerSt.user }, actAsUserId);
      return next();
    } catch (error) { return res.status(error.statusCode || 503).json({ ok: false, error: error.message }); }
  }


  // Se o Admin Master local clicar em "Acessar Painel deste Cliente", carrega o workspace remoto daquele cliente sem mexer no WhatsApp local!
  if (actAsUserId && actAsUserId !== workerSt.user?.id) {
    if (workerSt.user?.role !== 'master') {
      return res.status(403).json({ ok: false, error: 'Modo Suporte permitido exclusivamente para a conta Admin Master.' });
    }
    if (!UUID_RE.test(actAsUserId)) {
      return res.status(400).json({ ok: false, error: 'Identificador de cliente inválido.' });
    }
    try {
      const supportCtx = await loadTenantContextAsMasterSupport(actAsUserId);
      req.cloudAuth = {
        client: supportCtx.adminClient,
        authUser: supportCtx.targetAuthUser,
        profile: supportCtx.targetProfile,
        tenantStore: supportCtx.tenantStore,
        isRemoteImpersonation: true,
        impersonatedBy: {
          id: workerSt.user.id,
          username: workerSt.user.username,
          displayName: workerSt.user.displayName || workerSt.user.username
        }
      };
      attachAtomicCloudFlush(res, supportCtx.tenantStore);
      return tenantStorageContext.run(supportCtx.tenantStore, () => next());
    } catch (err) {
      return res.status(err.statusCode || 400).json({ ok: false, error: err.message });
    }
  }

  return next();
});

// O bridge precisa ficar após o middleware /api, que autentica e instala o tenant context.
const workspaceReadDependencies = {
  readEvolution: getEvolutionApiSlotStatus,
  buildRuntime: buildCloudMultiSlotWaState,
  getLocalContext: async (req) => {
    if (IS_VERCEL) {
      // Abas que não são de conversa também precisam do workspace real da conta.
      // Carrega sem contatos (o middleware já preparou req.cloudAuth no mesmo request).
      const auth = req?.cloudAuth;
      if (!auth?.client || !auth?.authUser) return null;
      if (req._workspaceLazy) return req._workspaceLazy;
      req._workspaceLazy = loadTenantContextFromCloud(auth.client, auth.authUser, auth.profile || {}, {withContacts: false})
        .then(store => {
          req.cloudAuth = {...auth, tenantStore: store};
          return {...req.dashboardContext, mode: 'vercel_cloud', data: store.data, runtime: store.waRuntime || req.dashboardContext?.runtime, store, storage: store};
        })
        .catch(() => null);
      return req._workspaceLazy;
    }
    const worker = cloudWorker.getStatus(), now = new Date().toISOString();
    const runtime = whatsappManager.getPublicState();
    const maxWaSlots = worker.user ? clampMaxWaSlots(worker.user.maxWaSlots ?? worker.user.max_wa_slots, worker.user.role) : 3;
    const slots = Object.fromEntries(Object.entries(runtime.slots || {}).map(([id, value]) => [id, { ...value, workerOnline: true, workerHeartbeatAt: now }]));
    return { mode: 'local_worker', viewerClient: worker.user?.id ? cloudWorker.client : null,
      viewer: { id: worker.user?.id || null, displayName: worker.user?.displayName || worker.user?.username || 'Painel local', role: worker.user?.role || null },
      tenant: { id: worker.user?.id || null, displayName: worker.user?.displayName || 'Este motor local', maxWaSlots },
      permissions: { master: (worker.user?.role || 'master') === 'master' }, data: storage.data, runtime: { ...runtime, slots, maxWaSlots } };
  }
};
// Rascunhos das abas novas: arquivo privado no motor local, tabela ienvia_workspace_drafts
// na nuvem (Vercel não tem disco persistente). O contrato é o mesmo; os routers não sabem
// onde o dado mora. A criação é preguiçosa: sem a credencial necessária a rota responde
// 503 em vez de derrubar o processo no boot.
const draftFileFactories = () => ({
  training: () => createTrainingFileRepository({root: path.join(ROOT_DIR, 'data', 'training-drafts-v2')}),
  resources: () => createResourceFileRepository({root: path.join(ROOT_DIR, 'data', 'resources-drafts-v2')}),
  ai: () => createAiSettingsFileRepository({root: path.join(ROOT_DIR, 'data', 'ai-settings-drafts-v2')}),
  security: () => createSecuritySettingsFileRepository({root: path.join(ROOT_DIR, 'data', 'security-settings-drafts-v2')}),
  accounts: () => createAccountsFileRepository({root: path.join(ROOT_DIR, 'data', 'accounts-administration-v2')}),
  simulator: () => createSimulatorFileRepository({root: path.join(ROOT_DIR, 'data', 'simulator-sessions-v2')})
});
const draftRepository = namespace => {
  let instance = null;
  const resolve = () => {
    if (instance) return instance;
    try {
      instance = IS_VERCEL
        ? createWorkspaceDraftCloudRepository({client: getAdminClient(), namespace})
        : draftFileFactories()[namespace]();
    } catch {
      throw Object.assign(new Error('Armazenamento dos rascunhos indisponível neste ambiente.'), {status: 503});
    }
    if (!instance) throw Object.assign(new Error('Namespace de rascunho inválido.'), {status: 503});
    return instance;
  };
  return Object.freeze({
    read: ownerId => resolve().read(ownerId),
    save: input => resolve().save(input)
  });
};
app.use('/api/dashboard', createOverviewParityRouter(workspaceReadDependencies));
app.use('/api/dashboard', createDashboardRouter(workspaceReadDependencies));
app.use('/api/connections', createConnectionsRouter(workspaceReadDependencies));
// Leitura de ficha por thread liberada: usa a projeção salva (ienvia_instance_threads), nunca o
// contato legado. As instâncias ainda vêm de zapia_wa_slots até a migração operacional.
// Pareamento de número pela aba nova: delega ao MESMO motor que o painel anterior usa
// (worker na nuvem ou whatsappManager local). Sem motor, a rota responde 503 e nada muda.
const channelPairingBridge = {
  enabled: true,
  async connect({ctx, slotId, pairingPhone}) {
    if (usesCloudBridge({ cloudAuth: ctx.cloudAuth, mode: ctx.mode })) {
      const out = await dispatchCommandToWorker(
        ctx.cloudAuth?.client || ctx.viewerClient,
        ctx.cloudAuth?.authUser?.id || ctx.viewer.id,
        'wa_connect',
        { pairingPhone: pairingPhone || null, slotId, targetDeviceId: null },
        9500,
        { slotId, targetDeviceId: null }
      );
      return { engine: 'cloud_worker', ...out };
    }
    await whatsappManager.connect(pairingPhone || null, slotId);
    return { engine: 'local_worker' };
  },
  async disconnect({ctx, slotId}) {
    if (usesCloudBridge({ cloudAuth: ctx.cloudAuth, mode: ctx.mode })) {
      const out = await dispatchCommandToWorker(
        ctx.cloudAuth?.client || ctx.viewerClient,
        ctx.cloudAuth?.authUser?.id || ctx.viewer.id,
        'wa_disconnect',
        { clearSession: false, slotId },
        8800,
        { slotId }
      );
      return { engine: 'cloud_worker', ...out };
    }
    await whatsappManager.disconnect(false, slotId);
    return { engine: 'local_worker' };
  }
};
app.use('/api/channels',createChannelsRouter({...workspaceReadDependencies,allowCrmProjection:true,pairing:channelPairingBridge}));
// Conversas reais na navegação nova. Lê o CRM legado vivo (zapia_contacts) e expõe
// instância/thread/mensagem no formato que a caixa de entrada nova consome.
app.use('/api/conversations-v3',createConversationsV3Router({...workspaceReadDependencies,store:()=>tenantStorageContext.getStore(),sendEnabled:true}));
// Comandos reais da caixa nova (enviar, lida, fixar, arquivar, nota, pausa, ficha).
// O armazenamento é o mesmo que a leitura acima consome; o envio usa a ponte Evolution
// do chip conectado da conta. Suporte continua somente leitura.
app.use('/api/conversations-v3',createConversationsCommandsRouter({getLocalContext:workspaceReadDependencies.getLocalContext,store:()=>tenantStorageContext.getStore(),allowSend:true}));
// Metadata CRM preparada localmente. Escritas continuam desligadas (default do router).
// Escrita de ficha/etiqueta/atalho homologada pelo dono na conta real. O CRM lê o registro
// salvo (ienvia_crm_contacts), que hoje está vazio; a escrita fica liberada por conta
// master, sem tocar em contatos legados nem em outro chip.
const crmAccountWrites = req => req.dashboardContext?.viewer?.role === 'master' && req.dashboardContext?.viewer?.id === req.dashboardContext?.tenant?.id;
app.use('/api/crm-v2',createCrmRouter({...workspaceReadDependencies,allowWrites:true,allowAccountWrites:crmAccountWrites}));
// Origem global, identidade delegada e implantação ainda não homologadas: sem consulta cloud nem ativação.
// Cofre de chaves/PIN e executor de campanha: criados no primeiro uso (sem chave
// configurada a aba responde 503 em vez de derrubar o processo no boot).
const draftSecrets = (() => {
  let instance = null;
  return () => (instance ||= createDraftSecrets(process.env));
})();
const campaignRunnerFor = req => {
  const client = req?.dashboardContext?.viewerClient || req?.cloudAuth?.client || null;
  if (!client || typeof client.from !== 'function') return null;
  return createCampaignRunner({client});
};
// Agendamento contínuo: o relógio é externo (cron da Vercel, autenticado por segredo) e
// chama o MESMO runner. Sem `CAMPAIGN_CRON_SECRET` + `CAMPAIGN_CRON_OWNER_ID` a rota
// nem é registrada — nada roda sozinho por acidente.
// Durante o cron não existe sessão de navegador: o relógio usa a chave de serviço, marcada
// com `__servico` para escolher os RPCs de serviço e um runner que lê o mesmo rascunho.
const campaignSchedulerFor = req => {
  let client = req?.dashboardContext?.viewerClient || req?.cloudAuth?.client || null;
  const servico = Boolean(req?.campaignCron) && Boolean(CAMPAIGN_CRON_OWNER_ID);
  if (servico) {
    try { const admin = getAdminClient(); admin.__servico = true; client = admin; } catch { client = null; }
  }
  if (!client || typeof client.from !== 'function') return null;
  const runner = servico
    ? createCampaignRunner({
        client,
        ownerOverride: CAMPAIGN_CRON_OWNER_ID,
        // Sem sessão, a lista de destinatários vem do caminho de serviço explícito.
        recipientsProvider: ({ ownerId, campaignId }) => createCampaignScheduler({ client }).pendentesDe({ ownerId, campaignId, limite: 25 })
      })
    : null;
  return createCampaignScheduler({client, runner, servico, runnerFor: () => runner || campaignRunnerFor(req)});
};
const CAMPAIGN_CRON_SECRET = String(process.env.CAMPAIGN_CRON_SECRET || '').trim();
const CAMPAIGN_CRON_OWNER_ID = String(process.env.CAMPAIGN_CRON_OWNER_ID || '').trim();
// Administração/Contas: a carteira vem das contas reais (zapia_users), sem senha nem chave.
// Enquanto a porta de provisionamento não existe na nuvem, a gravação da carteira é
// só de auditoria/perfil e a criação de conta continua recusada (canProvision:false).
// Provisionamento de conta: cria o usuário no Auth e o perfil em zapia_users.
// Se o perfil falhar, o usuário criado é removido — não deixamos conta órfã.
const provisionAccountInCloud = async (plan) => {
  const admin = getAdminClient();
  const email = `${plan.username}@zapia.local`;
  const password = `${crypto.randomBytes(18).toString('base64url')}!A9`;
  const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
  if (created?.error || !created?.data?.user?.id) {
    throw Object.assign(new Error('Não foi possível criar a conta no Auth.'), {status: 503});
  }
  const userId = created.data.user.id;
  const prof = await admin.from('zapia_users').insert({
    user_id: userId,
    username: plan.username,
    display_name: plan.displayName,
    role: 'user',
    is_active: true,
    max_wa_slots: Number.isInteger(plan.instanceLimit) ? Math.max(1, Math.min(3, plan.instanceLimit)) : 1
  });
  if (prof.error) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw Object.assign(new Error('Criação cancelada: o perfil não pôde ser gravado.'), {status: 503});
  }
  return {id: userId, username: plan.username, provisioning: 'existing'};
};
const readAccountsFromCloud = async () => {
  const admin = getAdminClient();
  const {data, error} = await admin.from('zapia_users').select('user_id, username, display_name, role, is_active, max_wa_slots').order('created_at', {ascending: true});
  if (error) throw Object.assign(new Error('Administração ou integração não habilitada. Consulte o estado antes de decidir.'), {status: 503});
  if (!Array.isArray(data) || data.length > 1000) throw Object.assign(new Error('Carteira de contas inválida.'), {status: 503});
  const accounts = data.map(row => createAccountPlan({
    id: row.user_id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role === 'master' ? 'master' : 'user',
    isActive: row.is_active !== false,
    maxWaSlots: Number.isInteger(row.max_wa_slots) ? row.max_wa_slots : null
  }));
  return {accounts};
};
app.use('/api/accounts-v2',createAccountsRouter({getLocalContext:workspaceReadDependencies.getLocalContext,repository:draftRepository('accounts'),readSource:IS_VERCEL?readAccountsFromCloud:undefined,provisionAccount:IS_VERCEL?provisionAccountInCloud:null,allowWrites:true,allowWorkspaceWrites:true}));
app.use('/api/security-settings-v2',createSecuritySettingsRouter({...workspaceReadDependencies,repository:draftRepository('security'),allowWrites:true,allowPinWrites:true,pinProtector:draftSecrets().pinProtector,readApprovedMessages:async ctx=>{if(!ctx.data?.business)return [];const record=await draftRepository('training').read(ctx.tenant.id);const business=record?.document.training||ctx.data.business,id=ctx.data.business.trainingPackId;let pack=record?.document.pack||ctx.data.customPacks?.[id]||null;if(!record&&!pack&&id&&ctx.viewer.role==='master'&&ctx.viewer.id===ctx.tenant.id)pack=getTrainingPack(id);const rows=pack?.canonicalCore?.approvedMessages;if(rows?.length)return rows.map(m=>({id:m.id,title:m.title||m.id,text:m.text}));if(id&&!pack&&!record)return [];const first=String(business.assistantName||business.name||'eu').trim().split(/\s+/)[0];return [{id:'ABERTURA',title:'Abertura Consultiva Universal · original',text:business.soloIdentity?`Opa{{nome ? ', ' + nome : ''}}! Tudo bem? Aqui é o *${first}*. Posso te mostrar rapidinho como funciona meu trabalho?`:`Olá{{nome ? ', ' + nome : ''}}! Tudo bem? Aqui é do atendimento da *${business.name||'nossa equipe'}*. Posso te explicar rapidinho como funciona nosso trabalho?`}];}}));

app.use('/api/ai-settings-v2',createAiSettingsRouter({...workspaceReadDependencies,repository:draftRepository('ai'),allowWrites:true,allowSecretWrites:true,vault:draftSecrets().vault}));
app.use('/api/simulator-v2',createSimulatorRouter({...workspaceReadDependencies,repository:draftRepository('simulator'),trainingRepository:draftRepository('training'),resourceRepository:draftRepository('resources'),allowSessions:true,allowTeach:true,readSource:ctx=>{if(!ctx.data?.business)throw Object.assign(new Error('Origem local do Simulador indisponível; integração remota não homologada.'),{status:503});const business=structuredClone(ctx.data.business),id=business.trainingPackId;let pack=ctx.data.customPacks?.[id]||null;if(id&&!pack&&ctx.viewer.role==='master'&&ctx.viewer.id===ctx.tenant.id)pack=getTrainingPack(id);return {business,pack:pack?structuredClone(pack):null,botEnabled:ctx.data.settings?.botEnabled!==false,simulatorHistoryCount:Array.isArray(ctx.data.simulatorHistory)?ctx.data.simulatorHistory.length:0};}}));
app.use('/api/resources-v2',createResourceRouter({...workspaceReadDependencies,repository:draftRepository('resources'),allowWrites:true,allowTranscription:true,
 // Transcrição de áudio pela aba nova: usa o MESMO motor de IA do painel anterior
 // (Gemini), com a chave lida do workspace da conta. Sem chave, responde erro claro.
 transcribe:async({buffer,ownerId,ctx})=>{
   let ai=ctx?.data?.settings?.ai;
   if(IS_VERCEL){const r=await ctx.viewerClient.from('zapia_workspaces').select('settings').eq('user_id',ownerId).maybeSingle().abortSignal(AbortSignal.timeout(4000));if(r.error)throw Object.assign(Error('Configuração de IA indisponível.'),{status:503});ai=r.data?.settings?.ai;}
   if(!campanhaTemChave(ai))throw Object.assign(Error('Nenhuma chave de IA configurada nesta conta. Cadastre a chave em Inteligência artificial.'),{status:503});
   const out=await transcribeVoiceBufferWithAi(buffer,'audio/ogg',ai);
   if(typeof out!=='string'||!out.trim())throw Object.assign(Error('A IA não devolveu transcrição. Tente novamente.'),{status:503});
   return out.trim();
 },readLinkedMessages:ctx=>{if(!ctx.data?.business)return [];const id=ctx.data.business.trainingPackId;let p=ctx.data.customPacks?.[id]||null;if(!p&&id&&ctx.viewer.role==='master'&&ctx.viewer.id===ctx.tenant.id)p=getTrainingPack(id);return (p?.canonicalCore?.approvedMessages||[]).map(m=>({id:m.id,title:m.title||m.id}));}}));
// Rascunho local; não existe rota de ativação nem habilitação por parâmetro público.
app.use('/api/training-v2',createTrainingRouter({getLocalContext:workspaceReadDependencies.getLocalContext,repository:draftRepository('training'),allowWrites:true,previewPrompt:previewTrainingRuntime,previewImport:previewTrainingImport,readSource:ctx=>{if(!ctx.data?.business)throw Object.assign(new Error('Origem local indisponível; integração remota ainda não homologada.'),{status:503});const business=structuredClone(ctx.data.business),id=business.trainingPackId;let pack=id?ctx.data.customPacks?.[id]||null:null;if(id&&!pack&&ctx.viewer.role==='master'&&ctx.viewer.id===ctx.tenant.id)pack=getTrainingPack(id);return {business,pack:pack?structuredClone(pack):null};}}));
// UUID separado do legado. Todos os gates de escrita, IA e mídia permanecem false por padrão.
// Rascunho de campanha homologado na conta real (dono master). A execução continua fechada:
// sem canal atribuído, sem worker e sem homologação de ienvia_campaign_execution_accounts.
app.use('/api/campaigns-v2',createCampaignRouter({...workspaceReadDependencies,allowWrites:true,allowAccountWrites:crmAccountWrites,storageOrigin:SUPABASE_URL,allowExecution:true,allowAI:true,allowMedia:true,campaignRunner:req=>campaignRunnerFor(req),campaignScheduler:req=>campaignSchedulerFor(req),cronSecret:CAMPAIGN_CRON_SECRET,cronOwnerId:CAMPAIGN_CRON_OWNER_ID,
 getAIRequester:async(scope,input)=>{let ai;if(IS_VERCEL){const r=await scope.ctx.viewerClient.from('zapia_workspaces').select('settings').eq('user_id',scope.ownerId).maybeSingle();if(r.error)throw Error('Configuração indisponível.');ai=r.data?.settings?.ai;}else ai=scope.ctx.data?.settings?.ai;if(!campanhaTemChave(ai))return null;return async()=>{const result=await gerarVariacoesParaCampanha({settings:{ai},...input});if(result?.ok!==true)throw Error('Geração indisponível.');return JSON.stringify(result.variacoes);};},
 getMediaService:async scope=>{if(IS_VERCEL){const admin=getAdminClient(),service=criarServicoMediaCampanha({client:scope.ctx.viewerClient,admin,supabaseUrl:SUPABASE_URL});return {...service,iniciar:async x=>{await limparUploadsExpirados({client:scope.ctx.viewerClient,admin,userId:scope.ownerId});return service.iniciar(x);}};}const proxy=criarProxyMediaCampanha({client:scope.ctx.viewerClient,userId:scope.ownerId});return {
 iniciar:async x=>(await proxy({tipo:'iniciar',pastaId:x.pastaId,body:{tamanho:x.tamanho}})).upload,
 finalizar:async x=>{const r=await proxy({tipo:'finalizar',pastaId:x.pastaId,body:{arquivoId:x.arquivoId,nome:x.nome}});return {...r.arquivo,owner_id:scope.ownerId};},
 excluir:async x=>{await proxy({tipo:'excluir',arquivoId:x.arquivoId,body:{confirmo:true}});return true;},ticket:async x=>(await proxy({tipo:'ticket',arquivoId:x.arquivoId})).ticket};}
}));

app.use('/api/evolution-cloud', evolutionApiCloudRouter);

// Consulta autenticada e por tenant: não expõe payloads ou conteúdo de conversas.
app.get('/api/cloud/commands/:commandId/status', async (req, res) => {
  if (!req.cloudAuth?.client || !req.cloudAuth?.authUser?.id) return res.status(404).json({ ok: false, error: 'Envio não encontrado.' });
  if (!UUID_RE.test(req.params.commandId)) return res.status(400).json({ ok: false, error: 'Identificador de envio inválido.' });
  try {
    const status = await getSafeCommandStatus(req.cloudAuth.client, req.cloudAuth.authUser.id, req.params.commandId);
    if (!status) return res.status(404).json({ ok: false, error: 'Envio não encontrado.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, ...status });
  } catch {
    return res.status(503).json({ ok: false, error: 'Não foi possível consultar o envio agora.' });
  }
});

// Importação de lista sem gravação nem comunicação com WhatsApp.
const campaignImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 3, fieldSize: 2 * 1024 * 1024, parts: 4 }
});
app.post('/api/campaigns/import-preview', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  campaignImportUpload.single('file')(req, res, async (erro) => {
    if (erro) return res.status(erro.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ok:false,error:'Arquivo ou formulário excede os limites permitidos.'});
    try {
      let result;
      if (req.file) {
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (ext === '.xlsx') {
          result = await importarXlsx(req.file.buffer);
        } else if (ext === '.csv' || ext === '.txt') {
          const texto = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer);
          result = importarDestinatarios({texto,formato:ext.slice(1),separador:req.body?.separador || ','});
        } else return res.status(400).json({ok:false,error:'Use arquivo CSV, TXT ou XLSX.'});
      } else {
        result = importarDestinatarios({texto:req.body?.texto,formato:req.body?.formato,separador:req.body?.separador || ','});
      }
      return res.json({ok:true,...result});
    } catch {
      return res.status(400).json({ok:false,error:'Não foi possível ler a lista. Confira o formato e os limites do arquivo.'});
    }
  });
});

// Geração solicitada pelo usuário, sem salvar, enviar ou carregar conversas.
app.post('/api/campaigns/ai-variations', async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    let ai;
    if(IS_VERCEL && req.cloudAuth?.client && !req.cloudAuth?.tenantStore) {
      const {data,error}=await req.cloudAuth.client.from('zapia_workspaces').select('settings').eq('user_id',req.cloudAuth.authUser.id).maybeSingle();
      if(error)return res.status(503).json({ok:false,error:'Não foi possível carregar a configuração de IA.'});
      ai=data?.settings?.ai;
    } else ai=storage.data.settings?.ai;
    if(!campanhaTemChave(ai))return res.status(400).json({ok:false,error:'Configure uma chave de IA para esta conta.'});
    const result=await gerarVariacoesParaCampanha({settings:{ai},texto:req.body?.texto,quantidade:req.body?.quantidade,prompt:req.body?.prompt ?? ''});
    return res.status(result.ok?200:503).json(result);
  } catch {
    return res.status(400).json({ok:false,error:'Confira o texto, a quantidade e o prompt da campanha.'});
  }
});

// API experimental de campanhas. As RPCs exigem a sessão do próprio titular.
function contextoCampanha(req) {
  if (req.cloudAuth?.isRemoteImpersonation) { const e=new Error('Abra a conta titular para gerenciar campanhas.');e.statusCode=403;throw e; }
  if (req.cloudAuth?.client && req.cloudAuth?.authUser?.id) return {client:req.cloudAuth.client,user:{id:req.cloudAuth.authUser.id,role:req.cloudAuth.profile?.role,maxWaSlots:clampMaxWaSlots(req.cloudAuth.profile?.max_wa_slots,req.cloudAuth.profile?.role)}};
  if (!IS_VERCEL && cloudWorker.client && cloudWorker.user?.id) return {client:cloudWorker.client,user:cloudWorker.user};
  const e=new Error('Conecte a conta Ienvia para gerenciar campanhas.');e.statusCode=503;throw e;
}
function falhaCampanha(res,e) {return res.status(e.statusCode||400).json({ok:false,error:e.message||'Não foi possível processar a campanha.'});}
app.get('/api/campaigns',async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try {
    const {client,user}=contextoCampanha(req);
    const {data,error}=await client.from('ienvia_campanhas_controle').select('owner_id,campanha_id,nome,status,proxima_acao_em,pausa_tipo,revisao,plano').eq('owner_id',user.id).order('proxima_acao_em',{ascending:false}).limit(100);
    if(error||!Array.isArray(data))return res.status(503).json({ok:false,error:'Não foi possível carregar as campanhas.'});
    if(data.some(x=>x.owner_id!==user.id))return res.status(503).json({ok:false,error:'Resposta de campanhas inválida.'});
    return res.json({ok:true,campanhas:data});
  }catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns',async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const ctx=contextoCampanha(req);const campanha=await criarCampanha({...ctx,plano:req.body?.plano,opcoes:req.body?.opcoes??{},destinatarios:req.body?.destinatarios});return res.status(201).json({ok:true,campanha});}
  catch(e){return falhaCampanha(res,e);}
});
app.put('/api/campaigns/:campaignId',async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const ctx=contextoCampanha(req);const campanha=await editarCampanha({...ctx,campanhaId:req.params.campaignId,plano:req.body?.plano,opcoes:req.body?.opcoes});return res.json({ok:true,campanha});}
  catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/:campaignId/control',async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{const ctx=contextoCampanha(req);const campanha=await controlarCampanha({...ctx,campanhaId:req.params.campaignId,acao:req.body?.acao});return res.json({ok:true,campanha});}
  catch(e){return falhaCampanha(res,e);}
});

app.get('/api/campaigns/folders',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);const {data,error}=await client.from('ienvia_campanha_pastas').select('owner_id,pasta_id,nome,tipo,criada_em').eq('owner_id',user.id).order('criada_em',{ascending:false}).limit(2000);
  if(error||!Array.isArray(data)||data.some(x=>x.owner_id!==user.id))return res.status(503).json({ok:false,error:'Não foi possível carregar as pastas.'});return res.json({ok:true,pastas:data});}catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/folders',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req),nome=req.body?.nome,tipo=req.body?.tipo;
  if(typeof nome!=='string'||!nome.trim()||nome.length>120||!['imagem','audio'].includes(tipo))throw new Error('Nome ou tipo de pasta inválido.');
  const {data,error}=await client.rpc('ienvia_criar_pasta_campanha',{p_nome:nome.trim(),p_tipo:tipo});
  if(error||!Array.isArray(data)||data.length!==1||data[0].owner_id!==user.id)return res.status(503).json({ok:false,error:'Não foi possível criar a pasta.'});return res.status(201).json({ok:true,pasta:data[0]});}catch(e){return falhaCampanha(res,e);}
});
app.get('/api/campaigns/folders/:folderId/files',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);if(!UUID_RE.test(req.params.folderId))throw new Error('Pasta inválida.');
  const inicio=Number(req.query.inicio??0);if(!Number.isSafeInteger(inicio)||inicio<0||inicio>9900)throw new Error('Página inválida.');
  const {data,error}=await client.from('ienvia_campanha_arquivos').select('owner_id,arquivo_id,pasta_id,tipo,mime,tamanho,ordem,nome_original,excluindo').eq('owner_id',user.id).eq('pasta_id',req.params.folderId).order('ordem',{ascending:true}).range(inicio,inicio+99);
  if(error||!Array.isArray(data)||data.some(x=>x.owner_id!==user.id||x.pasta_id!==req.params.folderId))return res.status(503).json({ok:false,error:'Não foi possível carregar os arquivos.'});return res.json({ok:true,arquivos:data});}catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/folders/:folderId/upload-init',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);if(!IS_VERCEL)return res.json(await criarProxyMediaCampanha({client,userId:user.id})({tipo:'iniciar',pastaId:req.params.folderId,body:req.body}));const admin=getAdminClient();await limparUploadsExpirados({client,admin,userId:user.id});const service=criarServicoMediaCampanha({client,admin,supabaseUrl:SUPABASE_URL});const upload=await service.iniciar({userId:user.id,pastaId:req.params.folderId,tamanho:req.body?.tamanho});return res.json({ok:true,upload});}catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/folders/:folderId/upload-finalize',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);if(!IS_VERCEL)return res.status(201).json(await criarProxyMediaCampanha({client,userId:user.id})({tipo:'finalizar',pastaId:req.params.folderId,body:req.body}));const service=criarServicoMediaCampanha({client,admin:getAdminClient(),supabaseUrl:SUPABASE_URL});const arquivo=await service.finalizar({userId:user.id,pastaId:req.params.folderId,arquivoId:req.body?.arquivoId,nome:req.body?.nome??''});return res.status(201).json({ok:true,arquivo:{arquivo_id:arquivo.arquivo_id,pasta_id:arquivo.pasta_id,tipo:arquivo.tipo,mime:arquivo.mime,tamanho:arquivo.tamanho,ordem:arquivo.ordem,nome_original:arquivo.nome_original}});}catch(e){return falhaCampanha(res,e);}
});

app.post('/api/campaigns/files/:fileId/delete',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);if(req.body?.confirmo!==true)throw new Error('Confirme a exclusão do arquivo.');if(!IS_VERCEL)return res.json(await criarProxyMediaCampanha({client,userId:user.id})({tipo:'excluir',arquivoId:req.params.fileId,body:{confirmo:true}}));const service=criarServicoMediaCampanha({client,admin:getAdminClient(),supabaseUrl:SUPABASE_URL});await service.excluir({userId:user.id,arquivoId:req.params.fileId});return res.json({ok:true});}catch(e){return falhaCampanha(res,e);}
});
app.get('/api/campaigns/files/:fileId/ticket',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const {client,user}=contextoCampanha(req);if(!IS_VERCEL)return res.json(await criarProxyMediaCampanha({client,userId:user.id})({tipo:'ticket',arquivoId:req.params.fileId}));const service=criarServicoMediaCampanha({client,admin:getAdminClient(),supabaseUrl:SUPABASE_URL});const ticket=await service.ticket({userId:user.id,arquivoId:req.params.fileId});return res.json({ok:true,ticket});}catch(e){return falhaCampanha(res,e);}
});

// Depois das rotas fixas /folders e /files para não interpretá-las como UUID.
app.get('/api/campaigns/:campaignId',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const ctx=contextoCampanha(req);const dados=await detalharCampanha({...ctx,campanhaId:req.params.campaignId});return res.json({ok:true,...dados});}catch(e){return falhaCampanha(res,e);}
});
app.get('/api/campaigns/:campaignId/recipients',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const ctx=contextoCampanha(req);const destinatarios=await listarDestinatariosCampanha({...ctx,campanhaId:req.params.campaignId,inicio:Number(req.query.inicio??0)});return res.json({ok:true,destinatarios});}catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/:campaignId/recipients/:recipientId/remove',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const ctx=contextoCampanha(req);await removerDestinatarioCampanha({...ctx,campanhaId:req.params.campaignId,destinatarioId:req.params.recipientId,confirmo:req.body?.confirmo});return res.json({ok:true});}catch(e){return falhaCampanha(res,e);}
});
app.post('/api/campaigns/:campaignId/resolve',async (req,res)=>{
 res.setHeader('Cache-Control','no-store');try{const ctx=contextoCampanha(req);const etapa=await resolverIncertezaCampanha({...ctx,campanhaId:req.params.campaignId,destinatarioId:req.body?.destinatarioId,etapa:req.body?.etapa,tentativaId:req.body?.tentativaId,decisao:req.body?.decisao,conferi:req.body?.conferi});return res.json({ok:true,etapa});}catch(e){return falhaCampanha(res,e);}
});

// ======================== GERENCIAMENTO DE CONTAS (EXCLUSIVO ADMIN MASTER) ========================

function requireMasterAccount(req, res, next) {
  const role = req.realMasterProfile?.role || (IS_VERCEL ? req.cloudAuth?.profile?.role : cloudWorker.getStatus().user?.role);
  if (role !== 'master') {
    return res.status(403).json({ ok: false, error: 'Acesso restrito exclusivamente à conta Admin Master.' });
  }
  return next();
}

function usesCloudBridge(req) {
  return Boolean(IS_VERCEL || req.cloudAuth?.isRemoteImpersonation);
}

app.get('/api/admin/users', requireMasterAccount, async (_req, res) => {
  try {
    const users = await listManagedUsers();
    res.json({ ok: true, users });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/users', requireMasterAccount, async (req, res) => {
  try {
    const created = await createManagedUser(req.body || {});
    storage.addLog('info', `Nova conta isolada criada pelo Admin Master: @${created.username} (${created.displayName}).`);
    res.json({ ok: true, user: created });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.patch('/api/admin/users/:userId', requireMasterAccount, async (req, res) => {
  try {
    await updateManagedUser(req.params.userId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/users/:userId', requireMasterAccount, async (req, res) => {
  try {
    await deleteManagedUser(req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ======================== ROTAS DE BOOTSTRAP & POLLING CLOUD ========================

function getEffectiveWaState(req) {
  if (usesCloudBridge(req) && req.cloudAuth?.tenantStore?.waRuntime) {
    return req.cloudAuth.tenantStore.waRuntime;
  }
  const st = whatsappManager.getPublicState();
  const workerSt = cloudWorker.getStatus();
  const devId = workerSt.deviceId || getOrCreateDeviceIdentity().deviceId;
  const devName = workerSt.deviceName || getOrCreateDeviceIdentity().deviceName;
  const maxWaSlots = clampMaxWaSlots(workerSt.user?.maxWaSlots ?? 3, workerSt.user?.role || 'master');
  const enrichedSlots = {};
  for (const id of WA_SLOT_IDS) {
    const slotObj = st.slots?.[id] || {};
    enrichedSlots[id] = {
      ...slotObj,
      slotId: id,
      workerOnline: true,
      workerPlatform: workerSt.platform,
      workerVersion: APP_VERSION,
      deviceId: slotObj.status !== 'disconnected' || whatsappManager.hasSavedSession?.(id) ? devId : null,
      deviceName: slotObj.status !== 'disconnected' || whatsappManager.hasSavedSession?.(id) ? devName : null
    };
  }
  return {
    ...st,
    slots: enrichedSlots,
    maxWaSlots,
    devices: [
      {
        deviceId: devId,
        deviceName: devName,
        platform: workerSt.platform,
        appVersion: APP_VERSION,
        activeSlots: whatsappManager.getActiveLocalSlotIds ? whatsappManager.getActiveLocalSlotIds() : ['slot_1'],
        online: true
      }
    ],
    onlineDevicesCount: 1,
    workerOnline: true,
    workerPlatform: workerSt.platform,
    workerVersion: APP_VERSION
  };
}

function getEffectiveCurrentUser(req) {
  if (req.cloudAuth?.profile) {
    const tRole = req.cloudAuth.profile.role || 'user';
    return {
      id: req.cloudAuth.authUser.id,
      username: req.cloudAuth.profile.username,
      displayName: req.cloudAuth.profile.display_name || req.cloudAuth.profile.username,
      role: req.realMasterProfile?.role === 'master' ? 'master' : tRole,
      tenantRole: tRole,
      maxWaSlots: clampMaxWaSlots(req.cloudAuth.profile.max_wa_slots, tRole),
      impersonating: Boolean(req.cloudAuth.isRemoteImpersonation),
      impersonatedBy: req.cloudAuth.impersonatedBy || null
    };
  }
  const u = cloudWorker.getStatus().user;
  return u
    ? {
        ...u,
        tenantRole: u.role,
        maxWaSlots: clampMaxWaSlots(u.maxWaSlots ?? 3, u.role),
        impersonating: false,
        impersonatedBy: null
      }
    : null;
}

function sortContactsForInbox(contactsObj = {}) {
  return Object.values(contactsObj).sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
  });
}

const evolutionContactDirectoryCache = new Map();
const EVOLUTION_CONTACT_DIRECTORY_TTL_MS = 30_000;

async function getCachedEvolutionContactDirectory(userId) {
  if (!userId) return [];
  const now = Date.now();
  const cached = evolutionContactDirectoryCache.get(userId);
  if (cached?.rows && cached.expiresAt > now) return cached.rows;
  if (cached?.promise) return cached.promise;

  const entry = { promise: null, rows: null, expiresAt: 0 };
  entry.promise = getEvolutionApiContacts(userId)
    .then((rows) => {
      entry.rows = Array.isArray(rows) ? rows : [];
      entry.expiresAt = Date.now() + EVOLUTION_CONTACT_DIRECTORY_TTL_MS;
      entry.promise = null;
      return entry.rows;
    })
    .catch((error) => {
      evolutionContactDirectoryCache.delete(userId);
      throw error;
    });
  evolutionContactDirectoryCache.set(userId, entry);
  return entry.promise;
}

function normalizeDirectoryChatId(contact = {}) {
  const raw = String(contact.chatId || '').replace(/^slot_[1-3]::/i, '').trim();
  const at = raw.lastIndexOf('@');
  if (at < 1 || at === raw.length - 1 || /\s/.test(raw)) return '';
  const local = raw.slice(0, at).replace(/:\d+$/, '');
  const domain = raw.slice(at + 1).toLowerCase();
  if (!local || !/^[a-z0-9.-]+$/i.test(domain)) return '';
  return `${local.toLowerCase()}@${domain}`;
}

function normalizeDirectoryContact(contact = {}) {
  const originalChatId = String(contact.chatId || '').trim();
  const slotPrefix = originalChatId.match(/^(slot_[1-3]::)/i)?.[1] || '';
  const rawChatId = originalChatId.replace(/^slot_[1-3]::/i, '');
  const jidPhone = /@s\.whatsapp\.net$/i.test(rawChatId) ? rawChatId.split('@')[0].split(':')[0] : '';
  const phoneCandidate = [contact.phone, jidPhone].find((value) => isLikelyRealPhone(value)) || '';
  const phone = phoneCandidate ? normalizePhoneDigits(phoneCandidate) : '';
  const name = storage.isGenericContactName(contact.name) ? '' : String(contact.name || '').trim();
  const localId = rawChatId.split('@')[0].split(':')[0];
  const isLongOpaqueId = /^\d{14,16}$/.test(rawChatId) ||
    (/@s\.whatsapp\.net$/i.test(rawChatId) && /^\d{14,16}$/.test(localId));
  const chatId = isLongOpaqueId ? `${slotPrefix}${localId}@lid` : originalChatId;
  return { ...contact, chatId, phone, name };
}

app.get('/api/bootstrap', async (req, res) => {
  storage.ensureDailyRollover();
  const ffmpegBin = usesCloudBridge(req) ? 'cloud' : await resolveFfmpegPath();
  const waState = await mergeEvolutionApiStatus(req, getEffectiveWaState(req));
  const contacts = sortContactsForInbox(storage.data.contacts);
  res.json({
    appVersion: APP_VERSION,
    runtimeMode: usesCloudBridge(req) ? 'vercel_cloud' : 'local_worker',
    currentUser: getEffectiveCurrentUser(req),
    waState,
    proactiveQueueState: usesCloudBridge(req) ? waState.proactive : whatsappManager.getProactiveQueueState(),
    audioEngineReady: Boolean(ffmpegBin),
    settings: storage.data.settings,
    geminiPoolCount: parseGeminiKeyPool(storage.data.settings.ai).length,
    business: storage.getBusiness(),
    templates: NICHE_TEMPLATES,
    trainingPacks: listTrainingPacks(),
    contacts,
    stats: storage.data.stats,
    logs: storage.data.logs,
    simulatorHistory: storage.data.simulatorHistory || []
  });
});

// A agenda da Evolution é carregada só ao abrir essa área, nunca no bootstrap ou no polling.
app.get('/api/crm/contact-directory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const userId = req.cloudAuth?.authUser?.id || cloudWorker.getStatus().user?.id || null;
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(req.query.offset, 10) || 0));
  const query = String(req.query.q || '').trim().toLocaleLowerCase('pt-BR').slice(0, 120);
  const includeUnnamed = req.query.includeUnnamed === 'true';

  try {
    const imported = await getCachedEvolutionContactDirectory(userId);
    const saved = Object.values(storage.data.contacts || {});
    const contactsById = new Map();
    for (const rawContact of saved) {
      const contact = normalizeDirectoryContact(rawContact);
      if (contact?.chatId) contactsById.set(contact.chatId, contact);
    }

    const seenBySlot = new Set();
    let hiddenUnnamed = 0;
    let invalidIds = 0;
    let duplicateIds = 0;
    for (const rawContact of saved) {
      const contact = normalizeDirectoryContact(rawContact);
      const normalized = normalizeDirectoryChatId(contact);
      if (!normalized) continue;
      const slotId = contact.slotId || String(contact.chatId).match(/^(slot_[1-3])::/i)?.[1] || 'slot_1';
      seenBySlot.add(`${slotId}|${normalized}`);
    }
    for (const rawContact of imported) {
      const contact = normalizeDirectoryContact(rawContact);
      const normalized = normalizeDirectoryChatId(contact);
      if (!normalized) {
        invalidIds += 1;
        continue;
      }
      const slotId = contact.slotId || String(contact.chatId).match(/^(slot_[1-3])::/i)?.[1] || 'slot_1';
      const dedupeKey = `${slotId}|${normalized}`;
      if (contactsById.has(contact.chatId)) {
        const existing = normalizeDirectoryContact(contactsById.get(contact.chatId));
        const existingName = String(existing.name || '').trim();
        const usefulExistingName = !storage.isGenericContactName(existingName);
        contactsById.set(contact.chatId, normalizeDirectoryContact({
          ...contact,
          ...existing,
          phone: isLikelyRealPhone(existing.phone) ? existing.phone : contact.phone,
          name: existing.savedContact && usefulExistingName ? existingName : (contact.name || (usefulExistingName ? existingName : '')),
          avatarUrl: existing.avatarUrl || contact.avatarUrl || '',
          savedContact: Boolean(existing.savedContact || contact.savedContact),
        }));
        seenBySlot.add(dedupeKey);
        duplicateIds += 1;
        continue;
      }
      if (seenBySlot.has(dedupeKey)) {
        duplicateIds += 1;
        continue;
      }
      seenBySlot.add(dedupeKey);
      if (!contact.name && !isLikelyRealPhone(contact.phone)) {
        hiddenUnnamed += 1;
        if (!includeUnnamed) continue;
      }
      contactsById.set(contact.chatId, { ...contact, slotId, directoryImport: true });
    }

    const all = [...contactsById.values()].filter((contact) => {
      if (!query) return true;
      const haystack = [contact.name, contact.phone, contact.company, contact.city, contact.email, contact.notes, contact.chatId]
        .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return haystack.includes(query);
    });
    all.sort((a, b) => {
      if (Boolean(a.savedContact) !== Boolean(b.savedContact)) return a.savedContact ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR') || String(a.chatId).localeCompare(String(b.chatId));
    });

    return res.json({
      ok: true,
      total: all.length,
      offset,
      limit,
      hasMore: offset + limit < all.length,
      cleanup: { hiddenUnnamed, invalidIds, duplicateIds },
      contacts: all.slice(offset, offset + limit)
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Não foi possível carregar a agenda do WhatsApp: ${err.message}` });
  }
});

// Somente configuração pública. A assinatura Realtime usa o JWT do usuário e RLS.
app.get('/api/cloud/realtime-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!IS_VERCEL || !req.cloudAuth?.authUser?.id || req.cloudAuth?.isRemoteImpersonation) {
    return res.status(403).json({ok:false});
  }
  return res.json({ok:true,url:SUPABASE_URL,key:SUPABASE_ANON_KEY,userId:req.cloudAuth.authUser.id});
});

// Mergea o status real da Evolution API (nuvem) no waState do worker local.
// Quando rodando na Vercel (vercel_cloud), o worker local pode estar offline,
// mas a Evolution API na nuvem pode ter instâncias conectadas. Sem esse merge,
// o painel mostra "desconectado" mesmo com WhatsApp conectado na nuvem.
async function mergeEvolutionApiStatus(req, waState) {
  if (!usesCloudBridge(req)) return waState;
  try {
    const slots = await getEvolutionApiSlotStatus(req.cloudAuth?.authUser?.id || null);
    return composeConnectionState(waState, slots);
  } catch {
    return composeConnectionState(waState, {}, { providerFailed: true });
  }
}

app.get('/api/cloud/poll', async (req, res) => {
  const waState = await mergeEvolutionApiStatus(req, getEffectiveWaState(req));
  res.json({
    ok: true,
    appVersion: APP_VERSION,
    runtimeMode: usesCloudBridge(req) ? 'vercel_cloud' : 'local_worker',
    currentUser: getEffectiveCurrentUser(req),
    waState,
    waSlots: normalizeWaSlotsSettings(storage.data.settings?.waSlots),
    proactiveQueueState: usesCloudBridge(req) ? waState.proactive : whatsappManager.getProactiveQueueState(),
    contacts: sortContactsForInbox(storage.data.contacts),
    stats: storage.data.stats,
    logs: (storage.data.logs || []).slice(0, 60)
  });
});

// ======================== DOWNLOAD DO MOTOR ATUALIZADO (.ZIP) & DOWNLOAD SEGURO DE MÍDIA/ARQUIVOS ========================

const MOTOR_SYSTEM_ROOT_FILES = new Set([
  '.env.example',
  '.npmrc',
  'package.json',
  'package-lock.json',
  'vercel.json',
  'LEIA-ME_COMO_USAR.md',
  '1_Instalar_No_Windows.bat',
  '2_Iniciar_Atendente_IA.bat',
  '3_Criar_Atalho_Area_de_Trabalho.bat',
  '4_Instalar_No_Termux.sh',
  '5_Iniciar_No_Termux.sh'
]);

const MOTOR_EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.agents',
  '.runtime',
  '.vercel',
  'uploads',
  'wa_auth',
  'tenants',
  'database.json',
  'cloud_session.json',
  'device_identity.json',
  '.wrapper.pid',
  '.last_auto_update.json',
  '.env',
  '.DS_Store'
]);

// A assinatura precisa ser igual em checkouts Windows, Linux e Vercel.
// Mantém CRLF nos arquivos de Windows/documentos e LF nos scripts Unix.
export function normalizeMotorPackageFile(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.bat', '.ps1', '.txt', '.sh'].includes(ext)) return buffer;
  const lf = buffer.toString('utf8').replace(/\r\n/g, '\n');
  return Buffer.from(ext === '.sh' ? lf : lf.replace(/\n/g, '\r\n'), 'utf8');
}

export function collectCleanMotorZipEntries(includeMasterPack = false, zipRoot = 'ZAP-IA-Studio') {
  const entries = [];
  const walkIntoZipPrefix = (absDir, zipPrefix) => {
    if (!fs.existsSync(absDir)) return;
    for (const dirent of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (MOTOR_EXCLUDED_SEGMENTS.has(dirent.name) || dirent.name.endsWith('.log') || dirent.name.endsWith('.bak')) {
        continue;
      }
      const nextAbs = path.join(absDir, dirent.name);
      const nextZipPath = `${zipPrefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        walkIntoZipPrefix(nextAbs, nextZipPath);
      } else if (dirent.isFile()) {
        entries.push({
          path: nextZipPath,
          content: normalizeMotorPackageFile(nextAbs, fs.readFileSync(nextAbs))
        });
      }
    }
  };

  // 1. Camada Institucional Externa (ZAP-IA-Studio/INICIAR_NO_WINDOWS.bat, INICIAR_NO_LINUX.sh, INICIAR_NO_TERMUX.sh, MANUAL_OFICIAL.html, LEIA-ME.txt, Ferramentas_Extras/*)
  walkIntoZipPrefix(path.join(ROOT_DIR, 'dist_kit'), zipRoot);

  // 2. Núcleo Técnico Encapsulado (ZAP-IA-Studio/sistema/*)
  for (const sysFile of MOTOR_SYSTEM_ROOT_FILES) {
    const abs = path.join(ROOT_DIR, sysFile);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      entries.push({
        path: `${zipRoot}/sistema/${sysFile}`,
        content: normalizeMotorPackageFile(abs, fs.readFileSync(abs))
      });
    }
  }

  for (const subDir of ['src', 'api', 'public', 'scripts', 'dist_kit']) {
    walkIntoZipPrefix(path.join(ROOT_DIR, subDir), `${zipRoot}/sistema/${subDir}`);
  }

  // 3. Pacote privado Lizandro vai exclusivamente para o Admin Master; clientes recebem motor 100% limpo
  if (includeMasterPack) {
    walkIntoZipPrefix(path.join(ROOT_DIR, 'data', 'training_packs'), `${zipRoot}/sistema/data/training_packs`);
  }

  return entries;
}

app.get('/api/public/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.json({
    ok: true,
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/whatsapp/update-motor', async (req, res) => {
  try {
    if (usesCloudBridge(req)) {
      const waState = getEffectiveWaState(req);
      if (!waState.workerOnline) {
        return res.status(400).json({
          ok: false,
          error: 'O Motor está offline no momento. Assim que você abri-lo no Termux, Windows ou Linux, ele já vai se atualizar sozinho na inicialização!'
        });
      }
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'update_motor_now',
        {}
      );
      return res.json({ ok: true, ...out });
    }

    // Execução local direta: dispara atualização e reinicia no loop supervisor (código 42)
    res.json({ ok: true, restartingForUpdate: true });
    setTimeout(() => {
      process.exit(42);
    }, 500);
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.get('/api/public/motor-update.zip', (_req, res) => {
  try {
    // O artefato é montado e assinado antes do deploy, não a partir dos
    // arquivos que o ambiente da Vercel pode alterar durante o build.
    const zipBuffer = fs.readFileSync(path.join(ROOT_DIR, 'release', 'motor-update.zip'));
    const archive = extractZipBuffer(zipBuffer);
    const manifestPath = 'ZAP-IA-Studio/sistema/release/update-manifest.json';
    const signaturePath = 'ZAP-IA-Studio/sistema/release/update-manifest.sig';
    const manifests = archive.files.filter(f => f.path === manifestPath);
    const signatures = archive.files.filter(f => f.path === signaturePath);
    if (manifests.length !== 1 || signatures.length !== 1 || archive.files.length < 12) {
      throw new Error('Pacote assinado incompleto ou repetido.');
    }
    const entries = archive.files.filter(f => f.path !== manifestPath && f.path !== signaturePath)
      .map(f => ({ zipPath: f.path, content: f.buffer }));
    verifySignedManifest(entries, manifests[0].buffer, signatures[0].buffer, UPDATE_PUBLIC_KEY, APP_VERSION);
    const filename = `Ienvia-v${APP_VERSION}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    return res.end(zipBuffer);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Falha ao gerar pacote público do motor: ${err.message}` });
  }
});

app.get('/api/system/download-motor', (req, res) => {
  try {
    const isMasterCaller = IS_VERCEL
      ? req.realMasterProfile?.role === 'master' && !req.cloudAuth?.isRemoteImpersonation
      : (cloudWorker.getStatus().user?.role === 'master' || !cloudWorker.getStatus().configured);

    const entries = collectCleanMotorZipEntries(Boolean(isMasterCaller), 'Ienvia');
    if (entries.length < 10) {
      return res.status(500).json({ ok: false, error: 'Pacote do motor indisponível neste ambiente.' });
    }
    const zipBuffer = createZipBuffer(entries);
    const filename = `Ienvia-v${APP_VERSION}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    return res.end(zipBuffer);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Falha ao gerar pacote do motor: ${err.message}` });
  }
});

app.get('/api/media/download', async (req, res) => {
  try {
    const rawUrl = String(req.query?.url || '').trim();
    const requestedName = String(req.query?.name || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'URL do arquivo não informada.' });
    }

    const sanitizeDownloadName = (fallbackName) => {
      const base = (requestedName || fallbackName || 'arquivo')
        .replace(/[\r\n"\\/<>|:*?]/g, '_')
        .slice(0, 120) || 'arquivo';
      const asciiFallback = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_') || 'arquivo';
      return { base, asciiFallback };
    };

    // Caso 1: Arquivo local em /uploads/<filename> (ambiente Local/Termux/Windows)
    if (rawUrl.startsWith('/uploads/')) {
      const baseFile = path.basename(rawUrl);
      if (!baseFile || baseFile !== rawUrl.slice('/uploads/'.length) || baseFile.includes('..')) {
        return res.status(400).json({ ok: false, error: 'Caminho de arquivo inválido.' });
      }
      const absFile = path.resolve(UPLOADS_DIR, baseFile);
      if (!absFile.startsWith(path.resolve(UPLOADS_DIR)) || !fs.existsSync(absFile)) {
        return res.status(404).json({ ok: false, error: 'Arquivo não encontrado no armazenamento local.' });
      }
      const { base, asciiFallback } = sanitizeDownloadName(baseFile);
      const buf = fs.readFileSync(absFile);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(base)}`
      );
      res.setHeader('Content-Length', String(buf.length));
      return res.end(buf);
    }

    // Caso 2: Arquivo em nuvem no bucket oficial Supabase zapia-media/<tenant_uid>/<file> (bloqueio total anti-SSRF e anti-cross-tenant)
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'URL de mídia inválida.' });
    }

    const supaBaseParsed = new URL(SUPABASE_URL);
    const expectedPathPrefix = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
    if (parsed.origin !== supaBaseParsed.origin || !parsed.pathname.startsWith(expectedPathPrefix)) {
      return res.status(403).json({ ok: false, error: 'Origem de arquivo bloqueada por política de segurança.' });
    }

    const relObjectPath = decodeURIComponent(parsed.pathname.slice(expectedPathPrefix.length));
    const pathParts = relObjectPath.split('/').filter(Boolean);
    const [folderTenantUid, objectFileName] = pathParts;
    if (pathParts.length !== 2 || !folderTenantUid || !objectFileName || relObjectPath.includes('..') || relObjectPath.includes('\\')) {
      return res.status(400).json({ ok: false, error: 'Caminho de objeto inválido.' });
    }

    const activeTenantUid = req.cloudAuth?.authUser?.id || cloudWorker.getStatus().user?.id || '';
    const isMasterReal = req.realMasterProfile?.role === 'master' || cloudWorker.getStatus().user?.role === 'master';
    if (activeTenantUid && folderTenantUid !== activeTenantUid && !isMasterReal) {
      return res.status(403).json({ ok: false, error: 'Acesso negado a arquivo de outra conta.' });
    }

    const upstream = await fetch(`${supaBaseParsed.origin}${expectedPathPrefix}${encodeURIComponent(folderTenantUid)}/${encodeURIComponent(objectFileName)}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(25000)
    });
    if (!upstream.ok) {
      return res.status(404).json({ ok: false, error: 'Arquivo não encontrado na nuvem.' });
    }
    const contentLen = Number(upstream.headers.get('content-length') || 0);
    if (contentLen > 36 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'Arquivo excede o limite seguro de download direto (35 MB).' });
    }
    const arrayBuf = await upstream.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const { base, asciiFallback } = sanitizeDownloadName(objectFileName);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(base)}`
    );
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Erro ao baixar arquivo: ${err.message}` });
  }
});

// ======================== WHATSAPP CONNECTION (MULTI-CHIP ATÉ 3 NÚMEROS + MULTI-APARELHO) & PROACTIVE ========================

app.post('/api/wa/connect', async (req, res) => {
  try {
    const { pairingPhone, slotId: rawSlotId, targetDeviceId } = req.body || {};
    const slotId = normalizeSlotId(rawSlotId || 'slot_1');
    const effUser = getEffectiveCurrentUser(req);
    const maxSlots = clampMaxWaSlots(effUser?.maxWaSlots ?? 3, effUser?.tenantRole || 'master');
    const slotNum = Number(slotId.slice(-1)) || 1;
    if (slotNum > maxSlots) {
      return res.status(403).json({
        ok: false,
        error: `Seu plano atual permite conectar até ${maxSlots} número(s) de WhatsApp. Solicite ao administrador a liberação do Chip ${slotNum}.`
      });
    }

    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'wa_connect',
        { pairingPhone: pairingPhone || null, slotId, targetDeviceId: targetDeviceId || null },
        9500,
        { slotId, targetDeviceId: targetDeviceId || null }
      );
      if (out?.requiresDeviceChoice) {
        return res.json(out);
      }
      const freshCtx = await loadTenantContextFromCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser,
        req.cloudAuth.profile
      ).catch(() => null);
      return res.json({
        ok: true,
        ...out,
        slotId,
        waState: freshCtx?.waRuntime || out.waState || getEffectiveWaState(req)
      });
    }

    await whatsappManager.connect(pairingPhone || null, slotId);
    res.json({ ok: true, slotId, waState: getEffectiveWaState(req) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/wa/disconnect', async (req, res) => {
  try {
    const clearSession = req.body.clearSession;
    const slotId = normalizeSlotId(req.body?.slotId || 'slot_1');
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'wa_disconnect',
        { clearSession, slotId },
        8800,
        { slotId }
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      const freshCtx = await loadTenantContextFromCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser,
        req.cloudAuth.profile
      ).catch(() => null);
      return res.json({ ok: true, slotId, waState: freshCtx?.waRuntime || out.waState || getEffectiveWaState(req) });
    }
    await whatsappManager.disconnect(clearSession, slotId);
    res.json({ ok: true, slotId, waState: getEffectiveWaState(req) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/wa/slot-config', async (req, res) => {
  try {
    const slotId = normalizeSlotId(req.body?.slotId || 'slot_1');
    const currentSlots = normalizeWaSlotsSettings(storage.data.settings?.waSlots);
    const prev = currentSlots[slotId] || { label: `Chip ${slotId.slice(-1)}`, aiEnabled: true };
    const nextLabel =
      req.body?.label !== undefined
        ? (String(req.body.label || '').trim().slice(0, 42) || `Chip ${slotId.slice(-1)}`)
        : prev.label;
    const nextAiEnabled =
      req.body?.aiEnabled !== undefined ? req.body.aiEnabled : prev.aiEnabled !== false;

    currentSlots[slotId] = { label: nextLabel, aiEnabled: nextAiEnabled };
    storage.data.settings.waSlots = currentSlots;
    storage.writeNow();
    storage.addLog(
      'info',
      `[${nextLabel}] Configuração atualizada — IA automática neste chip: ${nextAiEnabled ? 'ATIVADA' : 'PAUSADA'}.`
    );

    if (usesCloudBridge(req) && req.cloudAuth?.client && req.cloudAuth?.authUser?.id) {
      try {
        const saved = await req.cloudAuth.client
          .from('zapia_wa_slots')
          .update({ label: nextLabel, ai_enabled: nextAiEnabled, updated_at: trueNowIso() })
          .eq('user_id', req.cloudAuth.authUser.id)
          .eq('slot_id', slotId);
        if(saved.error)throw new Error('Falha ao persistir configuração do chip. Consulte antes de tentar novamente.');
      } catch (e) { return res.status(503).json({ok:false,error:'Configuração sem confirmação de gravação. Consulte o estado antes de tentar novamente.'}); }
      if (req.cloudAuth.tenantStore?.waRuntime?.slots?.[slotId]) {
        req.cloudAuth.tenantStore.waRuntime.slots[slotId].label = nextLabel;
        req.cloudAuth.tenantStore.waRuntime.slots[slotId].aiEnabled = nextAiEnabled;
      }
    } else if (!IS_VERCEL) {
      whatsappManager.emitState();
    }

    res.json({
      ok: true,
      slotId,
      waSlots: currentSlots,
      waState: getEffectiveWaState(req)
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/wa/device-rename', async (req, res) => {
  try {
    const deviceName = String(req.body?.deviceName || '').trim().slice(0, 60);
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!deviceName) {
      return res.status(400).json({ ok: false, error: 'Informe o apelido do aparelho (ex: Celular Recepção).' });
    }
    if (usesCloudBridge(req)) {
      if (!deviceId) return res.status(400).json({ ok: false, error: 'Informe qual aparelho deseja renomear.' });
      await req.cloudAuth.client
        .from('zapia_worker_devices')
        .update({ device_label: deviceName, updated_at: trueNowIso() })
        .eq('user_id', req.cloudAuth.authUser.id)
        .eq('device_id', deviceId);
      await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'rename_worker_device',
        { deviceName },
        4500,
        { targetDeviceId: deviceId }
      ).catch(() => {});
      const freshCtx = await loadTenantContextFromCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser,
        req.cloudAuth.profile
      ).catch(() => null);
      return res.json({ ok: true, waState: freshCtx?.waRuntime || getEffectiveWaState(req) });
    }
    renameLocalDeviceIdentity(deviceName);
    await cloudWorker.pushRuntimeHeartbeat?.().catch(() => {});
    res.json({ ok: true, waState: getEffectiveWaState(req) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/wa/sync-history', async (req, res) => {
  try {
    const slotId = req.body?.slotId ? normalizeSlotId(req.body.slotId) : null;
    if (usesCloudBridge(req) && !getEffectiveWaState(req).workerOnline) {
      const offset = Math.max(0, Math.min(100_000, Number(req.body?.offset) || 0));
      const pageSize = 200;
      const directory = await getEvolutionApiChats(req.cloudAuth.authUser.id, { limit:pageSize, offset });
      const remoteChats = (directory.chats || []).filter((chat) => !slotId || normalizeSlotId(chat.slotId) === slotId);
      for (const chat of remoteChats) {
        const existingKey = storage.findSiblingContactKey(chat.chatId) || chat.chatId;
        const existing = storage.data.contacts[existingKey];
        // Refresh names even for existing rows: old generic/numeric names otherwise
        // survive forever because the previous path only inserted missing contacts.
        if (!existing || chat.name || chat.lastMessageAt) {
          storage.upsertContact(chat.chatId, {
            ...(chat.name ? { name: String(chat.name).slice(0, 120) } : {}),
            ...(isLikelyRealPhone(chat.phone) ? { phone: normalizePhoneDigits(chat.phone) } : {}),
            ...(chat.lastMessageAt ? { lastMessageAt: chat.lastMessageAt } : {}),
            slotId: chat.slotId
          }, { deferSave:true, preferAddressBookName:true });
        }
      }
      let requested = 0;
      let importedMessages = 0;
      let failures = 0;
      const batch = remoteChats.filter((chat) => {
        const key = storage.findSiblingContactKey(chat.chatId) || chat.chatId;
        return storage.data.contacts[key]?.evolutionApiHistoryComplete !== true;
      }).slice(0, 15);
      for (const chat of batch) {
        const key = storage.findSiblingContactKey(chat.chatId) || chat.chatId;
        const contact = storage.data.contacts[key];
        const anchor = (contact?.messages || []).filter((m) => m.waMsgId).sort((a,b) => Date.parse(a.timestamp||0)-Date.parse(b.timestamp||0))[0];
        const page = Math.max(1, Number(contact?.evolutionApiHistoryNextPage) || 1);
        try {
          const result = await requestEvolutionApiHistory(req.cloudAuth.authUser.id, chat.chatId, 50, { id:anchor?.waMsgId || '', isFromMe:anchor?.role !== 'user', timestamp:anchor?.timestamp || '' }, page);
          const merged = mergeEvolutionApiHistoryPage(storage, chat.chatId, result, { page, pageSize:50 });
          importedMessages += merged.countAdded;
          requested++;
        } catch { failures++; }
      }
      const remainingInPage = remoteChats.filter((chat) => {
        const key = storage.findSiblingContactKey(chat.chatId) || chat.chatId;
        return storage.data.contacts[key]?.evolutionApiHistoryComplete !== true;
      }).length;
      const nextOffset = remainingInPage === 0 && directory.hasMore ? offset + pageSize : offset;
      return res.json({ ok:true, provider:'evolution_api', requested, importedMessages, totalContacts:remoteChats.length, partial:failures > 0 || remainingInPage > 0 || directory.hasMore, nextOffset, contacts:sortContactsForInbox(storage.data.contacts), message:`${importedMessages} mensagem(ns) de histórico importada(s) diretamente da Evolution API.` });
    }
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'wa_sync_history',
        { waitMs: Number(req.body?.waitMs) || 6800, ...(slotId ? { slotId } : {}) },
        11800,
        slotId ? { slotId } : {}
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      const freshCtx = await loadTenantContextFromCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser,
        req.cloudAuth.profile
      ).catch(() => null);
      return res.json({
        ok: true,
        ...out,
        contacts: freshCtx ? sortContactsForInbox(freshCtx.data.contacts) : undefined
      });
    }
    const result = await whatsappManager.syncAllConversationsFromPhone({
      force: true,
      waitMs: Number(req.body?.waitMs) || 6500,
      slotId
    });
    res.json({ ok: true, ...result, contacts: sortContactsForInbox(storage.data.contacts) });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/wa/toggle-bot', (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled deve ser booleano (true ou false).' });
  const enabled = req.body.enabled;
  storage.data.settings.botEnabled = enabled;
  storage.writeNow();
  storage.addLog('info', enabled ? 'Atendimento automático ATIVADO.' : 'Atendimento automático PAUSADO globalmente.');
  if (!usesCloudBridge(req)) whatsappManager.emitState();
  res.json({ ok: true, botEnabled: enabled });
});

app.post('/api/wa/test-owner-alert', async (req, res) => {
  try {
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'wa_test_owner_alert',
        { phone: req.body?.phone }
      );
      return res.json({ ok: true, ...out });
    }
    const result = await whatsappManager.sendTestAlertToOwner(req.body?.phone);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/wa/proactive-send', async (req, res) => {
  try {
    const { phone, text, name, voiceId, channelMode: rawMode } = req.body || {};
    const channelMode = WA_SLOT_IDS.includes(rawMode) ? rawMode : 'auto_rotate';
    if (!phone || (!String(text || '').trim() && !voiceId)) {
      return res.status(400).json({ ok: false, error: 'Informe o telefone com DDD e uma mensagem de texto ou áudio estratégico.' });
    }
    const cleanName = (name || 'Contato Abordado').trim();
    const personalizedText = String(text || '')
      .replace(/\{\{\s*nome\s*\}\}/gi, cleanName !== 'Contato Abordado' ? cleanName.split(' ')[0] : '')
      .replace(/\{\s*nome\s*\}/gi, cleanName !== 'Contato Abordado' ? cleanName.split(' ')[0] : '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (usesCloudBridge(req) && !getEffectiveWaState(req).workerOnline) {
      if (voiceId) return res.status(503).json({ ok:false, workerOffline:true, error:'O envio de áudio estratégico exige o Motor WhatsApp online. Envie texto ou conecte o Motor.' });
      const digits = String(phone).replace(/\D/g, '');
      const jid = `${digits}@s.whatsapp.net`;
      const destination = WA_SLOT_IDS.includes(channelMode) && channelMode !== 'slot_1' ? `${channelMode}::${jid}` : jid;
      const sendResult = await sendEvolutionApiText(req.cloudAuth.authUser.id, destination, personalizedText);
      const messageId = sendResult?.data?.key?.id || sendResult?.key?.id || sendResult?.data?.id || sendResult?.id || '';
      const contact = storage.appendContactMessage(destination, { role:'owner', text:personalizedText, contactName:cleanName, phone:digits, deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}) });
      return res.json({ ok:true, contact, sentRealWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
    }
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_proactive',
        { phone, text: personalizedText, name: cleanName, voiceId: voiceId || '', channelMode },
        9500,
        WA_SLOT_IDS.includes(channelMode) ? { slotId: channelMode } : {}
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({ ok: true, ...out });
    }
    const result = await whatsappManager.sendProactiveAiOpening(phone, personalizedText, cleanName, voiceId || '', channelMode);
    res.json({ ok: true, ...result, stats: storage.data.stats });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.get('/api/wa/proactive-queue', (req, res) => {
  const waState = getEffectiveWaState(req);
  res.json({ ok: true, queue: usesCloudBridge(req) ? waState.proactive : whatsappManager.getProactiveQueueState() });
});

app.post('/api/wa/proactive-queue/start', async (req, res) => {
  try {
    const { leads, text, channelMode: rawMode } = req.body || {};
    const channelMode = WA_SLOT_IDS.includes(rawMode) ? rawMode : 'auto_rotate';
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'queue_start',
        { leads: Array.isArray(leads) ? leads : [], text: text || '', channelMode },
        9500,
        WA_SLOT_IDS.includes(channelMode) ? { slotId: channelMode } : {}
      );
      return res.json({ ok: true, queue: out.queue });
    }
    const state = whatsappManager.enqueueProactiveBatch(Array.isArray(leads) ? leads : [], text || '', channelMode);
    res.json({ ok: true, queue: state });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/wa/proactive-queue/pause', async (req, res) => {
  try {
    const paused = req.body?.paused !== false;
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'queue_pause',
        { paused }
      );
      return res.json({ ok: true, queue: out.queue });
    }
    const state = whatsappManager.pauseProactiveQueue(paused);
    res.json({ ok: true, queue: state });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/wa/proactive-queue/clear', async (req, res) => {
  try {
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'queue_clear',
        {}
      );
      return res.json({ ok: true, queue: out.queue });
    }
    const state = whatsappManager.clearProactiveQueue();
    res.json({ ok: true, queue: state });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

// ======================== CONFIGURAÇÕES & TESTE IA ========================

app.put('/api/settings', (req, res) => {
  const incoming = req.body || {};
  storage.data.settings = {
    ...storage.data.settings,
    ...incoming,
    branding: { ...storage.data.settings.branding, ...(incoming.branding || {}) },
    ai: { ...storage.data.settings.ai, ...(incoming.ai || {}) },
    antiBan: { ...storage.data.settings.antiBan, ...(incoming.antiBan || {}) },
    humanHandoff: { ...storage.data.settings.humanHandoff, ...(incoming.humanHandoff || {}) },
    schedule: { ...storage.data.settings.schedule, ...(incoming.schedule || {}) },
    waSlots: normalizeWaSlotsSettings(incoming.waSlots || storage.data.settings.waSlots)
  };
  delete storage.data.settings.activeProfileId;
  storage.writeNow();
  storage.addLog('info', 'Configurações do sistema atualizadas.');
  if (!IS_VERCEL) whatsappManager.emitState();
  res.json({
    ok: true,
    settings: storage.data.settings,
    geminiPoolCount: parseGeminiKeyPool(storage.data.settings.ai).length
  });
});

app.post('/api/ai/test', async (req, res) => {
  const start = Date.now();
  try {
    const tempSettings = {
      ...storage.data.settings,
      ai: { ...storage.data.settings.ai, ...(req.body?.ai || {}) }
    };
    const business = storage.getBusiness();
    const reply = await generateSmartReply({
      profile: business,
      settings: tempSettings,
      history: [],
      userText: 'Olá! Responda em uma frase curta confirmando que está online e pronto para atender.',
      contactName: 'Teste do Painel',
      allowDemoFallback: false
    });
    const latencyMs = Date.now() - start;
    res.json({
      ok: true,
      latencyMs,
      provider: reply.providerUsed,
      model: reply.modelUsed,
      keyPoolSize: reply.keyPoolSize || 1,
      usedFallback: Boolean(reply.usedFallback),
      sampleReply: reply.cleanText,
      stats: storage.data.stats
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ======================== CÉREBRO ÚNICO DE NEGÓCIO & TREINAMENTO ========================

app.get('/api/business', (_req, res) => {
  res.json({ ok: true, business: storage.getBusiness() });
});

app.put('/api/business', (req, res) => {
  const current = storage.getBusiness();
  const patch = req.body || {};

  storage.data.business = {
    ...current,
    ...patch,
    id: 'business_unico',
    pix: { ...current.pix, ...(patch.pix || {}) },
    catalog: Array.isArray(patch.catalog) ? patch.catalog.map(normalizeCatalogItem) : current.catalog,
    faqs: Array.isArray(patch.faqs) ? patch.faqs : current.faqs,
    knowledgeDocs: Array.isArray(patch.knowledgeDocs) ? patch.knowledgeDocs : current.knowledgeDocs,
    updatedAt: trueNowIso()
  };

  storage.writeNow();
  storage.addLog('info', `Treinamento principal ("${storage.data.business.name}") salvo.`);
  res.json({ ok: true, business: storage.data.business });
});

app.post('/api/business/apply-template', (req, res) => {
  const { templateId, keepCatalogAndPix = true } = req.body || {};
  const updated = storage.applyTemplateToBusiness(templateId, keepCatalogAndPix);
  storage.addLog('info', `Modelo base aplicado ao treinamento: "${updated.name}" (${updated.niche}).`);
  res.json({ ok: true, business: updated });
});

app.get('/api/business/export.zip', (_req, res) => {
  const biz = storage.getBusiness();
  try {
    const { filename, buffer } = exportProfileBundleZip(biz);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/business/system-prompt', (req, res) => {
  const biz = storage.getBusiness();
  const sampleQuery = req.query?.q || 'É só tráfego pago ou vocês fazem conteúdo também?';
  const prompt = buildSystemPrompt(biz, storage.data.settings, 'Lojista Exemplo', {
    userText: String(sampleQuery),
    history: []
  });
  res.json({ ok: true, prompt });
});

// ======================== PACOTES DE TREINAMENTO TURBO (.ZIP) + EDITOR VISUAL ========================

app.get('/api/training-packs/:packId', (req, res) => {
  const pack = getTrainingPack(req.params.packId);
  if (!pack) return res.status(404).json({ ok: false, error: 'Pacote de treinamento não encontrado.' });
  res.json({ ok: true, pack: summarizePack(pack) });
});

app.get('/api/training-packs/:packId/full', (req, res) => {
  const details = getFullTrainingPackDetails(req.params.packId);
  if (!details) return res.status(404).json({ ok: false, error: 'Pacote de treinamento não encontrado.' });
  res.json({ ok: true, pack: details });
});

app.post('/api/training-packs/:packId/messages', (req, res) => {
  try {
    const details = saveApprovedMessage(req.params.packId, req.body || {});
    storage.addLog('info', `Mensagem aprovada (${req.body?.id || 'nova'}) salva no pacote ${req.params.packId}.`);
    res.json({ ok: true, pack: details, trainingPacks: listTrainingPacks() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/training-packs/:packId/messages/:msgId', (req, res) => {
  try {
    const details = deleteApprovedMessage(req.params.packId, req.params.msgId);
    res.json({ ok: true, pack: details, trainingPacks: listTrainingPacks() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/training-packs/:packId/skills', (req, res) => {
  try {
    const details = savePackSkill(req.params.packId, req.body || {});
    storage.addLog('info', `Skill (${req.body?.name || req.body?.id || 'nova'}) salva no pacote ${req.params.packId}.`);
    res.json({ ok: true, pack: details, trainingPacks: listTrainingPacks() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/training-packs/:packId/skills/:skillId', (req, res) => {
  try {
    const type = req.query?.type === 'humanization' ? 'humanization' : 'operational';
    const details = deletePackSkill(req.params.packId, req.params.skillId, type);
    res.json({ ok: true, pack: details, trainingPacks: listTrainingPacks() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

function applyImportedTrainingResult({ packSummary, suggestedProfile }) {
  const current = storage.getBusiness();
  storage.data.business = {
    ...current,
    ...suggestedProfile,
    id: 'business_unico',
    trainingPackId: packSummary.id,
    lockUntilManualResume: suggestedProfile.lockUntilManualResume !== false,
    promptShieldEnabled: suggestedProfile.promptShieldEnabled !== false,
    // Preserva catálogo e chave PIX atuais caso o pacote importado não traga seus próprios
    catalog:
      Array.isArray(suggestedProfile.catalog) && suggestedProfile.catalog.length > 0
        ? suggestedProfile.catalog.map(normalizeCatalogItem)
        : current.catalog,
    pix: suggestedProfile.pix?.key ? { ...current.pix, ...suggestedProfile.pix } : current.pix,
    voiceLibrary: Array.isArray(current.voiceLibrary) ? current.voiceLibrary : [],
    knowledgeDocs:
      Array.isArray(suggestedProfile.knowledgeDocs) && suggestedProfile.knowledgeDocs.length > 0
        ? suggestedProfile.knowledgeDocs
        : current.knowledgeDocs,
    updatedAt: trueNowIso()
  };

  storage.writeNow();
  storage.addLog(
    'info',
    `Treinamento "${packSummary.name}" ativado no Cérebro Único (${packSummary.stats.operationalSkillsCount + packSummary.stats.humanizationSkillsCount} skills, ${packSummary.stats.approvedMessagesCount || 0} msgs).`
  );
  return storage.data.business;
}

app.post('/api/training-packs/import-zip', memUpload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: 'Selecione um arquivo .ZIP, .JSON ou .MD válido.' });
    }
    const result = importTrainingUniversal(req.file.buffer, req.file.originalname);
    const business = applyImportedTrainingResult(result);

    res.json({
      ok: true,
      packSummary: result.packSummary,
      business,
      trainingPacks: listTrainingPacks()
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Falha ao importar treinamento: ${err.message}` });
  }
});

app.post('/api/training-packs/import-text', (req, res) => {
  try {
    const rawText = String(req.body?.text || '').trim();
    const filename = String(req.body?.filename || 'blueprint-chatgpt.json').trim();
    if (!rawText) {
      return res.status(400).json({ ok: false, error: 'Cole o código JSON ou Markdown gerado pelo ChatGPT/IA primeiro.' });
    }
    const result = importTrainingUniversal(rawText, filename);
    const business = applyImportedTrainingResult(result);

    res.json({
      ok: true,
      packSummary: result.packSummary,
      business,
      trainingPacks: listTrainingPacks()
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Falha ao aplicar treinamento colado: ${err.message}` });
  }
});

app.post('/api/business/knowledge-upload', memUpload.single('file'), (req, res) => {
  const biz = storage.getBusiness();
  let title = req.body?.title || '';
  let content = req.body?.content || '';

  if (req.file) {
    title = title || req.file.originalname;
    content = req.file.buffer.toString('utf-8').slice(0, 30000);
  }

  if (!content.trim()) {
    return res.status(400).json({ ok: false, error: 'O documento enviado está vazio.' });
  }

  const doc = {
    id: uid('doc'),
    title: title || 'Documento de Treinamento',
    content: content.trim(),
    createdAt: new Date().toISOString()
  };

  biz.knowledgeDocs = biz.knowledgeDocs || [];
  biz.knowledgeDocs.push(doc);
  storage.writeNow();
  res.json({ ok: true, doc, business: biz });
});

app.delete('/api/business/knowledge/:docId', (req, res) => {
  const biz = storage.getBusiness();
  biz.knowledgeDocs = (biz.knowledgeDocs || []).filter(d => d.id !== req.params.docId);
  storage.writeNow();
  res.json({ ok: true, business: biz });
});

// ======================== CATÁLOGO MULTI-FOTOS/PDFs & PREVIEW PIX QR ========================

app.post('/api/pix/preview', async (req, res) => {
  try {
    const pixCfg = { enabled: true, sendQrImage: true, ...(req.body?.pix || {}) };
    if (!pixCfg.key) return res.status(400).json({ ok: false, error: 'Informe uma chave PIX para gerar a prévia.' });
    const out = await formatPixMessageWithQr(pixCfg, req.body?.amount || null);
    res.json({
      ok: true,
      summaryText: out?.summaryText || '',
      brcode: out?.brcode || '',
      qrDataUrl: out?.qrDataUrl || null
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

function getActiveCloudClientAndUser(req) {
  if (req.cloudAuth?.client && req.cloudAuth?.authUser?.id) {
    return { client: req.cloudAuth.client, userId: req.cloudAuth.authUser.id };
  }
  if (!IS_VERCEL && cloudWorker.client && cloudWorker.user?.id) {
    return { client: cloudWorker.client, userId: cloudWorker.user.id };
  }
  return { client: null, userId: null };
}

app.post('/api/business/catalog', diskUpload.array('media', 5), async (req, res) => {
  const biz = storage.getBusiness();
  const { client, userId } = getActiveCloudClientAndUser(req);

  const uploadedFiles = [];
  for (const f of req.files || []) {
    let mediaUrl = `/uploads/${f.filename}`;
    if (client && userId && f.path && fs.existsSync(f.path)) {
      const pubUrl = await uploadMediaBufferToCloud(client, userId, f.filename, fs.readFileSync(f.path), f.mimetype);
      if (pubUrl) mediaUrl = pubUrl;
    }
    uploadedFiles.push({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      url: mediaUrl
    });
  }

  const newItem = normalizeCatalogItem({
    id: uid('item'),
    name: (req.body?.name || 'Novo Item').trim(),
    category: (req.body?.category || 'Produto').trim(),
    price: (req.body?.price || '').trim(),
    description: (req.body?.description || '').trim(),
    paymentLink: (req.body?.paymentLink || '').trim(),
    mediaFiles: uploadedFiles,
    active: true
  });

  biz.catalog = biz.catalog || [];
  biz.catalog.push(newItem);
  storage.writeNow();
  storage.addLog('info', `Item "${newItem.name}" (${uploadedFiles.length} mídia(s)) adicionado ao catálogo.`);
  res.json({ ok: true, item: newItem, business: biz });
});

app.put('/api/business/catalog/:itemId', diskUpload.array('media', 5), async (req, res) => {
  const biz = storage.getBusiness();
  const idx = (biz.catalog || []).findIndex(it => it.id === req.params.itemId);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Item não encontrado.' });

  const { client, userId } = getActiveCloudClientAndUser(req);
  const item = normalizeCatalogItem(biz.catalog[idx]);

  if (req.body?.name !== undefined) item.name = req.body.name.trim();
  if (req.body?.category !== undefined) item.category = req.body.category.trim();
  if (req.body?.price !== undefined) item.price = req.body.price.trim();
  if (req.body?.description !== undefined) item.description = req.body.description.trim();
  if (req.body?.paymentLink !== undefined) item.paymentLink = req.body.paymentLink.trim();
  if (req.body?.active !== undefined) item.active = req.body.active === 'true' || req.body.active === true;

  if (req.body?.removeFilename) {
    const fname = path.basename(String(req.body.removeFilename));
    const owned = (item.mediaFiles || []).some(mf => mf.filename === fname);
    item.mediaFiles = (item.mediaFiles || []).filter(mf => mf.filename !== fname);
    if (owned && fname) {
      const oldPath = path.join(UPLOADS_DIR, fname);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }

  if (req.body?.removeAllMedia === 'true') {
    for (const mf of item.mediaFiles || []) {
      const oldPath = path.join(UPLOADS_DIR, mf.filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    item.mediaFiles = [];
  }

  if (req.files && req.files.length > 0) {
    const replaceMode = req.body?.replaceMedia === 'true';
    if (replaceMode) {
      for (const mf of item.mediaFiles || []) {
        const oldPath = path.join(UPLOADS_DIR, mf.filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      item.mediaFiles = [];
    }
    for (const f of req.files) {
      if (item.mediaFiles.length >= 5) break;
      let mediaUrl = `/uploads/${f.filename}`;
      if (client && userId && f.path && fs.existsSync(f.path)) {
        const pubUrl = await uploadMediaBufferToCloud(client, userId, f.filename, fs.readFileSync(f.path), f.mimetype);
        if (pubUrl) mediaUrl = pubUrl;
      }
      item.mediaFiles.push({
        filename: f.filename,
        originalName: f.originalname,
        mimeType: f.mimetype,
        url: mediaUrl
      });
    }
  }

  item.mediaFile = item.mediaFiles[0] || null;
  biz.catalog[idx] = item;
  storage.writeNow();
  res.json({ ok: true, item, business: biz });
});

app.patch('/api/business/catalog/:itemId/toggle', (req, res) => {
  const biz = storage.getBusiness();
  const item = (biz.catalog || []).find(it => it.id === req.params.itemId);
  if (!item) return res.status(404).json({ ok: false, error: 'Item não encontrado.' });
  item.active = req.body?.active !== undefined ? Boolean(req.body.active) : !item.active;
  storage.writeNow();
  res.json({ ok: true, item, business: biz });
});

app.delete('/api/business/catalog/:itemId', (req, res) => {
  const biz = storage.getBusiness();
  const idx = (biz.catalog || []).findIndex(it => it.id === req.params.itemId);
  if (idx !== -1) {
    const [removed] = biz.catalog.splice(idx, 1);
    const files = removed?.mediaFiles?.length ? removed.mediaFiles : (removed?.mediaFile ? [removed.mediaFile] : []);
    for (const mf of files) {
      if (mf?.filename) {
        const fpath = path.join(UPLOADS_DIR, mf.filename);
        if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
      }
    }
  }
  storage.writeNow();
  res.json({ ok: true, business: biz });
});

// ======================== CONTATOS IGNORADOS (FAMÍLIA / PESSOAL) ========================

app.post('/api/ignored-contacts', (req, res) => {
  const phone = normalizePhoneDigits(req.body?.phone || '');
  const name = (req.body?.name || 'Contato Pessoal').trim();
  const note = (req.body?.note || '').trim();

  if (phone.length < 8) {
    return res.status(400).json({ ok: false, error: 'Informe um número de telefone válido com DDD.' });
  }

  storage.data.settings.ignoredContacts = storage.data.settings.ignoredContacts || [];
  const exists = storage.data.settings.ignoredContacts.find(c => normalizePhoneDigits(c.phone) === phone);
  if (!exists) {
    storage.data.settings.ignoredContacts.push({
      id: uid('ign'),
      phone,
      name,
      note,
      createdAt: new Date().toISOString()
    });
    storage.writeNow();
  }
  res.json({ ok: true, ignoredContacts: storage.data.settings.ignoredContacts });
});

app.delete('/api/ignored-contacts/:id', (req, res) => {
  storage.data.settings.ignoredContacts = (storage.data.settings.ignoredContacts || []).filter(
    c => c.id !== req.params.id
  );
  storage.writeNow();
  res.json({ ok: true, ignoredContacts: storage.data.settings.ignoredContacts });
});

// ======================== CRM & ATENDIMENTO HUMANO RICO ========================

app.post('/api/crm/demo-seed', (_req, res) => {
  const biz = storage.getBusiness() || {};
  const bizName = String(biz.name || 'Nossa Empresa').trim();
  const agentName = String(biz.assistantName || 'Atendimento Comercial').trim();
  const samples = [
    {
      chatId: 'demo_5586999112233@s.whatsapp.net',
      phone: '5586999112233',
      name: 'Marcos Oliveira (Exemplo)',
      stage: 'aguardando_humano',
      unreadAlert: true,
      unreadCount: 1,
      tags: ['Quente', 'Pediu Proposta'],
      followUpAt: null,
      summary: 'Demonstrou alto interesse e pediu condições especiais para fechar hoje.',
      pausedUntil: 'forever',
      pauseReason: 'Passagem humana comercial (fechamento)',
      messages: [
        { id: uid('m'), role: 'assistant', text: `Oi! Tudo bem? Aqui é ${agentName}, da ${bizName}. Como posso te ajudar hoje?`, timestamp: new Date(Date.now() - 600000).toISOString() },
        { id: uid('m'), role: 'user', text: 'Gostei bastante! Quero fechar ainda hoje, como funciona o pagamento e condições?', timestamp: new Date(Date.now() - 300000).toISOString() },
        { id: uid('m'), role: 'assistant', text: 'Perfeito, Marcos! Já organizei tudo aqui para finalizar pessoalmente com você em instantes.', timestamp: new Date(Date.now() - 290000).toISOString() }
      ]
    },
    {
      chatId: 'demo_5586988445566@s.whatsapp.net',
      phone: '5586988445566',
      name: 'Renata Souza (Exemplo)',
      stage: 'em_atendimento',
      unreadAlert: false,
      unreadCount: 0,
      tags: ['Qualificado', 'Retorno S19'],
      followUpAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      summary: 'Pediu para retomar a conversa amanhã às 10h.',
      pausedUntil: null,
      pauseReason: '',
      messages: [
        { id: uid('m'), role: 'user', text: 'Vocês atendem com agendamento rápido durante a semana?', timestamp: new Date(Date.now() - 180000).toISOString() },
        { id: uid('m'), role: 'assistant', text: 'Atendemos sim, Renata! Qual período fica mais confortável para você: manhã ou tarde?', timestamp: new Date(Date.now() - 170000).toISOString() }
      ]
    }
  ];

  for (const s of samples) {
    storage.data.contacts[s.chatId] = {
      ...s,
      notes: '',
      createdAt: new Date().toISOString(),
      lastMessageAt: s.messages[s.messages.length - 1].timestamp
    };
    storage.deletedContactIds.delete(s.chatId);
    storage.dirtyContactIds.add(s.chatId);
  }
  storage.writeNow();
  res.json({
    ok: true,
    contacts: Object.values(storage.data.contacts)
  });
});

app.get('/api/crm/export.csv', (_req, res) => {
  const contacts = Object.values(storage.data.contacts);
  const stageLabels = {
    novo: 'Novo',
    em_atendimento: 'Em Atendimento IA',
    aguardando_humano: 'Aguardando Humano',
    concluido: 'Pedido / Concluido'
  };

  // Blindagem CWE-1236 contra CSV Formula Injection no Excel/LibreOffice (=, +, -, @)
  const escapeCsv = val => {
    let clean = String(val ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t\r]/.test(clean)) clean = `'${clean}`;
    return `"${clean}"`;
  };
  const header = ['Nome', 'Telefone', 'Etapa CRM', 'Status IA', 'Etiquetas', 'Retorno Agendado', 'Resumo / Interesse', 'Observacoes', 'Ultima Mensagem'];
  const rows = contacts.map(c => {
    const paused = storage.isContactPaused(c.chatId, c.phone) ? 'Pausada (Humano)' : 'IA Ativa';
    const lastDate = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('pt-BR') : '';
    const followStr = c.followUpAt ? new Date(c.followUpAt).toLocaleString('pt-BR') : '';
    return [
      escapeCsv(c.name),
      escapeCsv(c.phone),
      escapeCsv(stageLabels[c.stage] || c.stage),
      escapeCsv(paused),
      escapeCsv((c.tags || []).join(', ')),
      escapeCsv(followStr),
      escapeCsv(c.summary || ''),
      escapeCsv(c.notes || ''),
      escapeCsv(lastDate)
    ].join(';');
  });

  const csvContent = '\uFEFF' + [header.join(';'), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clientes_crm_whatsapp.csv"');
  res.send(csvContent);
});

// ======================== RESPOSTAS RÁPIDAS (ATALHOS "/") ========================

app.get('/api/quick-replies', (_req, res) => {
  res.json({ ok: true, quickReplies: storage.getQuickReplies() });
});

app.post('/api/quick-replies', (req, res) => {
  const shortcut = String(req.body?.shortcut || '').trim();
  const title = String(req.body?.title || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!shortcut || !text) {
    return res.status(400).json({ ok: false, error: 'Informe o atalho (ex: pix) e o texto da resposta rápida.' });
  }
  const saved = storage.saveQuickReply({ id: req.body?.id, shortcut, title, text });
  res.json({ ok: true, item: saved, quickReplies: storage.getQuickReplies(), business: storage.getBusiness() });
});

app.delete('/api/quick-replies/:id', (req, res) => {
  const removed = storage.deleteQuickReply(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Resposta rápida não encontrada.' });
  res.json({ ok: true, quickReplies: storage.getQuickReplies(), business: storage.getBusiness() });
});

// ======================== INBOX PRO & CRM OPERAÇÕES AVANÇADAS ========================

app.post('/api/crm/new-contact', (req, res) => {
  const rawPhone = normalizePhoneDigits(req.body?.phone || '');
  const name = String(req.body?.name || '').trim() || 'Novo Contato';
  const slotId = normalizeSlotId(req.body?.slotId || 'slot_1');
  if (!rawPhone || rawPhone.length < 10) {
    return res.status(400).json({ ok: false, error: 'Informe um telefone válido com DDD (ex: 5586999887766).' });
  }
  const fullPhone = rawPhone.startsWith('55') || rawPhone.length >= 12 ? rawPhone : `55${rawPhone}`;
  const candidateKey = buildContactChannelKey(slotId, `${fullPhone}@s.whatsapp.net`);
  const existingKey = storage.findSiblingContactKey(candidateKey, fullPhone);
  const chatId = existingKey || candidateKey;
  const contact = storage.upsertContact(chatId, {
    slotId,
    name,
    forceName: true,
    savedContact: true,
    phone: fullPhone,
    company: req.body?.company !== undefined ? String(req.body.company || '').trim() : undefined,
    email: req.body?.email !== undefined ? String(req.body.email || '').trim() : undefined,
    docNumber: req.body?.docNumber !== undefined ? String(req.body.docNumber || '').trim() : undefined,
    city: req.body?.city !== undefined ? String(req.body.city || '').trim() : undefined,
    leadSource: req.body?.leadSource !== undefined ? String(req.body.leadSource || '').trim() : undefined,
    stage: req.body?.stage || storage.data.contacts?.[chatId]?.stage || 'novo',
    notes: req.body?.notes !== undefined ? String(req.body.notes || '').trim() : undefined,
    tags: Array.isArray(req.body?.tags) ? req.body.tags : undefined,
    archived: false
  });
  storage.writeNow();
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.get('/api/crm/contacts.vcf', (req, res) => {
  const savedOnly = req.query.savedOnly === '1';
  const list = Object.values(storage.data.contacts || {}).filter((c) => !savedOnly || c.savedContact);
  const vcfContent = list.map((c) => buildContactVCard(c)).join('\r\n');
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agenda_contatos_ienvia.vcf"');
  res.send(vcfContent || buildContactVCard({ name: 'Ienvia Agenda Vazia', phone: '' }));
});

app.put('/api/crm/:chatId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  if (!storage.data.contacts[key]) {
    return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  }
  const body = req.body || {};
  const patch = {
    ...body,
    ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim(), forceName: true } : {})
  };
  const updated = storage.upsertContact(key, patch);
  broadcast('crm_updated', {});
  res.json({ ok: true, contact: updated });
});

app.get('/api/crm/tags', (_req, res) => {
  res.json({ ok: true, tags: storage.getCustomTags() });
});

app.post('/api/crm/tags', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Informe o nome da etiqueta.' });
  const saved = storage.saveCustomTag({
    id: req.body?.id,
    name,
    color: req.body?.color || '#10b981'
  });
  broadcast('crm_updated', {});
  res.json({ ok: true, tag: saved, tags: storage.getCustomTags(), business: storage.getBusiness() });
});

app.delete('/api/crm/tags/:tagId', (req, res) => {
  const removed = storage.deleteCustomTag(decodeURIComponent(req.params.tagId));
  if (!removed) return res.status(404).json({ ok: false, error: 'Etiqueta não encontrada.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, removed, tags: storage.getCustomTags(), business: storage.getBusiness() });
});

app.post('/api/crm/bulk-action', (req, res) => {
  const { chatIds = [], action = '', stage = '', tag = '', minutes = 60 } = req.body || {};
  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Selecione pelo menos uma conversa.' });
  }
  let affected = 0;
  for (const rawId of chatIds) {
    const key = storage.findSiblingContactKey(rawId) || rawId;
    const c = storage.data.contacts[key];
    if (!c) continue;
    affected += 1;
    switch (action) {
      case 'mark_read':
        storage.markContactRead(key);
        break;
      case 'mark_unread':
        storage.markContactUnread(key);
        break;
      case 'archive':
        storage.upsertContact(key, { archived: true, unreadCount: 0 });
        break;
      case 'unarchive':
        storage.upsertContact(key, { archived: false });
        break;
      case 'set_stage':
        if (stage) storage.upsertContact(key, { stage });
        break;
      case 'add_tag':
        if (tag) {
          const nextTags = Array.from(new Set([...(c.tags || []), tag]));
          storage.upsertContact(key, { tags: nextTags });
        }
        break;
      case 'remove_tag':
        if (tag) {
          storage.upsertContact(key, { tags: (c.tags || []).filter((t) => t !== tag) });
        }
        break;
      case 'pause_ai':
        storage.pauseContact(key, minutes || 60, 'Pausado em massa no CRM');
        break;
      case 'resume_ai':
        storage.resumeContact(key);
        break;
      case 'save_contacts':
        storage.upsertContact(key, { savedContact: true });
        break;
      case 'clear_messages':
        storage.clearContactMessages(key);
        break;
      case 'delete_chats':
        storage.deleteContact(key);
        break;
      default:
        break;
    }
  }
  storage.writeNow();
  broadcast('crm_updated', {});
  res.json({ ok: true, affected, contacts: sortContactsForInbox(storage.data.contacts) });
});

app.delete('/api/crm/:chatId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const siblingKey = storage.findSiblingContactKey(chatId);
  let deletedAny = false;
  for (const key of new Set([chatId, siblingKey].filter(Boolean))) {
    const contact = storage.data.contacts[key];
    for (const m of contact?.messages || []) {
      if (m.mediaUrl && m.mediaUrl.includes('_crmvoz_') && m.mediaUrl.startsWith('/uploads/')) {
        const safeFn = path.basename(m.mediaUrl);
        const fp = path.join(UPLOADS_DIR, safeFn);
        if (fs.existsSync(fp)) {
          try { fs.unlinkSync(fp); } catch {}
        }
      }
    }
    if (storage.deleteContact(key)) deletedAny = true;
  }
  if (!deletedAny) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  storage.writeNow();
  broadcast('crm_updated', {});
  res.json({ ok: true });
});

app.post('/api/crm/:chatId/clear-messages', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.clearContactMessages(chatId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  broadcast('crm_updated', { chatId: contact.chatId });
  res.json({ ok: true, contact });
});

app.get('/api/crm/:chatId/vcard.vcf', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  const contact = storage.data.contacts[key];
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  const safeSlug = String(contact.name || contact.phone || 'contato')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40) || 'contato';
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.vcf"`);
  res.send(buildContactVCard(contact));
});

app.get('/api/crm/:chatId/export.txt', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  const contact = storage.data.contacts[key];
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  const bizName = storage.getBusiness()?.attendantName || storage.getBusiness()?.name || 'Atendimento';
  const header = [
    `Histórico de Conversa — Ienvia`,
    `Contato: ${contact.name || 'Cliente'} (+${contact.phone || 'N/D'})`,
    contact.company ? `Empresa: ${contact.company}` : null,
    `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
    `------------------------------------------------------------`,
    ''
  ].filter((x) => x !== null);

  const lines = (contact.messages || []).map((m) => {
    const dt = m.timestamp ? new Date(m.timestamp).toLocaleString('pt-BR') : '--';
    const who =
      m.role === 'user'
        ? (contact.name || 'Cliente')
        : m.role === 'internal_note'
          ? `[NOTA INTERNA - ${m.author || 'Equipe'}]`
          : `${bizName} (${m.role === 'assistant' ? 'Automático' : 'Você'})`;
    return `[${dt}] ${who}: ${String(m.text || '').replace(/\r?\n/g, ' ')}`;
  });

  const safeSlug = String(contact.name || contact.phone || 'conversa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40) || 'conversa';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversa_${safeSlug}.txt"`);
  res.send('\uFEFF' + [...header, ...lines].join('\r\n'));
});

app.post('/api/crm/:chatId/block', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  const existing = storage.data.contacts[key];
  if (!existing) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  const nextBlocked = req.body?.blocked !== undefined ? Boolean(req.body.blocked) : !existing.waBlocked;

  try {
    if (usesCloudBridge(req) && !key.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      try {
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'crm_block_contact',
          { chatId: key, blocked: nextBlocked }
        );
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({ ok: true, contact: out.contact || storage.data.contacts[key], syncedWhatsApp: true });
      } catch (bridgeErr) {
        if (!/desconhecida/i.test(bridgeErr.message || '')) throw bridgeErr;
      }
    } else if (usesCloudBridge(req) && !key.startsWith('demo_')) {
      await blockEvolutionApiContact(req.cloudAuth.authUser.id, key, nextBlocked);
      const updated = storage.upsertContact(key, { waBlocked:nextBlocked, aiIgnored:nextBlocked ? true : Boolean(existing.aiIgnored) });
      return res.json({ ok:true, contact:updated, syncedWhatsApp:true, provider:'evolution_api' });
    } else if (!usesCloudBridge(req) && !key.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const updated = await whatsappManager.setWhatsAppBlockStatus(key, nextBlocked);
      return res.json({ ok: true, contact: updated, syncedWhatsApp: true });
    }

    const updated = storage.upsertContact(key, {
      waBlocked: nextBlocked,
      aiIgnored: nextBlocked ? true : Boolean(existing.aiIgnored)
    });
    storage.writeNow();
    broadcast('crm_updated', { chatId: key });
    res.json({ ok: true, contact: updated, syncedWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/send-vcard', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const targetKey = storage.findSiblingContactKey(chatId) || chatId;
  if (!storage.data.contacts[targetKey]) {
    return res.status(404).json({ ok: false, error: 'Conversa de destino não encontrada.' });
  }

  let cardContact = req.body?.cardContact || null;
  if (!cardContact && req.body?.sourceChatId) {
    const srcKey = storage.findSiblingContactKey(req.body.sourceChatId) || req.body.sourceChatId;
    cardContact = storage.data.contacts[srcKey] || null;
  }
  if (!cardContact || (!cardContact.name && !cardContact.phone)) {
    return res.status(400).json({ ok: false, error: 'Informe os dados do cartão de contato a enviar.' });
  }

  try {
    if (usesCloudBridge(req) && !targetKey.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      try {
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'crm_send_vcard',
          { targetChatId: targetKey, cardContact }
        );
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({ ok: true, contact: out.contact || storage.data.contacts[targetKey], syncedWhatsApp: true });
      } catch (bridgeErr) {
        if (!/desconhecida/i.test(bridgeErr.message || '')) throw bridgeErr;
      }
    } else if (usesCloudBridge(req) && !targetKey.startsWith('demo_')) {
      const sendResult = await sendEvolutionApiContact(req.cloudAuth.authUser.id, targetKey, cardContact);
      const messageId = sendResult?.data?.key?.id || sendResult?.key?.id || sendResult?.data?.id || sendResult?.id || '';
      const displayName = String(cardContact.name || cardContact.phone || 'Contato').trim();
      const updated = storage.appendContactMessage(targetKey, { role:'owner', text:`🪪 Cartão de contato enviado: *${displayName}*`, deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}) });
      return res.json({ ok:true, contact:updated, sentRealWhatsApp:false, syncedWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
    } else if (!usesCloudBridge(req) && !targetKey.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const updated = await whatsappManager.sendContactVCardOnWhatsApp(targetKey, cardContact);
      return res.json({ ok: true, contact: updated, syncedWhatsApp: true });
    }

    const displayName = String(cardContact.name || cardContact.phone || 'Contato').trim();
    const phoneLabel = cardContact.phone ? ` (+${normalizePhoneDigits(cardContact.phone)})` : '';
    const updated = storage.appendContactMessage(targetKey, {
      role: 'owner',
      text: `🪪 Cartão de contato enviado: *${displayName}*${phoneLabel}`
    });
    storage.writeNow();
    broadcast('crm_updated', { chatId: targetKey });
    res.json({ ok: true, contact: updated, syncedWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/mark-read', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const existing = storage.data.contacts[storage.findSiblingContactKey(chatId) || chatId];
  if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
    try { await markEvolutionApiRead(req.cloudAuth.authUser.id, chatId, (existing?.messages || []).filter((m) => m.role === 'user' && m.waMsgId).map((m) => m.waMsgId)); } catch (err) { return res.status(err.statusCode || 502).json({ ok:false, error:err.message }); }
  }
  const contact = storage.markContactRead(chatId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/mark-unread', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.markContactUnread(chatId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/toggle-ignore', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  const existing = storage.data.contacts[key];
  if (!existing) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  const nextIgnored = req.body?.ignored !== undefined ? Boolean(req.body.ignored) : !existing.aiIgnored;
  const contact = storage.upsertContact(key, { aiIgnored: nextIgnored });

  // Mantém a Lista Pessoal/Ignorados da aba Segurança sincronizada caso o contato tenha telefone real
  const digits = String(contact.phone || '').replace(/\D/g, '');
  if (digits.length >= 8) {
    storage.data.settings.ignoredContacts = Array.isArray(storage.data.settings.ignoredContacts)
      ? storage.data.settings.ignoredContacts
      : [];
    const idx = storage.data.settings.ignoredContacts.findIndex(
      (i) => String(i.phone || '').replace(/\D/g, '') === digits
    );
    if (nextIgnored && idx === -1) {
      storage.data.settings.ignoredContacts.push({
        id: uid('ign'),
        name: contact.name || `+${digits}`,
        phone: digits,
        reason: 'Ignorado em 1 clique no CRM'
      });
    } else if (!nextIgnored && idx >= 0) {
      storage.data.settings.ignoredContacts.splice(idx, 1);
    }
    storage.writeNow();
  }
  broadcast('crm_updated', {});
  res.json({ ok: true, contact, ignoredContacts: storage.data.settings.ignoredContacts || [] });
});

app.post('/api/crm/:chatId/tasks', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Digite a descrição da tarefa.' });
  const contact = storage.addContactTask(chatId, text);
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.patch('/api/crm/:chatId/tasks/:taskId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.toggleContactTask(chatId, req.params.taskId, req.body?.done);
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.delete('/api/crm/:chatId/tasks/:taskId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.deleteContactTask(chatId, req.params.taskId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/schedule-message', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const text = String(req.body?.text || '').trim();
  const sendAt = String(req.body?.sendAt || '').trim();
  if (!text || !sendAt) {
    return res.status(400).json({ ok: false, error: 'Informe a mensagem e a data/hora programada.' });
  }
  if (new Date(sendAt).getTime() <= Date.now() - 30_000) {
    return res.status(400).json({ ok: false, error: 'Escolha um horário futuro para programar o envio.' });
  }
  const contact = storage.addScheduledMessage(chatId, { text, sendAt });
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.delete('/api/crm/:chatId/schedule-message/:schedId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.cancelScheduledMessage(chatId, req.params.schedId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/archive', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  if (!storage.data.contacts[key]) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  const nextArchived = req.body?.archived !== undefined ? Boolean(req.body.archived) : !storage.data.contacts[key].archived;
  const contact = storage.upsertContact(key, { archived: nextArchived, unreadCount: 0 });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/pin', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  if (!storage.data.contacts[key]) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  const nextPinned = req.body?.pinned !== undefined ? Boolean(req.body.pinned) : !storage.data.contacts[key].pinned;
  const contact = storage.upsertContact(key, { pinned: nextPinned });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/internal-note', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Escreva o conteúdo da nota interna.' });
  const effUser = getEffectiveCurrentUser(req);
  const author = effUser?.impersonating
    ? `${effUser.impersonatedBy?.displayName || 'Master'} (Suporte)`
    : (effUser?.displayName || 'Equipe');
  const contact = storage.addInternalNote(chatId, { text, author });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.delete('/api/crm/:chatId/internal-note/:noteId', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.deleteInternalNote(chatId, req.params.noteId);
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
  broadcast('crm_updated', {});
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/suggest-reply', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const key = storage.findSiblingContactKey(chatId) || chatId;
  const contact = storage.data.contacts[key];
  if (!contact) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });

  const biz = storage.getBusiness();
  const realMsgs = (contact.messages || []).filter((m) => m && m.role !== 'internal_note');
  const lastCustomerMsg = [...realMsgs].reverse().find((m) => m.role === 'user')?.text || 'Olá, gostaria de alinhar os próximos passos.';

  try {
    const out = await generateSmartReply({
      profile: biz,
      settings: storage.data.settings,
      history: realMsgs.slice(0, -1),
      userText: lastCustomerMsg,
      contactName: contact.name || 'Cliente',
      sentVoiceIds: contact.sentVoiceIds || [],
      allowDemoFallback: false
    });
    const suggestion = String(out.cleanText || '').trim() ||
      `Oi, ${(contact.name || '').split(' ')[0] || 'tudo bem'}! Vi sua mensagem aqui agora e já te retorno pessoalmente sobre isso.`;
    res.json({ ok: true, suggestion, modelUsed: out.modelUsed });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Configure sua chave de IA na aba Motor de IA para usar sugestões.' });
  }
});

app.post('/api/crm/:chatId/pause', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const minutes = req.body?.minutes || 60;
  const contact = storage.pauseContact(chatId, minutes, 'Pausado pelo painel');
  res.json({ ok: true, contact });
});

app.post('/api/crm/:chatId/resume', (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const contact = storage.resumeContact(chatId);
  res.json({ ok: true, contact });
});

app.post(['/api/crm/:chatId/send', '/api/crm/:chatId/reply'], async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const text = (req.body?.text || '').trim();
  const quotedMsgId = String(req.body?.quotedMsgId || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Digite uma mensagem.' });

  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const waState = getEffectiveWaState(req);
      if (!waState.workerOnline) {
        const quotedMessage = quotedMsgId ? storage.findMessageInContact(chatId, quotedMsgId)?.msg : null;
        const result = await sendEvolutionApiText(req.cloudAuth.authUser.id, chatId, text, { quoted:quotedMessage?.waMsgId ? { messageId:quotedMessage.waMsgId, fromMe:quotedMessage.role !== 'user', text:quotedMessage.text || '' } : undefined });
        const messageId = result?.data?.key?.id || result?.key?.id || result?.data?.id || result?.id || '';
        const contact = storage.appendContactMessage(chatId, { role:'owner', text, deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}) });
        storage.markContactRead(chatId);
        return res.json({ ok:true, contact, sentRealWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
      }
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_crm_reply',
        { chatId, text, quotedMsgId },
        2500
      );
      // CRÍTICO: NUNCA sujar o snapshot pré-comando da Vercel após o Motor já ter salvo a mensagem nova no Supabase!
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({
        ok: true,
        contact: out.queued ? undefined : (out.contact || storage.data.contacts[chatId]),
        queued: Boolean(out.queued),
        commandId: out.commandId || undefined,
        sentRealWhatsApp: !out.queued
      });
    }

    const cleanTargetJid = chatId.replace(/^demo_/, '');
    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar.'
        });
      }
      await whatsappManager.sendManualOwnerMessage(cleanTargetJid, text, true, { quotedMsgId });
      storage.markContactRead(chatId);
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({
        ok: true,
        contact: storage.data.contacts[key],
        sentRealWhatsApp: true
      });
    }

    let quotedStub = undefined;
    if (quotedMsgId) {
      const { msg: qm } = storage.findMessageInContact(chatId, quotedMsgId);
      if (qm) quotedStub = { id: qm.id, text: String(qm.text || '').slice(0, 180), role: qm.role || 'user' };
    }
    storage.appendContactMessage(chatId, {
      role: 'owner',
      text,
      ...(quotedStub ? { quoted: quotedStub } : {})
    });
    storage.pauseContact(chatId, 60, 'Mensagem simulada na conversa demo');
    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({
      ok: true,
      contact: storage.data.contacts[key],
      sentRealWhatsApp: false
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/messages/:msgId/react', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const msgId = decodeURIComponent(req.params.msgId);
  const emoji = String(req.body?.emoji || '').trim();
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      try {
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'crm_react_message',
          { chatId, msgId, emoji }
        );
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({ ok: true, contact: out.contact || storage.data.contacts[chatId], syncedWhatsApp: true });
      } catch (bridgeErr) {
        if (!/desconhecida/i.test(bridgeErr.message || '')) throw bridgeErr;
      }
    } else if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const target = storage.findMessageInContact(chatId, msgId)?.msg;
      if (!target) return res.status(404).json({ ok:false, error:'Mensagem não encontrada.' });
      await reactEvolutionApiMessage(req.cloudAuth.authUser.id, chatId, target.waMsgId || msgId, emoji, target.role !== 'user');
      const updated = storage.applyMessageReaction(chatId, msgId, emoji, 'owner');
      if (!updated) return res.status(404).json({ ok:false, error:'Mensagem enviada; não encontrei a mensagem local para atualizar a reação.' });
      return res.json({ ok:true, contact:updated, syncedWhatsApp:true, provider:'evolution_api' });
    } else if (!usesCloudBridge(req) && !chatId.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const updated = await whatsappManager.reactToWhatsappMessage(chatId, msgId, emoji);
      return res.json({ ok: true, contact: updated, syncedWhatsApp: true });
    }
    const updated = storage.applyMessageReaction(chatId, msgId, emoji, 'owner');
    if (!updated) return res.status(404).json({ ok: false, error: 'Mensagem não encontrada.' });
    broadcast('crm_updated', { chatId });
    res.json({ ok: true, contact: updated, syncedWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.put('/api/crm/:chatId/messages/:msgId', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const msgId = decodeURIComponent(req.params.msgId);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Informe o novo texto da mensagem.' });
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      try {
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'crm_edit_message',
          { chatId, msgId, text }
        );
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({ ok: true, contact: out.contact || storage.data.contacts[chatId], syncedWhatsApp: true });
      } catch (bridgeErr) {
        if (!/desconhecida/i.test(bridgeErr.message || '')) throw bridgeErr;
      }
    } else if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const target = storage.findMessageInContact(chatId, msgId)?.msg;
      if (!target) return res.status(404).json({ ok:false, error:'Mensagem não encontrada.' });
      if (target.role === 'user') return res.status(403).json({ ok:false, error:'Só é possível editar mensagens enviadas por esta conta.' });
      await editEvolutionApiMessage(req.cloudAuth.authUser.id, chatId, target.waMsgId || msgId, text);
      const updated = storage.applyMessageEdit(chatId, msgId, text);
      if (!updated) return res.status(404).json({ ok:false, error:'Mensagem enviada; não encontrei a mensagem local para atualizar.' });
      return res.json({ ok:true, contact:updated, syncedWhatsApp:true, provider:'evolution_api' });
    } else if (!usesCloudBridge(req) && !chatId.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const updated = await whatsappManager.editWhatsappMessage(chatId, msgId, text);
      return res.json({ ok: true, contact: updated, syncedWhatsApp: true });
    }
    const updated = storage.applyMessageEdit(chatId, msgId, text);
    if (!updated) return res.status(404).json({ ok: false, error: 'Mensagem não encontrada.' });
    broadcast('crm_updated', { chatId });
    res.json({ ok: true, contact: updated, syncedWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/crm/:chatId/messages/:msgId', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const msgId = decodeURIComponent(req.params.msgId);
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      try {
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'crm_delete_message',
          { chatId, msgId }
        );
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({ ok: true, contact: out.contact || storage.data.contacts[chatId], syncedWhatsApp: true });
      } catch (bridgeErr) {
        if (!/desconhecida/i.test(bridgeErr.message || '')) throw bridgeErr;
      }
    } else if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const target = storage.findMessageInContact(chatId, msgId)?.msg;
      if (!target) return res.status(404).json({ ok:false, error:'Mensagem não encontrada.' });
      if (target.role === 'user') return res.status(403).json({ ok:false, error:'Só é possível apagar mensagens enviadas por esta conta.' });
      await deleteEvolutionApiMessage(req.cloudAuth.authUser.id, chatId, target.waMsgId || msgId);
      const updated = storage.applyMessageDelete(chatId, msgId);
      if (!updated) return res.status(404).json({ ok:false, error:'Mensagem apagada; não encontrei a mensagem local para atualizar.' });
      return res.json({ ok:true, contact:updated, syncedWhatsApp:true, provider:'evolution_api' });
    } else if (!usesCloudBridge(req) && !chatId.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const updated = await whatsappManager.deleteWhatsappMessageForEveryone(chatId, msgId);
      return res.json({ ok: true, contact: updated, syncedWhatsApp: true });
    }
    const updated = storage.applyMessageDelete(chatId, msgId);
    if (!updated) return res.status(404).json({ ok: false, error: 'Mensagem não encontrada.' });
    broadcast('crm_updated', { chatId });
    res.json({ ok: true, contact: updated, syncedWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/messages/:msgId/forward', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const msgId = decodeURIComponent(req.params.msgId);
  const toChatId = String(req.body?.toChatId || '').trim();
  if (!toChatId) return res.status(400).json({ ok: false, error: 'Selecione o contato de destino.' });
  try {
    if (usesCloudBridge(req) && !toChatId.startsWith('demo_') && getEffectiveWaState(req).workerOnline) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'crm_forward_message',
        { fromChatId: chatId, msgId, toChatId }
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({ ok: true, targetContact: out.targetContact, sentRealWhatsApp: true });
    }
    if (!usesCloudBridge(req) && !toChatId.startsWith('demo_') && whatsappManager?.status === 'connected') {
      const targetContact = await whatsappManager.forwardCrmMessage(chatId, msgId, toChatId);
      return res.json({ ok: true, targetContact, sentRealWhatsApp: true });
    }
    const { msg } = storage.findMessageInContact(chatId, msgId);
    if (!msg) return res.status(404).json({ ok: false, error: 'Mensagem não encontrada.' });
    const targetContact = storage.appendContactMessage(toChatId, {
      role: 'owner',
      text: msg.text || '[Mensagem encaminhada]',
      ...(msg.mediaUrl ? { mediaUrl: msg.mediaUrl, mediaName: msg.mediaName, mediaMime: msg.mediaMime } : {})
    });
    broadcast('crm_updated', {});
    res.json({ ok: true, targetContact, sentRealWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/fetch-history', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const count = Math.min(100, Math.max(15, Number(req.body?.count) || 50));
  if (chatId.startsWith('demo_')) {
    return res.json({ ok: true, countAdded: 0, contact: storage.data.contacts[chatId] || null });
  }
  try {
    if (usesCloudBridge(req) && !getEffectiveWaState(req).workerOnline) {
      const contactKey = storage.findSiblingContactKey(chatId) || chatId;
      const contact = storage.data.contacts[contactKey];
      if (contact?.evolutionApiHistoryComplete === true) {
        return res.json({ ok:true, chatId, requested:false, provider:'evolution_api', countAdded:0, hasMore:false, contact });
      }
      const anchor = (contact?.messages || []).filter((m) => m.waMsgId).sort((a,b) => Date.parse(a.timestamp||0)-Date.parse(b.timestamp||0))[0];
      const page = Math.max(1, Number(contact?.evolutionApiHistoryNextPage) || 1);
      const result = await requestEvolutionApiHistory(req.cloudAuth.authUser.id, chatId, count, { id:anchor?.waMsgId || '', isFromMe:anchor?.role !== 'user', timestamp:anchor?.timestamp || '' }, page);
      const merged = mergeEvolutionApiHistoryPage(storage, chatId, result, { page, pageSize:count });
      return res.json({ ok:true, chatId, requested:true, provider:'evolution_api', sync:result, ...merged });
    }
    if (usesCloudBridge(req)) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'fetch_chat_history',
        { chatId, count },
        9800
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({ ok: true, ...out });
    }
    const out = await whatsappManager.fetchOlderMessagesForChat(chatId, count);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(err.statusCode || 400).json({ ok: false, workerOffline: Boolean(err.workerOffline), error: err.message });
  }
});

app.post('/api/crm/:chatId/send-item', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const { itemId } = req.body || {};
  const biz = storage.getBusiness();
  const item = (biz.catalog || []).find(it => it.id === itemId);
  if (!item) return res.status(404).json({ ok: false, error: 'Item do catálogo não encontrado.' });

  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_') && !getEffectiveWaState(req).workerOnline) {
      const txt = `*${item.name}*${item.price ? ` — R$ ${item.price}` : ''}\n${item.description || ''}${item.paymentLink ? `\n${item.paymentLink}` : ''}`.trim();
      const mediaFiles = item.mediaFiles || (item.mediaFile ? [item.mediaFile] : []);
      const media = mediaFiles.find((m) => m?.url && /^https?:\/\//i.test(m.url));
      const sendResult = media
        ? await sendEvolutionApiMedia(req.cloudAuth.authUser.id, chatId, { url:media.url, type:String(media.mimeType || '').startsWith('image/') ? 'image' : 'document', filename:media.originalName || media.filename || item.name, caption:txt })
        : await sendEvolutionApiText(req.cloudAuth.authUser.id, chatId, txt);
      const messageId = sendResult?.data?.key?.id || sendResult?.key?.id || sendResult?.data?.id || sendResult?.id || '';
      const updated = storage.appendContactMessage(chatId, { role:'owner', text:txt, deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}), ...(media ? {mediaUrl:media.url, mediaName:media.originalName || media.filename, mediaMime:media.mimeType} : {}) });
      return res.json({ ok:true, contact:updated, sentRealWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
    }
    if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_crm_catalog',
        { chatId, itemId }
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({ ok: true, contact: out.contact || storage.data.contacts[chatId], sentRealWhatsApp: true });
    }

    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar itens.'
        });
      }
      if ((item.mediaFiles && item.mediaFiles.length > 0) || item.mediaFile?.filename) {
        await whatsappManager.sendCatalogMediaFile(chatId, item, 'owner');
      } else {
        const txt = `*${item.name}*${item.price ? ` — R$ ${item.price}` : ''}\n${item.description || ''}${item.paymentLink ? `\n${item.paymentLink}` : ''}`.trim();
        await whatsappManager.sendManualOwnerMessage(chatId, txt, true);
      }
      storage.pauseContact(chatId, biz.lockUntilManualResume ? 'forever' : 60, 'Item enviado manualmente no CRM');
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({ ok: true, contact: storage.data.contacts[key], sentRealWhatsApp: true });
    }

    storage.appendContactMessage(chatId, { role: 'owner', text: `[Item enviado na conversa demo: ${item.name}]` });
    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({ ok: true, contact: storage.data.contacts[key], sentRealWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/send-pix', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const biz = storage.getBusiness();
  if (!biz.pix?.enabled || !biz.pix?.key) {
    return res.status(400).json({ ok: false, error: 'Ative e configure sua chave PIX na aba Catálogo & PIX primeiro.' });
  }
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_') && !getEffectiveWaState(req).workerOnline) {
      const preview = await formatPixMessageWithQr(biz.pix, req.body?.amount || null);
      const text = preview?.summaryText || `PIX\nChave: ${biz.pix.key}`;
      let mediaUrl = '';
      let sendResult;
      if (preview?.qrBuffer && preview.sendQrImage) {
        const filename = `pix_${crypto.randomUUID()}.png`;
        mediaUrl = await uploadMediaBufferToCloud(req.cloudAuth.client, req.cloudAuth.authUser.id, filename, preview.qrBuffer, 'image/png') || '';
        if (mediaUrl) sendResult = await sendEvolutionApiMedia(req.cloudAuth.authUser.id, chatId, { url:mediaUrl, type:'image', filename:'pix.png', caption:text });
      }
      if (!mediaUrl) sendResult = await sendEvolutionApiText(req.cloudAuth.authUser.id, chatId, text);
      const messageId = sendResult?.data?.key?.id || sendResult?.key?.id || sendResult?.data?.id || sendResult?.id || '';
      const updated = storage.appendContactMessage(chatId, { role:'owner', text, deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}), ...(mediaUrl ? {mediaUrl, mediaName:'pix.png', mediaMime:'image/png'} : {}) });
      return res.json({ ok:true, contact:updated, sentRealWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
    }
    if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_crm_pix',
        { chatId, amount: req.body?.amount || null }
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({ ok: true, contact: out.contact || storage.data.contacts[chatId], sentRealWhatsApp: true });
    }

    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar o PIX.'
        });
      }
      await whatsappManager.sendPixPayloadToChat(chatId, biz, req.body?.amount || null, 'owner', chatId);
      storage.pauseContact(chatId, biz.lockUntilManualResume ? 'forever' : 60, 'PIX enviado manualmente no CRM');
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({ ok: true, contact: storage.data.contacts[key], sentRealWhatsApp: true });
    }

    const preview = await formatPixMessageWithQr(biz.pix, req.body?.amount || null);
    storage.appendContactMessage(chatId, { role: 'owner', text: preview?.summaryText || '[PIX]' });
    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({ ok: true, contact: storage.data.contacts[key], sentRealWhatsApp: false });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// Anexo livre de Imagem, Vídeo ou Documento/Arquivo direto no compositor do Inbox 360º
const ALLOWED_CHAT_ATTACH_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.ppt', '.pptx', '.zip', '.xml', '.json'
]);
const ATTACH_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.xml': 'application/xml',
  '.json': 'application/json'
};
app.post('/api/crm/:chatId/send-attachment', memUpload.single('file'), async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Selecione uma imagem, vídeo MP4 ou documento (PDF, Word, Excel, CSV, TXT, ZIP).' });
  }

  const origName = String(req.file.originalname || 'anexo').replace(/[^\w.\- ()áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '_').slice(0, 100);
  const rawExt = path.extname(origName).toLowerCase();
  const mime = String(req.file.mimetype || '').toLowerCase();
  const safeExt = ALLOWED_CHAT_ATTACH_EXTS.has(rawExt)
    ? rawExt
    : mime === 'application/pdf'
      ? '.pdf'
      : mime.includes('png')
        ? '.png'
        : mime.includes('webp')
          ? '.webp'
          : mime.includes('gif')
            ? '.gif'
            : mime.startsWith('image/')
              ? '.jpg'
              : mime.startsWith('video/')
                ? '.mp4'
                : mime.includes('spreadsheet') || mime.includes('excel')
                  ? '.xlsx'
                  : mime.includes('word')
                    ? '.docx'
                    : mime.includes('csv')
                      ? '.csv'
                      : mime.includes('zip')
                        ? '.zip'
                        : mime.startsWith('text/')
                          ? '.txt'
                          : '';

  if (!safeExt) {
    return res.status(400).json({ ok: false, error: 'Formato não permitido. Envie imagens, vídeo MP4, PDF, Planilhas, Word, TXT ou ZIP.' });
  }

  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(safeExt);
  const isVideo = safeExt === '.mp4';
  const resolvedMime = ATTACH_MIME_BY_EXT[safeExt] || 'application/octet-stream';
  const caption = String(req.body?.caption || '').trim();
  const savedFilename = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${safeExt}`;
  const displayFileName = origName.toLowerCase().endsWith(safeExt) ? origName : `${origName}${safeExt}`;

  try {
    let mediaUrl = `/uploads/${savedFilename}`;

    if (usesCloudBridge(req)) {
      const uploadedUrl = await uploadMediaBufferToCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        savedFilename,
        req.file.buffer,
        resolvedMime
      );
      if (!uploadedUrl) {
        return res.status(500).json({ ok: false, error: 'Falha ao salvar anexo no armazenamento seguro da conta.' });
      }
      mediaUrl = uploadedUrl;

      if (!chatId.startsWith('demo_')) {
        const waState = getEffectiveWaState(req);
        if (!waState.workerOnline) {
          const sendResult = await sendEvolutionApiMedia(req.cloudAuth.authUser.id, chatId, { url:mediaUrl, type:isImage ? 'image' : isVideo ? 'video' : 'document', filename:displayFileName, caption });
          const messageId = sendResult?.data?.key?.id || sendResult?.key?.id || sendResult?.data?.id || sendResult?.id || '';
          const contact = storage.appendContactMessage(chatId, { role:'owner', text:caption || (isImage ? '[Imagem enviada]' : isVideo ? `[Vídeo enviado: ${displayFileName}]` : `[Arquivo enviado: ${displayFileName}]`), deliveryStatus:'accepted', ...(messageId ? { waMsgId:String(messageId) } : {}), mediaUrl, mediaName:displayFileName, mediaMime:resolvedMime, mediaSize:req.file.buffer.length });
          return res.json({ ok:true, contact, sentRealWhatsApp:false, accepted:true, deliveryStatus:'accepted', provider:'evolution_api' });
        }
        const out = await dispatchCommandToWorker(
          req.cloudAuth.client,
          req.cloudAuth.authUser.id,
          'send_crm_attachment',
          {
            chatId,
            filename: savedFilename,
            mediaUrl,
            mimeType: resolvedMime,
            originalName: displayFileName,
            caption
          },
          2500
        );
        // CRÍTICO: NUNCA sujar o snapshot pré-comando da Vercel após o Motor já ter salvo o anexo novo no Supabase!
        storage.workspaceDirty = false;
        storage.dirtyContactIds.clear();
        return res.json({
          ok: true,
          contact: out.queued ? undefined : (out.contact || storage.data.contacts[chatId]),
          queued: Boolean(out.queued),
          commandId: out.commandId || undefined,
          sentRealWhatsApp: !out.queued
        });
      }
    } else {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, savedFilename), req.file.buffer);
    }

    const cleanTargetJid = chatId.replace(/^demo_/, '');
    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar arquivos.'
        });
      }
      await whatsappManager.sendManualAttachment({
        chatId: cleanTargetJid,
        buffer: req.file.buffer,
        mimeType: resolvedMime,
        fileName: displayFileName,
        caption,
        mediaUrl,
        pauseAi: true
      });
      storage.markContactRead(chatId);
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({
        ok: true,
        contact: storage.data.contacts[key],
        sentRealWhatsApp: true
      });
    }

    storage.appendContactMessage(chatId, {
      role: 'owner',
      text: caption || (isImage ? '[Imagem enviada]' : isVideo ? `[Vídeo enviado: ${displayFileName}]` : `[Arquivo enviado: ${displayFileName}]`),
      mediaUrl,
      mediaName: displayFileName,
      mediaMime: resolvedMime,
      mediaSize: req.file.buffer.length
    });
    storage.pauseContact(chatId, 60, 'Anexo simulado na conversa demo');

    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({
      ok: true,
      contact: storage.data.contacts[key],
      sentRealWhatsApp: false
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// Autonomia para o próprio cliente/usuário autenticado alterar sua senha
app.post('/api/auth/change-password', async (req, res) => {
  try {
    if (req.cloudAuth?.isRemoteImpersonation) {
      return res.status(400).json({
        ok: false,
        error: 'Você está em Modo Suporte Master. Para redefinir a senha deste cliente, use o botão "Senha" na aba Clientes SaaS.'
      });
    }
    const ownUsername = IS_VERCEL
      ? (req.realMasterProfile?.username || req.cloudAuth?.profile?.username)
      : cloudWorker.user?.username;

    if (!ownUsername) {
      return res.status(401).json({ ok: false, error: 'Faça login na sua conta para alterar a senha.' });
    }

    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Preencha sua senha atual e a nova senha.' });
    }

    const updatedAuth = await changeOwnPassword(ownUsername, currentPassword, newPassword);

    if (!IS_VERCEL && cloudWorker.user?.username === ownUsername) {
      await cloudWorker.loginWorkerWithCredentials(ownUsername, newPassword).catch(() => {});
    }

    res.json({ ok: true, ...updatedAuth });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Não foi possível alterar a senha.' });
  }
});

// ======================== BIBLIOTECA DE ÁUDIOS ESTRATÉGICOS (OGG/OPUS + WAVEFORM 64B) ========================

app.post('/api/voice-library/transcribe', memUpload.single('audio'), async (req, res) => {
  try {
    let audioBuf = req.file?.buffer || null;
    let origName = req.file?.originalname || 'audio.ogg';

    if (!audioBuf && req.body?.existingId) {
      const existing = storage.getVoiceLibrary().find((v) => v.id === req.body.existingId);
      if (existing?.filename) {
        const fp = existing.url && /^https?:\/\//i.test(existing.url)
          ? await ensureLocalMediaCached(existing.filename, existing.url)
          : path.join(UPLOADS_DIR, existing.filename);
        if (fp && fs.existsSync(fp)) {
          audioBuf = fs.readFileSync(fp);
          origName = existing.filename;
        }
      }
    }

    if (!audioBuf) {
      return res.status(400).json({ ok: false, error: 'Grave ou selecione um áudio primeiro para transcrever.' });
    }

    const canonical = await convertToCanonicalWhatsAppVoice(audioBuf, origName);
    const transcription = await transcribeVoiceBufferWithAi(
      canonical.buffer,
      'audio/ogg',
      storage.data.settings.ai
    );

    res.json({
      ok: true,
      transcription,
      durationSec: canonical.durationSec,
      waveform: canonical.waveform
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/voice-library', memUpload.single('audio'), async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim() || uid('aud');
    const name = String(req.body?.name || '').trim();
    const transcription = String(req.body?.transcription || '').trim();
    const whenToUse = String(req.body?.whenToUse || '').trim();
    const linkedMessageCode = String(req.body?.linkedMessageCode || '').trim();
    const aiEnabled = String(req.body?.aiEnabled ?? 'true') !== 'false';

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Informe um nome claro para identificar o áudio.' });
    }
    if (!transcription) {
      return res.status(400).json({ ok: false, error: 'Informe a transcrição do áudio (ou clique em "Transcrever com IA").' });
    }

    const existing = storage.getVoiceLibrary().find((v) => v.id === id);
    if (!existing && (!req.file || !req.file.buffer)) {
      return res.status(400).json({ ok: false, error: 'Grave pelo microfone ou envie um arquivo de áudio.' });
    }

    let fileFields = {};
    if (req.file && req.file.buffer) {
      const canonical = await convertToCanonicalWhatsAppVoice(req.file.buffer, req.file.originalname || 'voz.ogg');
      const newFilename = `${Date.now()}_${id.replace(/[^a-zA-Z0-9_-]/g, '')}.ogg`;
      fs.writeFileSync(path.join(UPLOADS_DIR, newFilename), canonical.buffer);

      let publicUrl = `/uploads/${newFilename}`;
      const { client, userId } = getActiveCloudClientAndUser(req);
      if (client && userId) {
        const cloudUrl = await uploadMediaBufferToCloud(client, userId, newFilename, canonical.buffer, 'audio/ogg');
        if (cloudUrl) publicUrl = cloudUrl;
      }

      // Remove arquivo antigo se estiver substituindo o áudio
      if (existing?.filename && existing.filename !== newFilename) {
        const oldPath = path.join(UPLOADS_DIR, existing.filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      fileFields = {
        filename: newFilename,
        url: publicUrl,
        mimeType: canonical.mimeType,
        durationSec: canonical.durationSec,
        waveform: canonical.waveform,
        sizeBytes: canonical.sizeBytes
      };
    }

    const saved = storage.saveVoiceLibraryItem({
      id,
      name,
      whenToUse,
      linkedMessageCode,
      transcription,
      aiEnabled,
      ...fileFields
    });

    storage.addLog('info', `Áudio estratégico "${saved.name}" (${saved.durationSec}s • OGG/Opus Nativo) salvo na biblioteca.`);
    res.json({ ok: true, item: saved, business: storage.getBusiness() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.patch('/api/voice-library/:id/toggle', (req, res) => {
  const existing = storage.getVoiceLibrary().find((v) => v.id === req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Áudio não encontrado.' });
  const nextEnabled = req.body?.aiEnabled !== undefined ? Boolean(req.body.aiEnabled) : !existing.aiEnabled;
  const saved = storage.saveVoiceLibraryItem({ ...existing, aiEnabled: nextEnabled });
  res.json({ ok: true, item: saved, business: storage.getBusiness() });
});

app.delete('/api/voice-library/:id', (req, res) => {
  const removed = storage.deleteVoiceLibraryItem(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Áudio não encontrado.' });
  if (removed.filename) {
    const fp = path.join(UPLOADS_DIR, removed.filename);
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch {}
    }
  }
  storage.addLog('info', `Áudio estratégico "${removed.name}" removido da biblioteca.`);
  res.json({ ok: true, business: storage.getBusiness() });
});

app.post('/api/crm/:chatId/send-library-voice', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const voiceId = String(req.body?.voiceId || '').trim();
  const vItem = storage.getVoiceLibrary().find((v) => v.id === voiceId);
  if (!vItem) return res.status(404).json({ ok: false, error: 'Áudio estratégico não encontrado.' });

  const biz = storage.getBusiness();
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_crm_library_voice',
        { chatId, voiceId },
        2500
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({
        ok: true,
        contact: out.queued ? undefined : (out.contact || storage.data.contacts[chatId]),
        queued: Boolean(out.queued),
        commandId: out.commandId || undefined,
        business: storage.getBusiness(),
        sentRealWhatsApp: !out.queued
      });
    }

    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar notas de voz.'
        });
      }
      await whatsappManager.sendLibraryVoiceToChat(chatId, voiceId, {
        senderRole: 'owner',
        pauseAi: true
      });
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({
        ok: true,
        contact: storage.data.contacts[key],
        business: storage.getBusiness(),
        sentRealWhatsApp: true
      });
    }

    storage.recordVoiceSentToContact(chatId, voiceId);
    storage.appendContactMessage(chatId, {
      role: 'owner',
      text: `🎤 [Nota de voz: ${vItem.name} (${vItem.durationSec}s)]`,
      mediaUrl: vItem.url,
      durationSec: vItem.durationSec,
      waveform: vItem.waveform
    });
    storage.pauseContact(chatId, biz.lockUntilManualResume ? 'forever' : 60, `Áudio "${vItem.name}" simulado na conversa demo`);
    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({
      ok: true,
      contact: storage.data.contacts[key],
      business: storage.getBusiness(),
      sentRealWhatsApp: false
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/:chatId/send-audio', memUpload.single('audio'), async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Grave ou selecione um arquivo de áudio válido.' });
  }
  const biz = storage.getBusiness();
  try {
    if (usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const canonical = await convertToCanonicalWhatsAppVoice(req.file.buffer, req.file.originalname || 'nota-voz.ogg');
      const savedFn = `${Date.now()}_${uid('crmvoz')}.ogg`;
      const cloudUrl = await uploadMediaBufferToCloud(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        savedFn,
        canonical.buffer,
        'audio/ogg'
      );
      if (!cloudUrl) throw new Error('Falha ao enviar nota de voz para o armazenamento em nuvem.');
      const out = await dispatchCommandToWorker(
        req.cloudAuth.client,
        req.cloudAuth.authUser.id,
        'send_crm_recorded_voice',
        {
          chatId,
          filename: savedFn,
          mediaUrl: cloudUrl,
          durationSec: canonical.durationSec,
          waveform: canonical.waveform
        },
        2500
      );
      storage.workspaceDirty = false;
      storage.dirtyContactIds.clear();
      return res.json({
        ok: true,
        contact: out.queued ? undefined : (out.contact || storage.data.contacts[chatId]),
        queued: Boolean(out.queued),
        commandId: out.commandId || undefined,
        sentRealWhatsApp: !out.queued
      });
    }

    if (!usesCloudBridge(req) && !chatId.startsWith('demo_')) {
      const ready = await whatsappManager.waitUntilConnected(7000, chatId);
      if (!ready) {
        return res.status(503).json({
          ok: false,
          error: 'O WhatsApp não está conectado neste motor. Conecte na aba Início & Conexão antes de enviar áudios.'
        });
      }
      await whatsappManager.sendVoiceNoteToChat(chatId, req.file.buffer, req.file.originalname || 'nota-voz.ogg', 'owner', true);
      const key = storage.findSiblingContactKey(chatId) || chatId;
      return res.json({
        ok: true,
        contact: storage.data.contacts[key],
        sentRealWhatsApp: true
      });
    }

    const canonical = await convertToCanonicalWhatsAppVoice(req.file.buffer, req.file.originalname || 'nota-voz.ogg');
    const savedFn = `${Date.now()}_${uid('crmvoz')}.ogg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, savedFn), canonical.buffer);
    let mediaUrl = `/uploads/${savedFn}`;
    const { client, userId } = getActiveCloudClientAndUser(req);
    if (client && userId) {
      const pub = await uploadMediaBufferToCloud(client, userId, savedFn, canonical.buffer, 'audio/ogg');
      if (pub) mediaUrl = pub;
    }
    storage.appendContactMessage(chatId, {
      role: 'owner',
      text: `🎤 [Nota de voz gravada/enviada (${canonical.durationSec}s)]`,
      mediaUrl,
      durationSec: canonical.durationSec,
      waveform: canonical.waveform
    });
    storage.pauseContact(chatId, biz.lockUntilManualResume ? 'forever' : 60, 'Nota de voz simulada na conversa demo');
    const key = storage.findSiblingContactKey(chatId) || chatId;
    res.json({
      ok: true,
      contact: storage.data.contacts[key],
      sentRealWhatsApp: false
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

app.post('/api/crm/check-followups', async (req, res) => {
  try {
    if (usesCloudBridge(req)) {
      return res.json({ ok: true, triggeredCount: 0, triggered: [] });
    }
    const due = await whatsappManager.checkDueFollowUpsNow({
      notifyOwnerWhatsapp: req.body?.notifyOwner !== false
    });
    res.json({ ok: true, triggeredCount: due.length, triggered: due.map(c => ({ chatId: c.chatId, name: c.name })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ======================== BACKUP & RESTAURAÇÃO GERAL DO SISTEMA (.JSON) ========================

app.get('/api/system/backup.json', (_req, res) => {
  const snap = storage.exportFullSystemSnapshot();
  const dateTag = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ienvia-backup-geral-${dateTag}.json"`);
  res.send(JSON.stringify(snap, null, 2));
});

app.post('/api/system/restore', memUpload.single('file'), (req, res) => {
  try {
    let parsed = req.body?.snapshot || null;
    if (!parsed && req.file?.buffer) {
      parsed = JSON.parse(req.file.buffer.toString('utf-8'));
    }
    const summary = storage.importFullSystemSnapshot(parsed);
    storage.addLog('info', `Backup geral restaurado com sucesso (${summary.contactsCount} clientes no CRM).`);
    broadcast('crm_updated', {});
    broadcast('logs_updated', {});
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Falha ao restaurar backup: ${err.message}` });
  }
});

// Skill #10: Raio-X do Funil & Coaching de Conversas com IA (RevOps & Win-Loss Coach)
app.post('/api/crm/funnel-coach', async (_req, res) => {
  try {
    const sortedContacts = Object.values(storage.data.contacts || {}).sort(
      (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
    );
    const out = await analyzeCrmFunnelCoach({
      contacts: sortedContacts,
      profile: storage.getBusiness(),
      settings: storage.data.settings
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// (DELETE /api/crm/:chatId unificado acima com limpeza de mídia e trava anti-ressurreição)

// ======================== SIMULADOR INTERATIVO + ENSINAR EM 1 CLIQUE ========================

app.post('/api/simulator/send', memUpload.single('media'), async (req, res) => {
  try {
    const business = storage.getBusiness();
    const userText = (req.body?.text || '').trim();
    const media = req.file
      ? {
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          originalName: req.file.originalname
        }
      : null;

    if (!userText && !media) {
      return res.status(400).json({ ok: false, error: 'Envie uma mensagem, grave um áudio ou anexe um arquivo para testar.' });
    }

    storage.data.simulatorHistory = storage.data.simulatorHistory || [];
    const priorHistory = [...storage.data.simulatorHistory];
    const simSentVoiceIds = priorHistory
      .filter((m) => m.role === 'assistant' && m.sentVoice?.id)
      .map((m) => m.sentVoice.id);

    const userDisplay = media
      ? `${media.mimeType.startsWith('audio/') ? '[Áudio gravado/enviado]' : '[Arquivo enviado: ' + media.originalName + ']'} ${userText}`.trim()
      : userText;

    storage.data.simulatorHistory.push({
      id: uid('sim'),
      role: 'user',
      rawQuestion: userText || (media?.mimeType?.startsWith('audio/') ? 'Pergunta enviada por áudio' : 'Arquivo enviado'),
      text: userDisplay,
      timestamp: new Date().toISOString()
    });

    const aiResult = await generateSmartReply({
      profile: business,
      settings: storage.data.settings,
      history: priorHistory,
      userText,
      media,
      contactName: 'Cliente Teste',
      sentVoiceIds: simSentVoiceIds,
      allowDemoFallback: true
    });

    let sentVoice = null;
    if (aiResult.actions.voiceIds?.length > 0) {
      const vItem = storage.getVoiceLibrary().find((v) => v.id === aiResult.actions.voiceIds[0]);
      if (vItem) {
        sentVoice = {
          id: vItem.id,
          name: vItem.name,
          url: vItem.url,
          durationSec: vItem.durationSec,
          waveform: vItem.waveform,
          transcription: vItem.transcription
        };
      }
    }

    const attachments = [];
    for (const itemId of aiResult.actions.itemIds || []) {
      const item = (business.catalog || []).find(it => it.id === itemId);
      if (item) {
        const files = item.mediaFiles?.length ? item.mediaFiles : (item.mediaFile ? [item.mediaFile] : []);
        attachments.push({
          type: 'catalog_item',
          name: item.name,
          price: item.price,
          description: item.description,
          mediaFiles: files,
          mediaUrl: files[0]?.url || null,
          mimeType: files[0]?.mimeType || null
        });
      }
    }

    let pixCard = null;
    if (aiResult.actions.sendPix && business.pix?.enabled && business.pix?.key) {
      const fullPix = await formatPixMessageWithQr(business.pix, aiResult.actions.pixAmount);
      if (fullPix) {
        pixCard = {
          summaryText: fullPix.summaryText,
          brcode: fullPix.brcode,
          qrDataUrl: fullPix.qrDataUrl
        };
      }
    }

    const botEntry = {
      id: uid('sim'),
      role: 'assistant',
      triggerQuestion: userText || (media?.mimeType?.startsWith('audio/') ? 'Mensagem de áudio' : 'Anexo'),
      text: aiResult.cleanText,
      providerUsed: aiResult.providerUsed,
      modelUsed: aiResult.modelUsed,
      latencyMs: aiResult.latencyMs || 0,
      usedFallback: Boolean(aiResult.usedFallback),
      shieldTriggered: Boolean(aiResult.shieldTriggered),
      activatedSkills: aiResult.activatedSkills || [],
      diagnostics: aiResult.diagnostics || null,
      sentVoice,
      attachments,
      pixCard,
      handoffReason: aiResult.actions.handoffReason || null,
      silentPauseReason: aiResult.actions.silentPauseReason || null,
      closeContactReason: aiResult.actions.closeContactReason || null,
      optOutReason: aiResult.actions.optOutReason || null,
      courtesySilence: Boolean(aiResult.actions.courtesySilence),
      timestamp: new Date().toISOString()
    };

    storage.data.simulatorHistory.push(botEntry);
    if (storage.data.simulatorHistory.length > 40) {
      storage.data.simulatorHistory = storage.data.simulatorHistory.slice(-40);
    }
    storage.saveSoon();

    res.json({
      ok: true,
      reply: botEntry,
      simulatorHistory: storage.data.simulatorHistory,
      stats: storage.data.stats
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/simulator/teach', (req, res) => {
  const { question, customerQuestion, idealAnswer, target = 'faq' } = req.body || {};
  if (!String(idealAnswer || '').trim()) {
    return res.status(400).json({ ok: false, error: 'Escreva como a IA deveria responder.' });
  }
  const biz = storage.getBusiness();
  const qText = String(question || customerQuestion || 'Situação ensinada no Simulador').trim();
  if (target === 'rule') {
    biz.goldenRules = [biz.goldenRules || '', `- ${idealAnswer.trim()}`].filter(Boolean).join('\n');
  } else {
    biz.faqs = biz.faqs || [];
    biz.faqs.unshift({
      id: uid('faq'),
      question: qText,
      answer: String(idealAnswer).trim()
    });
  }
  biz.updatedAt = new Date().toISOString();
  storage.writeNow();
  storage.addLog('info', `Correção rápida salva no Cérebro Único ("${biz.name}") via Simulador.`);
  res.json({ ok: true, business: biz });
});

app.post('/api/simulator/reset', (_req, res) => {
  storage.data.simulatorHistory = [];
  storage.writeNow();
  res.json({ ok: true });
});

// ======================== INICIALIZAÇÃO (LOCAL MOTOR vs VERCEL SERVERLESS) ========================

if (!IS_VERCEL && server) {
  const PORT = Number(process.env.PORT) || 3000;
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n[!] Ja existe um Motor Ienvia ativo na porta ${PORT}. Feche a outra janela antes de abrir uma nova.\n`);
      process.exit(1);
    }
  });
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n======================================================`);
    console.log(`🚀 ${storage.data.settings.branding?.appName || 'Ienvia'} rodando na porta ${PORT}`);
    console.log(`👉 Painel Local: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
    storage.addLog('info', `Sistema iniciado na porta ${PORT}. Pronto para uso!`);

    if (isCloudConfigured()) {
      const restored = await cloudWorker.tryRestoreSavedLogin().catch(() => false);
      if (!restored) {
        await cloudWorker.promptTerminalLoginIfInteractive();
      } else {
        console.log(`☁️  [Nuvem Ienvia] Conectado automaticamente à conta @${cloudWorker.user?.username}!`);
      }
    } else {
      whatsappManager.autoRestoreIfSessionExists().catch(() => {});
    }
  });

  // Blindagem 24/7 contra quedas do Node 20 por oscilações de rede / Promises internas do Baileys no Android Termux
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason || '');
    console.warn(`⚠️  [Motor 24h Blindado] Oscilação assíncrona absorvida sem derrubar o servidor: ${msg.slice(0, 180)}`);
  });

  process.on('uncaughtException', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n[!] Já existe um Motor ativo na porta ${PORT}.\n`);
      process.exit(0);
    }
    console.warn(`⚠️  [Motor 24h Blindado] Exceção recuperada automaticamente: ${(err?.message || String(err)).slice(0, 180)}`);
  });

  // Ignora SIGHUP ao minimizar o Termux ou apagar a tela do celular
  try {
    process.on('SIGHUP', () => {});
  } catch {}

  // Garante gravação atômica de dados pendentes ao encerrar (Ctrl+C = 130 encerra loop; SIGTERM = 143 permite auto-recuperação)
  let shuttingDown = false;
  async function gracefulFlushAndExit(exitCode = 0, label = '') {
    if (shuttingDown) return;
    shuttingDown = true;
    if (label) console.log(`\n⏹️  [Ienvia] ${label}`);
    try {
      if (storage.saveTimer) {
        clearTimeout(storage.saveTimer);
        storage.saveTimer = null;
        storage.writeNow();
      }
      if (isCloudConfigured()) {
        await Promise.race([
          cloudWorker.markWorkerOfflineNow(),
          new Promise((r) => setTimeout(r, 1200))
        ]);
      }
    } catch {}
    process.exit(exitCode);
  }
  process.on('SIGINT', () => { gracefulFlushAndExit(130, 'Motor encerrado manualmente (Ctrl+C).'); });
  process.on('SIGTERM', () => { gracefulFlushAndExit(143, 'Sinal do sistema recebido — salvando estado seguro...'); });
}

export default app;


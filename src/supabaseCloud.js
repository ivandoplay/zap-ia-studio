import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import {
  IS_VERCEL,
  MEDIA_BUCKET,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  isCloudConfigured,
  normalizeUsername,
  usernameToAuthEmail
} from './cloudConfig.js';
import {
  AUTH_DIR,
  DATA_DIR,
  Storage,
  UPLOADS_DIR,
  WA_SLOT_IDS,
  normalizeSlotId,
  parseContactChannelKey,
  normalizeWaSlotsSettings,
  createCleanDatabaseForNewTenant,
  localStorageInstance,
  storage,
  tenantCloudMediaCachePath,
  mergeContactMessagesUnion
} from './storage.js';
import { calibrateTrueClock, trueNowIso, trueNowMs } from './trueClock.js';
import { enableHistoryJournal, isHistoryJournalEnabled, countJournalFiles } from './historyJournal.js';
import { backupSlotAuth } from './pairingSafety.js';
import { conectarMotorCampanhas } from './campanhaIntegracaoMotor.js';
import { criarLeitorMediaCampanha } from './campanhaDownload.js';
import { convertToCanonicalWhatsAppVoice } from './audioProcessor.js';
import { fetchScopedCloudContact } from './cloudSendScope.js';

const CLOUD_SESSION_FILE = path.join(DATA_DIR, 'cloud_session.json');
const DEVICE_IDENTITY_FILE = path.join(DATA_DIR, 'device_identity.json');
const WORKER_HEARTBEAT_TTL_MS = 95_000;
const APP_VERSION = (() => {
  try {
    const pkgPath = path.resolve(DATA_DIR, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '5.6.0';
  } catch {
    return '5.6.0';
  }
})();

export function clampMaxWaSlots(val, role = 'user') {
  if (role === 'master') return 3;
  const n = Number(val);
  if (n === 2 || n === 3) return n;
  return 1;
}

function defaultDeviceLabel() {
  const isAndroid = Boolean(process.env.PREFIX?.includes('com.termux')) || os.platform() === 'android';
  const host = String(os.hostname() || 'aparelho').slice(0, 32);
  if (isAndroid) return `Celular Android (${host})`;
  if (os.platform() === 'win32') return `Computador Windows (${host})`;
  if (os.platform() === 'darwin') return `Mac (${host})`;
  return `Computador Linux (${host})`;
}

export function getOrCreateDeviceIdentity() {
  if (IS_VERCEL) {
    return {
      deviceId: 'vercel_serverless',
      deviceName: 'Painel Web Vercel',
      platform: 'vercel'
    };
  }
  try {
    if (fs.existsSync(DEVICE_IDENTITY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DEVICE_IDENTITY_FILE, 'utf8'));
      if (parsed?.deviceId && typeof parsed.deviceId === 'string') {
        return {
          deviceId: parsed.deviceId.slice(0, 64),
          deviceName: String(parsed.deviceName || defaultDeviceLabel()).slice(0, 60),
          platform: String(parsed.platform || os.platform()).slice(0, 32)
        };
      }
    }
  } catch {}

  const identity = {
    deviceId: `dev_${crypto.randomBytes(6).toString('hex')}`,
    deviceName: defaultDeviceLabel(),
    platform: Boolean(process.env.PREFIX?.includes('com.termux')) ? 'android-termux' : os.platform(),
    createdAt: trueNowIso()
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_IDENTITY_FILE, JSON.stringify(identity, null, 2), 'utf8');
  } catch {}
  return identity;
}

export function renameLocalDeviceIdentity(newName = '') {
  const clean = String(newName || '').trim().slice(0, 60);
  if (!clean) throw new Error('Informe um nome válido para este aparelho.');
  const current = getOrCreateDeviceIdentity();
  const updated = { ...current, deviceName: clean, updatedAt: trueNowIso() };
  if (!IS_VERCEL) {
    fs.writeFileSync(DEVICE_IDENTITY_FILE, JSON.stringify(updated, null, 2), 'utf8');
  }
  return updated;
}

function computeWorkspaceConfigHash(storeData = {}) {
  try {
    return JSON.stringify({
      b: storeData.business || null,
      s: storeData.settings || null,
      cp: storeData.customPacks || null,
      sh: storeData.simulatorHistory || null
    });
  } catch {
    return '';
  }
}

export function createAnonClient(accessToken = null) {
  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: { headers },
    realtime: { transport: WebSocket }
  });
}

export function getAdminClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'A variável SUPABASE_SERVICE_ROLE_KEY não está configurada neste ambiente. Configure-a nas Environment Variables da Vercel para gerenciar contas.'
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    realtime: { transport: WebSocket }
  });
}

export function isWorkerHeartbeatFresh(heartbeatAt) {
  if (!heartbeatAt) return false;
  const ts = new Date(heartbeatAt).getTime();
  if (Number.isNaN(ts)) return false;
  const age = trueNowMs() - ts;
  // Tolera até 60s de relógio adiantado no celular e até 95s de oscilação 4G/Doze
  return age >= -60_000 && age <= WORKER_HEARTBEAT_TTL_MS;
}

export function mapCloudRuntimeToWaState(rt = null, botEnabled = true) {
  const online = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
  const platformStr = String(rt?.worker_platform || '');
  const verMatch = platformStr.match(/v(\d+\.\d+\.\d+)/i);
  const rawStatus = rt?.status || 'disconnected';
  const updAgeMs = rt?.updated_at ? Math.max(0, trueNowMs() - new Date(rt.updated_at).getTime()) : 999_999;

  // Anti-flap: micro-reconexão automática 4G/Wi-Fi (<20s) com aparelho já autenticado mantém UI estável como "connected"
  const isTransientReconnect =
    online &&
    rawStatus === 'connecting' &&
    Boolean(rt?.connected_user?.phone) &&
    !rt?.qr_data_url &&
    !rt?.pairing_code &&
    updAgeMs <= 20_000;

  const effectiveStatus = !online
    ? 'disconnected'
    : isTransientReconnect
      ? 'connected'
      : rawStatus;

  return {
    status: effectiveStatus,
    rawStatus,
    reconnecting: isTransientReconnect,
    qrDataUrl: online ? (rt?.qr_data_url || null) : null,
    pairingCode: online ? (rt?.pairing_code || null) : null,
    connectedUser: online ? (rt?.connected_user || null) : null,
    lastKnownUser: rt?.connected_user || null,
    lastError: online && !isTransientReconnect ? (rt?.last_error || null) : null,
    botEnabled,
    proactive: rt?.proactive_state || {
      running: false,
      paused: false,
      remaining: 0,
      sentSession: 0,
      nextRunAt: null,
      dailySent: 0,
      dailyLimit: 25,
      preview: []
    },
    workerOnline: online,
    workerHeartbeatAt: rt?.worker_heartbeat_at || null,
    workerPlatform: rt?.worker_platform || null,
    workerVersion: verMatch ? verMatch[1] : null
  };
}

export function buildCloudMultiSlotWaState({
  rtRow = null,
  slotRows = [],
  deviceRows = [],
  settings = {},
  maxWaSlots = 1
} = {}) {
  const botEnabled = settings?.botEnabled !== false;
  const slotsCfg = normalizeWaSlotsSettings(settings?.waSlots);

  const devices = (deviceRows || []).map((d) => {
    const online = Boolean(d?.online) && isWorkerHeartbeatFresh(d?.heartbeat_at);
    return {
      deviceId: d.device_id,
      deviceName: d.device_label || d.platform || 'Aparelho',
      platform: d.platform || '',
      appVersion: d.version || '',
      activeSlots: Array.isArray(d.active_slots) ? d.active_slots : [],
      online,
      heartbeatAt: d.heartbeat_at || null
    };
  });
  const deviceMap = new Map(devices.map((d) => [d.deviceId, d]));
  const slotRowMap = new Map((slotRows || []).map((r) => [normalizeSlotId(r.slot_id), r]));

  const slots = {};
  for (const id of WA_SLOT_IDS) {
    const cfg = slotsCfg[id];
    const row = slotRowMap.get(id);
    if (row) {
      const dev = row.device_id ? deviceMap.get(row.device_id) : null;
      // Considera online tanto pelo heartbeat do slot quanto pelo dispositivo vinculado
      const slotOnline =
        (Boolean(row.worker_online) && isWorkerHeartbeatFresh(row.worker_heartbeat_at)) ||
        Boolean(dev?.online && row.status !== 'disconnected');
      const mapped = mapCloudRuntimeToWaState(
        {
          ...row,
          worker_online: slotOnline,
          worker_heartbeat_at: row.worker_heartbeat_at || dev?.heartbeatAt || null
        },
        botEnabled
      );
      slots[id] = {
        ...mapped,
        slotId: id,
        label: cfg.label,
        aiEnabled: cfg.aiEnabled !== false,
        deviceId: row.device_id || null,
        deviceName: dev?.deviceName || row.device_label || null
      };
    } else if (id === 'slot_1' && rtRow) {
      // Retrocompatibilidade 100% transparente caso o motor ainda esteja em v5.5.x antes do update!
      const mapped = mapCloudRuntimeToWaState(rtRow, botEnabled);
      slots[id] = {
        ...mapped,
        slotId: 'slot_1',
        label: cfg.label,
        aiEnabled: cfg.aiEnabled !== false,
        deviceId: devices[0]?.deviceId || null,
        deviceName: devices[0]?.deviceName || (rtRow.worker_platform ? rtRow.worker_platform.split('·')[0].trim() : null)
      };
    } else {
      slots[id] = {
        slotId: id,
        label: cfg.label,
        aiEnabled: cfg.aiEnabled !== false,
        status: 'disconnected',
        rawStatus: 'disconnected',
        reconnecting: false,
        qrDataUrl: null,
        pairingCode: null,
        connectedUser: null,
        lastKnownUser: null,
        lastError: null,
        botEnabled,
        deviceId: null,
        deviceName: null,
        workerOnline: devices.some((d) => d.online),
        workerHeartbeatAt: null,
        workerPlatform: null,
        workerVersion: null
      };
    }
  }

  // Se slot_1 veio desconectado de zapia_wa_slots legado do backfill, mas zapia_wa_runtime está online num motor 5.5.9 em transição, prioriza o vivo!
  if (slots.slot_1.status === 'disconnected' && rtRow) {
    const legacyMapped = mapCloudRuntimeToWaState(rtRow, botEnabled);
    if (legacyMapped.workerOnline && legacyMapped.status !== 'disconnected') {
      slots.slot_1 = {
        ...slots.slot_1,
        ...legacyMapped
      };
    }
  }

  const onlineDevices = devices.filter((d) => d.online);
  const anyWorkerOnline =
    onlineDevices.length > 0 ||
    WA_SLOT_IDS.some((id) => slots[id].workerOnline) ||
    (Boolean(rtRow?.worker_online) && isWorkerHeartbeatFresh(rtRow?.worker_heartbeat_at));

  const primarySlot =
    slots.slot_1.status === 'connected'
      ? slots.slot_1
      : (WA_SLOT_IDS.map((id) => slots[id]).find((s) => s.status === 'connected') || slots.slot_1);

  return {
    ...primarySlot,
    workerOnline: anyWorkerOnline,
    workerPlatform: primarySlot.workerPlatform || onlineDevices[0]?.platform || rtRow?.worker_platform || null,
    workerHeartbeatAt: primarySlot.workerHeartbeatAt || onlineDevices[0]?.heartbeatAt || rtRow?.worker_heartbeat_at || null,
    proactive: rtRow?.proactive_state || primarySlot.proactive || {
      running: false,
      paused: false,
      channelMode: 'auto_rotate',
      remaining: 0,
      sentSession: 0,
      nextRunAt: null,
      dailySent: 0,
      dailyLimit: 25,
      preview: []
    },
    connectedCount: WA_SLOT_IDS.filter((id) => slots[id].status === 'connected').length,
    maxWaSlots: Math.max(1, Math.min(3, Number(maxWaSlots) || 1)),
    slots,
    devices,
    onlineDevicesCount: onlineDevices.length
  };
}

/**
 * Login com Usuário + Senha (sem exibir e-mail técnico para o cliente).
 */
function requireActiveRegisteredProfile(profile, error, userId) {
  if (error) {
    const err = new Error('Não foi possível validar o perfil da conta. Tente novamente.');
    err.code = 'ACCOUNT_PROFILE_UNAVAILABLE';
    err.statusCode = 503;
    throw err;
  }
  if (!profile || profile.user_id !== userId) {
    const err = new Error('Conta sem perfil autorizado. Procure o administrador.');
    err.code = 'ACCOUNT_NOT_REGISTERED';
    throw err;
  }
  if (profile.is_active !== true) {
    const err = new Error('Esta conta está bloqueada pelo administrador.');
    err.code = 'ACCOUNT_BLOCKED';
    throw err;
  }
  return profile;
}

export async function signInWithUsernamePassword(usernameInput, password) {
  const email = usernameToAuthEmail(usernameInput);
  if (!email || !password) {
    throw new Error('Informe seu usuário e senha.');
  }

  const anon = createAnonClient();
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: String(password)
  });

  if (error || !data?.session || !data?.user) {
    throw new Error('Usuário ou senha inválidos.');
  }

  const authed = createAnonClient(data.session.access_token);
  const { data: profileData, error: profileError } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();
  const profile = requireActiveRegisteredProfile(profileData, profileError, data.user.id);

  await authed
    .from('zapia_users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', data.user.id);

  // Garante que zapia_workspaces e zapia_wa_runtime existam para esta conta
  const { data: wsExisting } = await authed
    .from('zapia_workspaces')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!wsExisting) {
    const cleanDb = createCleanDatabaseForNewTenant(profile.display_name || profile.username);
    await authed.from('zapia_workspaces').insert({
      user_id: data.user.id,
      business: cleanDb.business,
      settings: cleanDb.settings,
      stats: cleanDb.stats,
      logs: [],
      simulator_history: [],
      proactive_queue: [],
      custom_pack: {},
      updated_at: new Date().toISOString()
    });
  }

  const { data: rtExisting } = await authed
    .from('zapia_wa_runtime')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!rtExisting) {
    await authed.from('zapia_wa_runtime').insert({
      user_id: data.user.id,
      status: 'disconnected',
      qr_data_url: '',
      pairing_code: '',
      connected_user: null,
      last_error: '',
      proactive_state: { queueLength: 0, paused: false, processing: false },
      worker_online: false,
      worker_platform: '',
      updated_at: new Date().toISOString()
    });
  }

  return {
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    },
    user: {
      id: data.user.id,
      username: profile.username,
      displayName: profile.display_name || profile.username,
      role: profile.role || 'user',
      maxWaSlots: clampMaxWaSlots(profile.max_wa_slots, profile.role),
      isActive: profile.is_active !== false
    }
  };
}

/**
 * Permite que o próprio cliente/usuário autenticado troque sua senha com segurança
 * (exige confirmação da senha atual; funciona tanto na Vercel quanto no Termux/PC sem expor service_role).
 */
export async function changeOwnPassword(usernameInput, currentPassword, newPassword) {
  const cleanNew = String(newPassword || '');
  if (cleanNew.length < 6) {
    throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  }
  const verified = await signInWithUsernamePassword(usernameInput, currentPassword).catch(() => null);
  if (!verified?.session?.accessToken) {
    throw new Error('Sua senha atual está incorreta.');
  }

  const client = createAnonClient();
  const { error: sessErr } = await client.auth.setSession({
    access_token: verified.session.accessToken,
    refresh_token: verified.session.refreshToken
  });
  if (sessErr) {
    throw new Error('Não foi possível validar sua sessão para trocar a senha.');
  }

  const { error: updErr } = await client.auth.updateUser({ password: cleanNew });
  if (updErr) {
    throw new Error(updErr.message || 'Falha ao atualizar a senha.');
  }

  return signInWithUsernamePassword(usernameInput, cleanNew);
}

export async function refreshCloudSession(refreshToken) {
  if (!refreshToken) throw new Error('Sessão expirada. Faça login novamente.');
  const anon = createAnonClient();
  const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session || !data?.user) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  const refreshedSession = {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at
  };
  const authed = createAnonClient(data.session.access_token);
  const { data: profileData, error: profileError } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();
  let profile;
  try {
    profile = requireActiveRegisteredProfile(profileData, profileError, data.user.id);
  } catch (err) {
    // Auth pode ter rotacionado o refresh token antes da consulta falhar. Preserve
    // somente na falha temporária, sem declarar autorização nem expor perfil.
    if (err.code === 'ACCOUNT_PROFILE_UNAVAILABLE') err.retrySession = refreshedSession;
    throw err;
  }

  return {
    session: refreshedSession,
    user: {
      id: data.user.id,
      username: profile?.username || normalizeUsername(data.user.email || ''),
      displayName: profile?.display_name || profile?.username || 'Usuário',
      role: profile?.role || 'user',
      maxWaSlots: clampMaxWaSlots(profile?.max_wa_slots, profile?.role),
      isActive: profile?.is_active !== false
    }
  };
}

export async function verifyCloudAccessToken(accessToken) {
  if (!accessToken) return null;
  const anon = createAnonClient();
  const { data, error } = await anon.auth.getUser(accessToken);
  if (error || !data?.user) return null;

  const authed = createAnonClient(accessToken);
  const { data: profileData, error: profileError } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();

  // Perfil é obrigatório; erro de consulta não equivale a uma conta ativa.
  const effectiveProfile = requireActiveRegisteredProfile(profileData, profileError, data.user.id);

  return {
    client: authed,
    authUser: data.user,
    profile: effectiveProfile
  };
}

/**
 * Modo Suporte 1-Clique (Impersonation Exclusiva do Admin Master):
 * Carrega o workspace isolado de um cliente específico usando service_role no servidor,
 * somente após comprovar que o token chamador pertence ao Admin Master.
 */
export async function loadTenantContextAsMasterSupport(targetUserId) {
  const admin = getAdminClient();
  const { data: targetProfile, error } = await admin
    .from('zapia_users')
    .select('*')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (error || !targetProfile) {
    const notFound = new Error('Conta de cliente não encontrada para Modo Suporte.');
    notFound.statusCode = 404;
    throw notFound;
  }

  const fakeAuthUser = {
    id: targetProfile.user_id,
    email: usernameToAuthEmail(targetProfile.username)
  };

  const tenantStore = await loadTenantContextFromCloud(admin, fakeAuthUser, targetProfile);
  return {
    adminClient: admin,
    targetAuthUser: fakeAuthUser,
    targetProfile,
    tenantStore
  };
}

/**
 * Carrega o workspace isolado da conta logada a partir do Supabase (usado em cada request Serverless na Vercel).
 */
// Paginação por chave evita o limite padrão de 1.000 linhas da API e mantém os chips separados.
export async function fetchAllCloudContacts(client, uid, { since = '', fields = 'chat_id, data, updated_at' } = {}) {
  const rows = [];
  let after = '';
  for (;;) {
    let q = client.from('zapia_contacts').select(fields).eq('user_id', uid).order('chat_id', { ascending: true }).limit(500);
    if (since) q = q.gt('updated_at', since);
    if (after) q = q.gt('chat_id', after);
    const { data, error } = await q;
    if (error) throw new Error(`Falha ao carregar conversas: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('Resposta inválida ao carregar conversas.');
    rows.push(...data);
    if (data.length < 500) break;
    const next = data[data.length - 1]?.chat_id;
    if (!next || next <= after) throw new Error('Paginação de conversas não avançou.');
    after = next;
  }
  return rows;
}

export async function loadTenantContextFromCloud(client, authUser, profile, { scopedContactId = null } = {}) {
  const uid = authUser.id;
  const isMaster = profile?.role === 'master';

  const [wsRes, contactsRes, rtRes, slotsRes, devicesRes] = await Promise.all([
    client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
    (scopedContactId ? fetchScopedCloudContact(client, uid, scopedContactId) : fetchAllCloudContacts(client, uid, { fields: 'chat_id, data' })).then(data => ({ data })),
    client.from('zapia_wa_runtime').select('*').eq('user_id', uid).maybeSingle(),
    client.from('zapia_wa_slots').select('*').eq('user_id', uid),
    client.from('zapia_worker_devices').select('*').eq('user_id', uid).order('heartbeat_at', { ascending: false })
  ]);

  let ws = wsRes.data;
  if (!ws) {
    const cleanDb = createCleanDatabaseForNewTenant(profile?.display_name || profile?.username);
    ws = {
      user_id: uid,
      business: cleanDb.business,
      settings: cleanDb.settings,
      stats: cleanDb.stats,
      logs: [],
      simulator_history: [],
      proactive_queue: [],
      custom_pack: {}
    };
  }

  const contactsMap = {};
  for (const row of contactsRes.data || []) {
    if (row?.chat_id && row?.data) {
      contactsMap[row.chat_id] = row.data;
    }
  }

  const initialData = {
    business: ws.business,
    settings: ws.settings,
    stats: ws.stats,
    logs: Array.isArray(ws.logs) ? ws.logs : [],
    simulatorHistory: Array.isArray(ws.simulator_history) ? ws.simulator_history : [],
    proactiveQueue: Array.isArray(ws.proactive_queue) ? ws.proactive_queue : [],
    customPacks: ws.custom_pack && typeof ws.custom_pack === 'object' ? ws.custom_pack : {},
    contacts: contactsMap
  };

  const tenantStore = new Storage({
    inMemory: true,
    isCloudTenant: true,
    userId: uid,
    username: profile?.username || '',
    userRole: profile?.role || 'user',
    initialData,
    fallbackClean: !isMaster
  });

  const maxWaSlots = clampMaxWaSlots(profile?.max_wa_slots, profile?.role);
  tenantStore.cloudClient = client;
  tenantStore.partialContactSnapshot = Boolean(scopedContactId);
  tenantStore.maxWaSlots = maxWaSlots;
  tenantStore.waRuntime = buildCloudMultiSlotWaState({
    rtRow: rtRes.data,
    slotRows: slotsRes?.data || [],
    deviceRows: devicesRes?.data || [],
    settings: tenantStore.data.settings,
    maxWaSlots
  });
  tenantStore.workerDevices = tenantStore.waRuntime.devices || [];

  tenantStore.flushCloud = async () => {
    await flushTenantStoreToCloud(client, uid, tenantStore, { isWorkerSync: false });
  };

  return tenantStore;
}

export async function flushTenantStoreToCloud(client, userId, tenantStore, opts = {}) {
  if (!client || !userId || !tenantStore) return;
  const isWorkerSync = Boolean(opts?.isWorkerSync);

  // Apenas requests de API Web inferem deleção por ausência de chave no mapa completo;
  // Em workers Multi-Dispositivo (Furo #3), NUNCA inferimos DELETE implícito para um aparelho não apagar conversas de outro!
  if (!isWorkerSync && !tenantStore.partialContactSnapshot) {
    const currentKeys = new Set(Object.keys(tenantStore.data.contacts || {}));
    for (const prevKey of tenantStore.initialContactKeys || []) {
      if (!currentKeys.has(prevKey)) {
        tenantStore.deletedContactIds.add(prevKey);
      }
    }
  }

  const tasks = [];
  const pendingDirty = [...tenantStore.dirtyContactIds];
  const pendingDeletes = [...tenantStore.deletedContactIds];
  const pendingWorkspace = tenantStore.workspaceDirty;
  let configHashToConfirm = '';
  try {
  if (tenantStore.workspaceDirty) {
    const currentConfigHash = computeWorkspaceConfigHash(tenantStore.data);
    const onlyTelemetryChanged =
      isWorkerSync &&
      Boolean(opts?.lastConfigHash) &&
      currentConfigHash === opts.lastConfigHash;

    if (onlyTelemetryChanged) {
      // Atualização parcial atômica via RPC (Furo #4): preserva 100% business/settings/custom_pack editados na Vercel!
      tasks.push(
        client
          .rpc('update_zapia_workspace_telemetry', {
            p_stats: tenantStore.data.stats || {},
            p_logs: (tenantStore.data.logs || []).slice(0, 150),
            p_proactive_queue: Array.isArray(tenantStore.data.proactiveQueue) ? tenantStore.data.proactiveQueue : []
          })
          .then(({ error }) => {
            if (error) throw new Error(`Falha ao salvar telemetria: ${error.message}`);
          })
      );
    } else {
      tasks.push(
        client.from('zapia_workspaces').upsert(
          {
            user_id: userId,
            business: tenantStore.data.business,
            settings: tenantStore.data.settings,
            stats: tenantStore.data.stats,
            logs: (tenantStore.data.logs || []).slice(0, 150),
            simulator_history: (tenantStore.data.simulatorHistory || []).slice(-60),
            proactive_queue: Array.isArray(tenantStore.data.proactiveQueue) ? tenantStore.data.proactiveQueue : [],
            custom_pack: tenantStore.data.customPacks || {},
            updated_at: trueNowIso()
          },
          { onConflict: 'user_id' }
        )
      );
      configHashToConfirm = currentConfigHash;
    }
    tenantStore.workspaceDirty = false;
  }

  if (tenantStore.deletedContactIds.size > 0) {
    const delIds = Array.from(tenantStore.deletedContactIds);
    tenantStore.deletedContactIds.clear();
    for (let i = 0; i < delIds.length; i += 80) {
      const slice = delIds.slice(i, i + 80);
      tasks.push(
        client
          .from('zapia_contacts')
          .delete()
          .eq('user_id', userId)
          .in('chat_id', slice)
      );
    }
  }

  if (tenantStore.dirtyContactIds.size > 0) {
    const dirtyIds = Array.from(tenantStore.dirtyContactIds);
    tenantStore.dirtyContactIds.clear();

    // Proteção Anti-Sobrescrita Multi-Dispositivo (Vercel <-> Termux <-> PC):
    // Faz união CRDT em blocos de até 80 conversas sujas (sem o limite antigo de 15 conversas!)
    const remoteMap = new Map();
    {
      for (let i = 0; i < dirtyIds.length; i += 80) {
        const chunkIds = dirtyIds.slice(i, i + 80);
        try {
          const { data: remoteRows, error: remoteError } = await client
            .from('zapia_contacts')
            .select('chat_id, data')
            .eq('user_id', userId)
            .in('chat_id', chunkIds);
          if (remoteError) throw new Error(remoteError.message);
          if (Array.isArray(remoteRows)) {
            for (const r of remoteRows) {
              remoteMap.set(r.chat_id, r.data);
            }
          }
        } catch (err) {
          throw new Error(`Falha ao reconciliar conversas: ${err.message}`);
        }
      }
    }

    const rows = [];
    for (const cid of dirtyIds) {
      const currentContact = tenantStore.data.contacts[cid];
      if (!currentContact) continue;
      const c = structuredClone(currentContact);
      const remoteData = remoteMap.get(cid);
      const effectiveClearedAt =
        (c.historyClearedAt || '') >= (remoteData?.historyClearedAt || '')
          ? (c.historyClearedAt || remoteData?.historyClearedAt || null)
          : (remoteData?.historyClearedAt || null);
      if (effectiveClearedAt) c.historyClearedAt = effectiveClearedAt;
      // A fronteira de limpeza vale mesmo quando o outro aparelho já gravou
      // uma lista vazia; caso contrário um cache antigo ressuscita as mensagens.
      if (effectiveClearedAt || remoteData?.messages?.length) {
        c.messages = mergeContactMessagesUnion(c.messages, remoteData?.messages || [], effectiveClearedAt);
        const lastReal = [...(c.messages || [])].reverse().find((m) => m.role !== 'internal_note');
        if (lastReal?.timestamp && (!c.lastMessageAt || lastReal.timestamp > c.lastMessageAt)) {
          c.lastMessageAt = lastReal.timestamp;
        }
      }
      rows.push({
        user_id: userId,
        chat_id: cid,
        data: c,
        last_message_at: c.lastMessageAt || trueNowIso(),
        updated_at: trueNowIso()
      });
    }
    for (let i = 0; i < rows.length; i += 60) {
      const batch = rows.slice(i, i + 60);
      tasks.push(
        client.from('zapia_contacts').upsert(batch, { onConflict: 'user_id,chat_id' })
      );
    }
  }

  if (tasks.length > 0) {
    const results = await Promise.all(tasks);
    const failed = results.find((result) => result?.error);
    if (failed) throw new Error(failed.error.message || 'Falha ao sincronizar com a nuvem.');
    tenantStore.initialContactKeys = new Set(Object.keys(tenantStore.data.contacts || {}));
    if (configHashToConfirm && typeof opts?.onConfigFlushed === 'function') opts.onConfigFlushed(configHashToConfirm);
  }
  } catch (err) {
    if (pendingWorkspace) tenantStore.workspaceDirty = true;
    for (const id of pendingDirty) if (tenantStore.data.contacts[id]) tenantStore.dirtyContactIds.add(id);
    for (const id of pendingDeletes) if (!tenantStore.data.contacts[id]) tenantStore.deletedContactIds.add(id);
    throw err;
  }
}

/**
 * Faz upload de áudio OGG/Opus, imagem de catálogo ou mídia recebida para o bucket isolado `<user_id>/<filename>`.
 */
const DANGEROUS_ACTIVE_MIMES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/javascript|application\/x-javascript|text\/xml)/i;
const DANGEROUS_ACTIVE_EXTS = /\.(html?|xhtml|svg|s?htm|mjs|cjs|js)$/i;

export async function uploadMediaBufferToCloud(client, userId, filename, buffer, contentType = 'application/octet-stream') {
  if (!client || !userId || !filename || !buffer) return null;
  let safeName = path.basename(filename);
  let safeContentType = String(contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  // Blindagem Anti-Stored-XSS: impede execução de HTML/SVG/JS ativo em URLs públicas do bucket
  if (DANGEROUS_ACTIVE_MIMES.test(safeContentType) || DANGEROUS_ACTIVE_EXTS.test(safeName)) {
    safeContentType = 'application/octet-stream';
    if (DANGEROUS_ACTIVE_EXTS.test(safeName)) {
      safeName = `${safeName}.bin`;
    }
  }
  const storagePath = `${userId}/${safeName}`;
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(storagePath, buffer, {
    contentType: safeContentType,
    upsert: true
  });
  if (error) {
    console.error('[CloudMedia] Falha ao enviar mídia para Supabase Storage:', error.message);
    return null;
  }
  const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

// URLs de mídia vêm de dados de clientes/comandos e não podem apontar para
// outros servidores, serviços internos ou arquivos de outra conta.
const CLOUD_MEDIA_MAX_BYTES = 35 * 1024 * 1024;
function authorizedCloudMediaUrl(remoteUrl, expectedFilename = '') {
  try {
    const u = new URL(remoteUrl);
    const base = new URL(SUPABASE_URL);
    if (u.origin !== base.origin || u.username || u.password || u.hash) return null;
    const prefix = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
    if (!u.pathname.startsWith(prefix)) return null;
    const parts = u.pathname.slice(prefix.length).split('/').map(decodeURIComponent);
    const currentUserId = String(storage.userId || '');
    if (parts.length !== 2 || !currentUserId || parts[0] !== currentUserId) return null;
    if (!parts[1] || parts[1] === '.' || parts[1] === '..' || /[\\/\0]/.test(parts[1])) return null;
    if (expectedFilename && parts[1] !== path.basename(expectedFilename)) return null;
    return u.href;
  } catch { return null; }
}

export async function fetchCloudMediaBuffer(remoteUrl, expectedFilename = '') {
  const safeUrl = authorizedCloudMediaUrl(remoteUrl, expectedFilename);
  if (!safeUrl) return null;
  try {
    const resp = await fetch(safeUrl, { redirect: 'error', signal: AbortSignal.timeout(25_000) });
    if (!resp.ok || Number(resp.headers.get('content-length') || 0) > CLOUD_MEDIA_MAX_BYTES) return null;
    if (!resp.body) return null;
    const chunks = []; let total = 0;
    for await (const chunk of resp.body) {
      total += chunk.length;
      if (total > CLOUD_MEDIA_MAX_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  } catch {
    console.error('[CloudMedia] Não foi possível baixar mídia autorizada.');
    return null;
  }
}

/** Garante cache local de mídia autorizada antes do envio no motor. */
export async function ensureLocalMediaCached(filename, remoteUrl = '') {
  if (!filename && !remoteUrl) return null;
  let safeName;
  try { safeName = path.basename(filename || new URL(remoteUrl).pathname); } catch { return null; }
  if (!safeName || safeName === '.' || safeName === '..') return null;
  if (remoteUrl && !authorizedCloudMediaUrl(remoteUrl, safeName)) return null;
  // Sem URL, conservar o comportamento dos arquivos locais. Com URL, nunca
  // reutilizar o arquivo legado compartilhado de uma conta anterior.
  const localPath = remoteUrl
    ? tenantCloudMediaCachePath(safeName, storage.userId)
    : path.join(UPLOADS_DIR, safeName);
  if (!localPath) return null;
  if (fs.existsSync(localPath)) return localPath;
  if (!remoteUrl) return null;
  const data = await fetchCloudMediaBuffer(remoteUrl, safeName);
  if (!data) return null;
  try { fs.mkdirSync(path.dirname(localPath), { recursive: true }); fs.writeFileSync(localPath, data); return localPath; }
  catch { return null; }
}

/**
 * Despacha um comando ao vivo da Vercel para o Motor WhatsApp (Termux / PC) daquela conta,
 * roteando automaticamente para o dispositivo dono do Chip (`slot_id` / `target_device_id`)
 * e exigindo escolha explícita quando 2+ aparelhos estão online no pareamento de um novo Chip!
 */
export async function dispatchCommandToWorker(client, userId, action, payload = {}, timeoutMs = 8800, opts = {}) {
  const [rtRes, slotsRes, devicesRes, userRes] = await Promise.all([
    client.from('zapia_wa_runtime').select('*').eq('user_id', userId).maybeSingle(),
    client.from('zapia_wa_slots').select('*').eq('user_id', userId),
    client.from('zapia_worker_devices').select('*').eq('user_id', userId),
    client.from('zapia_users').select('role, max_wa_slots').eq('user_id', userId).maybeSingle()
  ]);

  const rt = rtRes.data;
  const slotRows = slotsRes.data || [];
  const onlineDevices = (devicesRes.data || []).filter(
    (d) => Boolean(d?.online) && isWorkerHeartbeatFresh(d?.heartbeat_at)
  );
  const legacyOnline = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);

  if (onlineDevices.length === 0 && !legacyOnline) {
    const err = new Error(
      'Seu Motor WhatsApp (Termux no celular ou PC) está offline no momento. Inicie o motor na sua conta para conectar o WhatsApp ou disparar mensagens ao vivo.'
    );
    err.statusCode = 503;
    err.workerOffline = true;
    throw err;
  }

  // Determina qual slot (slot_1, slot_2, slot_3) este comando atinge
  let resolvedSlotId = null;
  if (opts?.slotId || payload?.slotId) {
    resolvedSlotId = normalizeSlotId(opts?.slotId || payload?.slotId);
  } else if (payload?.chatId || payload?.targetChatId) {
    resolvedSlotId = parseContactChannelKey(payload.chatId || payload.targetChatId).slotId;
  } else if (payload?.channelMode && WA_SLOT_IDS.includes(payload.channelMode)) {
    resolvedSlotId = payload.channelMode;
  } else if (action === 'wa_connect' || action === 'wa_disconnect') {
    resolvedSlotId = 'slot_1';
  }

  // Validação Server-Side da Cota SaaS de Chips por Cliente (Furo #12)
  if (action === 'wa_connect' && resolvedSlotId) {
    const maxSlots = clampMaxWaSlots(userRes.data?.max_wa_slots, userRes.data?.role);
    const slotNum = Number(resolvedSlotId.slice(-1)) || 1;
    if (slotNum > maxSlots) {
      const quotaErr = new Error(
        `Seu plano atual permite até ${maxSlots} número(s) de WhatsApp conectado(s). Solicite ao administrador a liberação do Chip ${slotNum}.`
      );
      quotaErr.statusCode = 403;
      throw quotaErr;
    }
  }

  // Roteamento Inteligente por Dispositivo:
  // 1) Se veio targetDeviceId explícito -> respeita.
  // 2) Se o slot já pertence a um dispositivo online -> envia direto para ele.
  // 3) Se for novo pareamento (wa_connect) e houver 2+ dispositivos online sem targetDeviceId -> pede escolha na UI!
  // 4) Se houver exatamente 1 dispositivo online -> roteia automaticamente para ele sem burocracia!
  let resolvedTargetDeviceId = opts?.targetDeviceId || payload?.targetDeviceId || null;
  const existingSlotRow = resolvedSlotId
    ? slotRows.find((s) => normalizeSlotId(s.slot_id) === resolvedSlotId)
    : null;
  const slotOwnerDevice = existingSlotRow?.device_id
    ? onlineDevices.find((d) => d.device_id === existingSlotRow.device_id)
    : null;

  if (!resolvedTargetDeviceId && slotOwnerDevice && (existingSlotRow.status !== 'disconnected' || action !== 'wa_connect')) {
    resolvedTargetDeviceId = slotOwnerDevice.device_id;
  }

  if (!resolvedTargetDeviceId && action === 'wa_connect' && onlineDevices.length > 1) {
    return {
      ok: true,
      requiresDeviceChoice: true,
      slotId: resolvedSlotId || 'slot_1',
      devices: onlineDevices.map((d) => ({
        deviceId: d.device_id,
        deviceName: d.device_label || d.platform || 'Aparelho Online',
        platform: d.platform || '',
        appVersion: d.version || '',
        activeSlots: Array.isArray(d.active_slots) ? d.active_slots : []
      })),
      message: 'Detectamos mais de um aparelho online nesta conta. Escolha em qual aparelho deseja conectar este Chip.'
    };
  }

  if (!resolvedTargetDeviceId && onlineDevices.length === 1) {
    resolvedTargetDeviceId = onlineDevices[0].device_id;
  }

  const startedAtIso = trueNowIso();
  const cmdPayload = resolvedSlotId ? { ...payload, slotId: resolvedSlotId } : payload;
  const { data: cmd, error: insErr } = await client
    .from('zapia_commands')
    .insert({
      user_id: userId,
      action,
      slot_id: resolvedSlotId,
      target_device_id: resolvedTargetDeviceId,
      payload: cmdPayload,
      status: 'pending'
    })
    .select('*')
    .single();

  if (insErr || !cmd) {
    throw new Error(insErr?.message || 'Não foi possível enviar o comando para o Motor WhatsApp.');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 280));
    const { data: row } = await client
      .from('zapia_commands')
      .select('*')
      .eq('id', cmd.id)
      .maybeSingle();

    if (row?.status === 'done') {
      return row.result || { ok: true };
    }
    if (row?.status === 'error') {
      throw new Error(row.error_text || 'Falha ao executar ação no Motor WhatsApp.');
    }

    // Para conexão de QR Code / Código de 8 dígitos em qualquer Chip (1, 2 ou 3), retorna assim que o código surgir!
    if (action === 'wa_connect') {
      const targetSlot = resolvedSlotId || 'slot_1';
      const { data: freshSlot } = await client
        .from('zapia_wa_slots')
        .select('*')
        .eq('user_id', userId)
        .eq('slot_id', targetSlot)
        .maybeSingle();

      const candidate = freshSlot && freshSlot.updated_at >= startedAtIso ? freshSlot : null;
      if (candidate) {
        if (payload?.pairingPhone && candidate.pairing_code) {
          return {
            ok: true,
            slotId: targetSlot,
            pairingCode: candidate.pairing_code,
            slotState: mapCloudRuntimeToWaState(candidate)
          };
        }
        if (!payload?.pairingPhone && (candidate.qr_data_url || candidate.status === 'connected')) {
          return {
            ok: true,
            slotId: targetSlot,
            qrDataUrl: candidate.qr_data_url,
            slotState: mapCloudRuntimeToWaState(candidate)
          };
        }
      }

      // Fallback para motor 5.5.x em slot_1 antes do auto-update
      if (targetSlot === 'slot_1') {
        const { data: freshRt } = await client
          .from('zapia_wa_runtime')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (freshRt && freshRt.updated_at >= startedAtIso) {
          if (payload?.pairingPhone && freshRt.pairing_code) {
            return { ok: true, slotId: 'slot_1', pairingCode: freshRt.pairing_code, waState: mapCloudRuntimeToWaState(freshRt) };
          }
          if (!payload?.pairingPhone && (freshRt.qr_data_url || freshRt.status === 'connected')) {
            return { ok: true, slotId: 'slot_1', qrDataUrl: freshRt.qr_data_url, waState: mapCloudRuntimeToWaState(freshRt) };
          }
        }
      }
    }
  }

  return {
    ok: true,
    queued: true,
    commandId: cmd.id,
    slotId: resolvedSlotId,
    targetDeviceId: resolvedTargetDeviceId,
    message: 'Comando enviado ao Motor WhatsApp e em processamento.'
  };
}

// ============================================================================
// GERENCIAMENTO DE CONTAS (EXCLUSIVO ADMIN MASTER — SERVER-SIDE SERVICE ROLE)
// ============================================================================

export async function listManagedUsers() {
  const admin = getAdminClient();
  const [usersRes, rtRes, slotsRes, devicesRes, contactsRes, wsRes] = await Promise.all([
    admin.from('zapia_users').select('*').order('created_at', { ascending: true }),
    admin.from('zapia_wa_runtime').select('user_id, status, connected_user, worker_online, worker_heartbeat_at, worker_platform'),
    admin.from('zapia_wa_slots').select('user_id, slot_id, device_id, device_label, status, connected_user, worker_online, worker_heartbeat_at'),
    admin.from('zapia_worker_devices').select('user_id, device_id, device_label, platform, version, online, heartbeat_at'),
    admin.from('zapia_contacts').select('user_id, data'),
    admin.from('zapia_workspaces').select('user_id, business, settings, stats, updated_at')
  ]);

  if (usersRes.error) throw new Error(usersRes.error.message);

  const rtMap = new Map((rtRes.data || []).map((r) => [r.user_id, r]));
  const wsMap = new Map((wsRes.data || []).map((w) => [w.user_id, w]));
  const slotsByUser = new Map();
  for (const s of slotsRes.data || []) {
    const arr = slotsByUser.get(s.user_id) || [];
    arr.push(s);
    slotsByUser.set(s.user_id, arr);
  }
  const devicesByUser = new Map();
  for (const d of devicesRes.data || []) {
    const arr = devicesByUser.get(d.user_id) || [];
    arr.push(d);
    devicesByUser.set(d.user_id, arr);
  }
  const contactStats = new Map();

  for (const c of contactsRes.data || []) {
    const uid = c.user_id;
    const prev = contactStats.get(uid) || { total: 0, awaitingHuman: 0, unread: 0, messages: 0 };
    prev.total += 1;
    const cd = c.data || {};
    if (cd.stage === 'aguardando_humano' && !cd.archived) prev.awaitingHuman += 1;
    prev.unread += Math.max(0, Number(cd.unreadCount) || 0);
    prev.messages += Array.isArray(cd.messages) ? cd.messages.length : 0;
    contactStats.set(uid, prev);
  }

  return (usersRes.data || []).map((u) => {
    const rt = rtMap.get(u.user_id);
    const ws = wsMap.get(u.user_id);
    const maxWaSlots = clampMaxWaSlots(u.max_wa_slots, u.role);
    const multiWa = buildCloudMultiSlotWaState({
      rtRow: rt,
      slotRows: slotsByUser.get(u.user_id) || [],
      deviceRows: devicesByUser.get(u.user_id) || [],
      settings: ws?.settings || {},
      maxWaSlots
    });
    const cStat = contactStats.get(u.user_id) || { total: 0, awaitingHuman: 0, unread: 0, messages: 0 };
    const workerOnline = Boolean(multiWa.workerOnline);
    const waConnected = multiWa.connectedCount > 0;

    const ai = ws?.settings?.ai || {};
    const hasAiKey = Boolean(
      String(ai.geminiApiKey || '').trim() ||
      String(ai.geminiKeyPool || '').trim() ||
      String(ai.groqApiKey || '').trim() ||
      String(ai.openaiApiKey || '').trim() ||
      String(ai.openrouterApiKey || '').trim()
    );

    const biz = ws?.business || {};
    const defaultSummaryHint = 'Descreva aqui o que sua empresa vende';
    const hasCustomTraining = Boolean(
      biz.trainingPackId ||
      (biz.companySummary && !String(biz.companySummary).startsWith(defaultSummaryHint)) ||
      (Array.isArray(biz.faqs) && biz.faqs.length > 0) ||
      (Array.isArray(biz.knowledgeDocs) && biz.knowledgeDocs.length > 0)
    );
    const catalogCount = Array.isArray(biz.catalog) ? biz.catalog.length : 0;
    const voiceCount = Array.isArray(biz.voiceLibrary) ? biz.voiceLibrary.length : 0;
    const hasCatalogOrVoice = catalogCount > 0 || voiceCount > 0 || Boolean(biz.pix?.enabled && biz.pix?.key);

    const setupSteps = {
      aiKey: hasAiKey,
      training: hasCustomTraining,
      assets: hasCatalogOrVoice,
      whatsapp: waConnected
    };
    const setupScore = Object.values(setupSteps).filter(Boolean).length;
    const connectedPhones = WA_SLOT_IDS
      .map((id) => multiWa.slots[id])
      .filter((s) => s.status === 'connected' && s.connectedUser?.phone)
      .map((s) => s.connectedUser.phone);

    return {
      userId: u.user_id,
      username: u.username,
      displayName: u.display_name || u.username,
      customerPhone: u.customer_phone || '',
      adminNotes: u.admin_notes || '',
      role: u.role || 'user',
      maxWaSlots,
      connectedSlotsCount: multiWa.connectedCount,
      connectedPhones,
      onlineDevicesCount: multiWa.onlineDevicesCount,
      isActive: u.is_active !== false,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      businessName: biz.name || u.display_name || u.username,
      niche: biz.niche || '',
      botEnabled: ws?.settings?.botEnabled !== false,
      hasAiKey,
      hasCustomTraining,
      catalogCount,
      voiceCount,
      setupSteps,
      setupScore,
      contactsCount: cStat.total,
      awaitingHumanCount: cStat.awaitingHuman,
      unreadCount: cStat.unread,
      totalMessagesCount: cStat.messages,
      totalAiReplies: Number(ws?.stats?.totalAiReplies) || 0,
      workerOnline,
      workerPlatform: multiWa.workerPlatform || rt?.worker_platform || null,
      waStatus: workerOnline ? (multiWa.status || 'disconnected') : 'offline',
      connectedPhone: connectedPhones[0] || (rt?.connected_user?.id
        ? String(rt.connected_user.id).split(':')[0].split('@')[0]
        : (rt?.connected_user?.phone || null))
    };
  });
}

export async function createManagedUser({
  username,
  password,
  displayName,
  customerPhone = '',
  adminNotes = '',
  maxWaSlots = 1
}) {
  const admin = getAdminClient();
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error('O nome de usuário deve ter pelo menos 3 caracteres (letras/números).');
  }
  if (!password || String(password).length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }

  const email = usernameToAuthEmail(cleanUsername);
  const { data: existingRow, error: lookupError } = await admin
    .from('zapia_users')
    .select('user_id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (lookupError) {
    throw new Error('Não foi possível consultar os cadastros. Tente novamente.');
  }
  if (existingRow) {
    throw new Error(`Já existe uma conta com o usuário "${cleanUsername}".`);
  }

  const cleanDisplay = String(displayName || cleanUsername).trim();
  const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
  const cleanNotes = String(adminNotes || '').trim();
  const cleanMaxSlots = clampMaxWaSlots(maxWaSlots, 'user');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: String(password),
    email_confirm: true,
    app_metadata: { role: 'user' },
    user_metadata: {
      username: cleanUsername,
      display_name: cleanDisplay
    }
  });

  if (createErr || !created?.user) {
    throw new Error(createErr?.message || 'Não foi possível criar a conta no Supabase Auth.');
  }

  const uid = created.user.id;
  // Conta secundária nasce 100% LIMPA para qualquer nicho
  const cleanDb = createCleanDatabaseForNewTenant(cleanDisplay);

  // Auth já foi criado e não há transação entre Auth e Postgres. Não apagamos
  // automaticamente: uma falha pode ser ambígua ou haver atividade concorrente.
  // Criar o perfil ativo por último impede acesso com workspace incompleto.
  const partialError = () => new Error(
    `Cadastro incompleto: a conta @${cleanUsername} foi criada no Auth (ID ${uid}), mas não foi provisionada integralmente. Não tente recriar; regularize o cadastro no Supabase.`
  );
  const initialRows = await Promise.allSettled([
    admin.from('zapia_workspaces').upsert({
      user_id: uid,
      business: cleanDb.business,
      settings: cleanDb.settings,
      stats: cleanDb.stats,
      logs: [],
      simulator_history: [],
      proactive_queue: [],
      custom_pack: {},
      updated_at: trueNowIso()
    }, { onConflict: 'user_id' }),
    admin.from('zapia_wa_runtime').upsert({
      user_id: uid,
      status: 'disconnected',
      qr_data_url: '',
      pairing_code: '',
      connected_user: null,
      last_error: '',
      proactive_state: { queueLength: 0, paused: false, processing: false },
      worker_online: false,
      worker_platform: '',
      updated_at: trueNowIso()
    }, { onConflict: 'user_id' })
  ]);
  if (initialRows.some(result => result.status === 'rejected' || result.value?.error)) {
    throw partialError();
  }
  try {
    const { error: profileError } = await admin.from('zapia_users').upsert({
      user_id: uid,
      username: cleanUsername,
      display_name: cleanDisplay,
      customer_phone: cleanPhone,
      admin_notes: cleanNotes,
      role: 'user',
      max_wa_slots: cleanMaxSlots,
      is_active: true
    }, { onConflict: 'user_id' });
    if (profileError) throw partialError();
  } catch {
    throw partialError();
  }

  return {
    userId: uid,
    username: cleanUsername,
    displayName: cleanDisplay,
    customerPhone: cleanPhone,
    adminNotes: cleanNotes,
    role: 'user',
    maxWaSlots: cleanMaxSlots,
    isActive: true
  };
}

export async function updateManagedUser(
  targetUserId,
  { password, displayName, isActive, customerPhone, adminNotes, maxWaSlots } = {}
) {
  const admin = getAdminClient();
  const { data: target } = await admin
    .from('zapia_users')
    .select('*')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!target) throw new Error('Conta não encontrada.');
  if (target.role === 'master' && isActive === false) {
    throw new Error('A conta Master principal não pode ser bloqueada.');
  }

  const authPatch = {};
  if (password && String(password).trim().length >= 6) {
    authPatch.password = String(password).trim();
  }
  if (typeof isActive === 'boolean') {
    authPatch.ban_duration = isActive ? 'none' : '876000h';
  }
  if (displayName !== undefined) {
    authPatch.user_metadata = {
      username: target.username,
      display_name: String(displayName || target.username).trim()
    };
  }

  if (Object.keys(authPatch).length > 0) {
    const { error: authErr } = await admin.auth.admin.updateUserById(targetUserId, authPatch);
    if (authErr) throw new Error(authErr.message);
  }

  const dbPatch = {};
  if (displayName !== undefined) dbPatch.display_name = String(displayName || target.username).trim();
  if (typeof isActive === 'boolean') dbPatch.is_active = isActive;
  if (customerPhone !== undefined) dbPatch.customer_phone = String(customerPhone || '').replace(/\D/g, '');
  if (adminNotes !== undefined) dbPatch.admin_notes = String(adminNotes || '').trim();
  if (maxWaSlots !== undefined) dbPatch.max_wa_slots = clampMaxWaSlots(maxWaSlots, target.role);

  if (Object.keys(dbPatch).length > 0) {
    const { error: dbErr } = await admin.from('zapia_users').update(dbPatch).eq('user_id', targetUserId);
    if (dbErr) throw new Error(dbErr.message);
  }

  return { ok: true };
}

export async function deleteManagedUser(targetUserId) {
  const admin = getAdminClient();
  const { data: target } = await admin
    .from('zapia_users')
    .select('*')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!target) throw new Error('Conta não encontrada.');
  if (target.role === 'master') {
    throw new Error('A conta Master principal não pode ser excluída.');
  }

  // Remove arquivos do bucket zapia-media/<targetUserId>/ se houver
  try {
    const { data: files } = await admin.storage.from(MEDIA_BUCKET).list(targetUserId, { limit: 500 });
    if (files?.length) {
      await admin.storage.from(MEDIA_BUCKET).remove(files.map((f) => `${targetUserId}/${f.name}`));
    }
  } catch {}

  const { error } = await admin.auth.admin.deleteUser(targetUserId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ============================================================================
// MOTOR INDIVIDUAL NO TERMUX / WINDOWS PC (WORKER BRIDGE POR CONTA)
// ============================================================================

function detectWorkerPlatformLabel() {
  const isAndroid = Boolean(process.env.PREFIX?.includes('com.termux')) || os.platform() === 'android';
  if (isAndroid) return `Android · Termux · v${APP_VERSION}`;
  if (os.platform() === 'win32') return `Windows PC (${os.hostname()}) · v${APP_VERSION}`;
  return `${os.platform()} (${os.hostname()}) · v${APP_VERSION}`;
}

class FileSessionStorage {
  constructor(filePath) {
    this.filePath = filePath;
    this.cache = new Map();
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const [k, v] of Object.entries(parsed.items || {})) {
          this.cache.set(k, v);
        }
      }
    } catch {}
  }

  persist() {
    try {
      const obj = Object.fromEntries(this.cache.entries());
      fs.writeFileSync(this.filePath, JSON.stringify({ updatedAt: trueNowIso(), items: obj }, null, 2), 'utf8');
    } catch {}
  }

  getItem(key) {
    return this.cache.has(key) ? this.cache.get(key) : null;
  }

  setItem(key, value) {
    this.cache.set(key, value);
    this.persist();
  }

  removeItem(key) {
    this.cache.delete(key);
    this.persist();
  }

  clearAll() {
    this.cache.clear();
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {}
  }
}

class CloudWorkerBridge {
  constructor() {
    this.sessionStore = new FileSessionStorage(CLOUD_SESSION_FILE);
    this.deviceIdentity = getOrCreateDeviceIdentity();
    this.client = null;
    this.user = null;
    this.whatsappManager = null;
    this.broadcastFn = null;
    this.heartbeatTimer = null;
    this.commandPollTimer = null;
    this.campaignMotor = null;
    this.syncTimer = null;
    this.realtimeChannel = null;
    this.processingCommands = new Set();
    this.lastSyncedWorkspaceIso = '';
    this.lastSyncedContactsIso = '';
    this.lastSyncedConfigHash = '';
    this.peerSlotOwners = new Map(); // slot_id -> { deviceId, online, status, phone }
    this.syncInFlight = false;
    this.pendingFlush = false;
  }

  bindRuntime({ whatsappManager, broadcast }) {
    this.whatsappManager = whatsappManager;
    this.broadcastFn = broadcast;

    // Toda mudança de estado do Baileys (QR gerado, Código 8 dígitos, Conectado) sobe em tempo real (<150ms) p/ nuvem
    if (whatsappManager?.setStateChangeHook) {
      whatsappManager.setStateChangeHook(() => {
        this.pushRuntimeHeartbeat().catch(() => {});
      });
    }

    // Relay Multi-Dispositivo (Furo #7): se este aparelho gerar um alerta de fechamento no Chip 2/3,
    // mas o Chip 1 Principal estiver conectado em OUTRO aparelho online da mesma conta, repassa via nuvem para sair pelo Chip 1!
    if (whatsappManager?.setRemoteOwnerAlertRelay) {
      whatsappManager.setRemoteOwnerAlertRelay(async ({ ownerPhoneDigits, alertText }) => {
        if (!this.client || !this.user?.id) return false;
        const slot1Peer = this.peerSlotOwners.get('slot_1');
        if (!slot1Peer || !slot1Peer.online || slot1Peer.status !== 'connected' || slot1Peer.deviceId === this.deviceIdentity.deviceId) {
          return false;
        }
        try {
          const out = await dispatchCommandToWorker(
            this.client,
            this.user.id,
            'relay_owner_alert',
            { ownerPhoneDigits, alertText },
            6000,
            { slotId: 'slot_1', targetDeviceId: slot1Peer.deviceId }
          );
          return Boolean(out?.ok && !out?.queued);
        } catch {
          return false;
        }
      });
    }

    // Toda mutação local (nova msg WhatsApp, estágio CRM, estatística) agenda sync imediato para o Supabase
    localStorageInstance.onMutate = () => {
      this.scheduleLocalToCloudSync();
    };
  }

  getStatus() {
    this.deviceIdentity = getOrCreateDeviceIdentity();
    return {
      configured: isCloudConfigured(),
      loggedIn: Boolean(this.user?.id),
      user: this.user || null,
      deviceId: this.deviceIdentity.deviceId,
      deviceName: this.deviceIdentity.deviceName,
      platform: detectWorkerPlatformLabel()
    };
  }

  createPersistentWorkerClient() {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storage: this.sessionStore,
        storageKey: 'zapia_worker_auth'
      },
      realtime: { transport: WebSocket }
    });
  }

  ensurePerUserWhatsAppAuthDir(userId, role = 'user') {
    const userAuthDir = path.join(AUTH_DIR, userId);
    if (!fs.existsSync(userAuthDir)) {
      fs.mkdirSync(userAuthDir, { recursive: true });
    }
    // Se for a conta Master em máquina que já tinha sessão conectada na raiz data/wa_auth/creds.json, migra e limpa a raiz sem perder conexão!
    if (role === 'master') {
      const rootCreds = path.join(AUTH_DIR, 'creds.json');
      const targetCreds = path.join(userAuthDir, 'creds.json');
      if (fs.existsSync(rootCreds) && !fs.existsSync(targetCreds)) {
        try {
          for (const entry of fs.readdirSync(AUTH_DIR, { withFileTypes: true })) {
            if (entry.isFile()) {
              const srcFile = path.join(AUTH_DIR, entry.name);
              const dstFile = path.join(userAuthDir, entry.name);
              fs.copyFileSync(srcFile, dstFile);
              try {
                fs.unlinkSync(srcFile);
              } catch {
                // Ignora caso bloqueado
              }
            }
          }
          console.log('[CloudWorker] Sessão WhatsApp existente migrada para o cofre isolado da conta Master.');
        } catch (err) {
          console.warn('[CloudWorker] Aviso ao copiar sessão WhatsApp existente:', err.message);
        }
      } else if (fs.existsSync(rootCreds) && fs.existsSync(targetCreds)) {
        // Se já migrado antes, remove micro-arquivos órfãos duplicados na raiz de data/wa_auth/
        for (const entry of fs.readdirSync(AUTH_DIR, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.json')) {
            try {
              fs.unlinkSync(path.join(AUTH_DIR, entry.name));
            } catch {
              // Ignora erro
            }
          }
        }
      }
    }
    if (this.whatsappManager?.setAuthDir) {
      this.whatsappManager.setAuthDir(userAuthDir);
    }
    return userAuthDir;
  }

  async tryRestoreSavedLogin() {
    if (IS_VERCEL || !isCloudConfigured()) return false;
    this.client = this.createPersistentWorkerClient();
    const { data, error } = await this.client.auth.getSession();
    if (error || !data?.session?.user) {
      return false;
    }
    return this.activateWorkerSession(data.session.user);
  }

  async loginWorkerWithCredentials(usernameInput, password) {
    const email = usernameToAuthEmail(usernameInput);
    if (!email || !password) throw new Error('Informe usuário e senha.');
    if (!this.client) {
      this.client = this.createPersistentWorkerClient();
    }
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password: String(password)
    });
    if (error || !data?.user) {
      throw new Error('Usuário ou senha inválidos.');
    }
    const ok = await this.activateWorkerSession(data.user);
    if (!ok) {
      throw new Error('Não foi possível validar o perfil da conta ou ela está bloqueada.');
    }
    return this.getStatus();
  }

  async promptTerminalLoginIfInteractive() {
    if (IS_VERCEL || this.user?.id) return;

    // Suporte opcional a login automático via variáveis de ambiente (ZAPIA_USER / ZAPIA_PASS)
    if (process.env.ZAPIA_USER && process.env.ZAPIA_PASS) {
      try {
        await this.loginWorkerWithCredentials(process.env.ZAPIA_USER, process.env.ZAPIA_PASS);
        console.log(`✅ [Auto-Login] Conectado à nuvem como @${this.user.username}!`);
        return;
      } catch (err) {
        console.error(`⚠️  [Auto-Login] Falhou (${err.message}).`);
      }
    }

    if (!process.stdin.isTTY || process.env.ZAPIA_NO_TTY_PROMPT === '1') {
      console.log('☁️  [Nuvem Ienvia] Motor aguardando login da conta em http://localhost:3000 (ou via API).');
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    try {
      console.log('\n========================================================');
      console.log('🔐 1º PASSO — VINCULAR SUA CONTA IENVIA');
      console.log('   Digite o @usuario e senha entregues pelo administrador');
      console.log('   (ou aperte ENTER em branco para entrar pelo navegador)');
      console.log('========================================================');

      let loggedIn = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const u = (await ask('👉 Usuário: ')).trim();
        if (!u) {
          rl.close();
          console.log('🌐 Abra http://localhost:3000 no navegador para entrar na sua conta.\n');
          return;
        }
        const p = (await ask('🔑 Senha: ')).trim();
        try {
          await this.loginWorkerWithCredentials(u, p);
          loggedIn = true;
          break;
        } catch (loginErr) {
          console.error(`❌ Tentativa ${attempt}/3: ${loginErr.message}`);
        }
      }

      if (!loggedIn) {
        rl.close();
        console.log('🌐 Você também pode fazer login pelo navegador em http://localhost:3000.\n');
        return;
      }

      console.log(`\n✅ Conta @${this.user.username} (${this.user.displayName}) vinculada com sucesso!`);
      console.log('   Esta sessão já ficou salva neste aparelho para as próximas aberturas.\n');

      // Se o WhatsApp desta conta ainda não estiver pareado, oferece gerar Código de 8 Dígitos ali mesmo no Termux!
      if (this.whatsappManager && this.whatsappManager.status !== 'connected') {
        const phoneAns = (
          await ask(
            '📱 2º PASSO (Opcional) — Quer gerar o Código de 8 Dígitos para conectar seu WhatsApp agora mesmo?\n   Digite seu DDD + Número (ex: 86999887766) ou aperte ENTER para conectar pelo painel web: '
          )
        ).trim();
        rl.close();
        const digits = phoneAns.replace(/\D/g, '');
        if (digits.length >= 10) {
          console.log('⏳ Gerando Código de Pareamento de 8 dígitos junto ao WhatsApp...');
          const st = await this.whatsappManager.connect(digits);
          await this.pushRuntimeHeartbeat();
          if (st?.pairingCode) {
            console.log('\n========================================================');
            console.log(`🔢 SEU CÓDIGO DE CONEXÃO WHATSAPP:  ${st.pairingCode}`);
            console.log('   Abra seu WhatsApp > Aparelhos Conectados > Conectar Aparelho');
            console.log('   > "Conectar com número de telefone" e digite o código acima!');
            console.log('========================================================\n');
          }
        } else {
          console.log('🌐 Gerencie tudo ao vivo em: https://zap-ia-studio.vercel.app (ou http://localhost:3000)\n');
        }
      } else {
        rl.close();
      }
    } catch (err) {
      try { rl.close(); } catch {}
      console.error(`⚠️  Aviso no assistente de terminal: ${err.message}. Você pode operar normalmente em http://localhost:3000.\n`);
    }
  }

  async activateWorkerSession(authUser) {
    await calibrateTrueClock();
    const { data: profile, error: profileError } = await this.client
      .from('zapia_users')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    // Falha de rede ou perfil ausente nunca deve virar uma sessão autorizada.
    // Não apagar a sessão em erro de consulta: ela pode ser válida após reconexão.
    if (profileError || !profile || profile.user_id !== authUser.id) return false;
    if (profile.is_active !== true) {
      await this.logoutWorker();
      return false;
    }

    const maxWaSlots = clampMaxWaSlots(profile.max_wa_slots, profile.role);
    this.user = {
      id: authUser.id,
      username: profile?.username || normalizeUsername(authUser.email || ''),
      displayName: profile?.display_name || profile?.username || 'Usuário',
      role: profile?.role || 'user',
      maxWaSlots,
      isActive: true
    };

    localStorageInstance.userId = this.user.id;
    localStorageInstance.username = this.user.username;
    localStorageInstance.userRole = this.user.role;
    localStorageInstance.maxWaSlots = maxWaSlots;

    // 1. Configura pastas isoladas de autenticação Baileys para os até 3 Chips desta conta
    this.ensurePerUserWhatsAppAuthDir(this.user.id, this.user.role);

    // 2. Puxa os dados atuais dessa conta na nuvem (para que o celular/PC rode exatamente o cérebro desta conta!)
    await this.pullCloudIntoLocal(true);

    // 3. Inicia Heartbeat Multi-Dispositivo, Realtime de Comandos e Auto-Restore de todos os Chips salvos neste aparelho
    this.startBackgroundLoops();
    if (this.whatsappManager?.autoRestoreIfSessionExists) {
      await this.whatsappManager.autoRestoreIfSessionExists(maxWaSlots);
    }
    await this.pushRuntimeHeartbeat();

    if (this.broadcastFn) {
      this.broadcastFn('cloud_auth', this.getStatus());
    }
    return true;
  }

  async logoutWorker() {
    this.stopBackgroundLoops();
    if (this.whatsappManager && this.whatsappManager.status !== 'disconnected') {
      try {
        await this.whatsappManager.disconnectOnly?.();
      } catch {}
    }
    if (this.client && this.user?.id) {
      try {
        await this.markDeviceAndOwnedSlotsOffline();
        await this.client.auth.signOut();
      } catch {}
    }
    this.sessionStore.clearAll();
    this.user = null;
    if (this.broadcastFn) {
      this.broadcastFn('cloud_auth', this.getStatus());
    }
  }

  async markDeviceAndOwnedSlotsOffline() {
    if (!this.client || !this.user?.id) return;
    const nowIso = trueNowIso();
    const myDevId = this.deviceIdentity.deviceId;
    await Promise.all([
      this.client
        .from('zapia_worker_devices')
        .update({ online: false, updated_at: nowIso })
        .eq('user_id', this.user.id)
        .eq('device_id', myDevId),
      this.client
        .from('zapia_wa_slots')
        .update({ worker_online: false, updated_at: nowIso })
        .eq('user_id', this.user.id)
        .eq('device_id', myDevId)
    ]);

    // Só marca zapia_wa_runtime legado como offline se NENHUM outro aparelho da conta continuar online!
    const { data: otherDevs } = await this.client
      .from('zapia_worker_devices')
      .select('device_id, online, heartbeat_at')
      .eq('user_id', this.user.id);
    const stillOnline = (otherDevs || []).some(
      (d) => d.device_id !== myDevId && Boolean(d.online) && isWorkerHeartbeatFresh(d.heartbeat_at)
    );
    if (!stillOnline) {
      await this.client
        .from('zapia_wa_runtime')
        .update({ worker_online: false, updated_at: nowIso })
        .eq('user_id', this.user.id);
    }
  }

  async markWorkerOfflineNow() {
    this.stopBackgroundLoops();
    if (!this.client || !this.user?.id) return;
    try {
      await this.flushLocalToCloud().catch(() => {});
      await this.markDeviceAndOwnedSlotsOffline();
    } catch {}
  }

  async pullCloudIntoLocal(initial = false) {
    if (this.pullInFlight) {
      this.pullPending = true;
      return this.pullInFlight;
    }
    this.pullInFlight = (async () => {
      do {
        this.pullPending = false;
        await this.performCloudPull(initial);
        initial = false;
      } while (this.pullPending);
    })();
    try { return await this.pullInFlight; }
    finally { this.pullInFlight = null; }
  }

  async performCloudPull(initial = false) {
    if (!this.client || !this.user?.id) return;
    const uid = this.user.id;

    const since = initial || !this.lastSyncedContactsIso ? '' : this.lastSyncedContactsIso;
    const contactsQuery = fetchAllCloudContacts(this.client, uid, { since }).then(data => ({ data }));

    const [wsRes, contactsRes] = await Promise.all([
      this.client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
      contactsQuery
    ]);

    if (wsRes.error) throw new Error(`Falha ao carregar configurações: ${wsRes.error.message}`);
    const ownerFile = path.join(DATA_DIR, 'worker_db_owner.json');
    let sameLocalOwner = false;
    try { sameLocalOwner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')).userId === uid; } catch {}
    // Preserva uma cópia local antes de substituir o cache. Nunca exporta nem envia esta cópia.
    if (initial && Object.keys(localStorageInstance.data.contacts || {}).length) {
      const backupDir = path.join(DATA_DIR, 'recovery-before-cloud-sync');
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const backupPath = path.join(backupDir, `backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(localStorageInstance.data), { mode: 0o600, flag: 'wx' });
    }
    let contactsChanged = false;
    const healedIds = [];
    if (initial || (Array.isArray(contactsRes?.data) && contactsRes.data.length > 0)) {
      // Um banco legado sem identificação de dono não pode misturar dados entre contas.
      const prevLocalContacts = !initial || sameLocalOwner ? { ...(localStorageInstance.data.contacts || {}) } : {};
      const prevMutate = localStorageInstance.onMutate;
      localStorageInstance.onMutate = null;
      try {
        if (initial) {
          localStorageInstance.data.contacts = {};
        }
        let maxIso = this.lastSyncedContactsIso;
        let earliestSkippedIso = '';
        for (const row of contactsRes.data || []) {
          if (row?.updated_at && (!maxIso || row.updated_at > maxIso)) {
            maxIso = row.updated_at;
          }
          if (!row?.chat_id || !row?.data) continue;
          // Não sobrescreve contato que possui mutação local pendente de upload
          if (!initial && localStorageInstance.dirtyContactIds.has(row.chat_id)) {
            if (row.updated_at && (!earliestSkippedIso || row.updated_at < earliestSkippedIso)) earliestSkippedIso = row.updated_at;
            continue;
          }

          const prevLocal = prevLocalContacts[row.chat_id];
          const cloudContact = { ...row.data };
          const effectiveClearedAt =
            (cloudContact.historyClearedAt || '') >= (prevLocal?.historyClearedAt || '')
              ? (cloudContact.historyClearedAt || prevLocal?.historyClearedAt || null)
              : (prevLocal?.historyClearedAt || null);
          if (effectiveClearedAt) cloudContact.historyClearedAt = effectiveClearedAt;
          if (effectiveClearedAt || prevLocal?.messages?.length) {
            const beforeCount = Array.isArray(cloudContact.messages) ? cloudContact.messages.length : 0;
            cloudContact.messages = mergeContactMessagesUnion(cloudContact.messages, prevLocal?.messages || [], effectiveClearedAt);
            // Também sincroniza para a nuvem quando a barreira local é mais
            // recente ou removeu mensagens, inclusive com cache local vazio.
            if (cloudContact.messages.length !== beforeCount || (effectiveClearedAt || null) !== (row.data?.historyClearedAt || null)) {
              healedIds.push(row.chat_id);
              const lastReal = [...cloudContact.messages].reverse().find((m) => m.role !== 'internal_note');
              if (lastReal?.timestamp && (!cloudContact.lastMessageAt || lastReal.timestamp > cloudContact.lastMessageAt)) {
                cloudContact.lastMessageAt = lastReal.timestamp;
              }
            }
          }
          localStorageInstance.data.contacts[row.chat_id] = cloudContact;
          contactsChanged = true;
        }
        if (maxIso) {
          // Uma linha ignorada por edição local precisa ser lida novamente após o flush.
          const skippedMs = Date.parse(earliestSkippedIso);
          this.lastSyncedContactsIso = earliestSkippedIso && Number.isFinite(skippedMs)
            ? new Date(skippedMs - 1).toISOString()
            : maxIso;
        }
        if (!initial && contactsChanged) {
          localStorageInstance.initialContactKeys = new Set(Object.keys(localStorageInstance.data.contacts || {}));
          localStorageInstance.writeNow();
          localStorageInstance.workspaceDirty = false;
          if (this.broadcastFn) {
            this.broadcastFn('crm_updated', {});
          }
        }
      } finally {
        localStorageInstance.onMutate = prevMutate;
      }
      if (healedIds.length > 0) {
        for (const cid of healedIds) localStorageInstance.dirtyContactIds.add(cid);
        this.scheduleLocalToCloudSync();
      }
    } else if (initial && !this.lastSyncedContactsIso) {
      this.lastSyncedContactsIso = trueNowIso();
    }

    const ws = wsRes.data;
    if (ws) {
      if (initial || (ws.updated_at && ws.updated_at > this.lastSyncedWorkspaceIso)) {
        this.lastSyncedWorkspaceIso = ws.updated_at || trueNowIso();
        const contactsMap = localStorageInstance.data.contacts || {};
        const prevMutate = localStorageInstance.onMutate;
        localStorageInstance.onMutate = null;
        try {
          localStorageInstance.data = localStorageInstance.hydrateFromSnapshot(
            {
              business: ws.business,
              settings: ws.settings,
              stats: ws.stats,
              logs: ws.logs,
              simulatorHistory: ws.simulator_history,
              proactiveQueue: ws.proactive_queue,
              customPacks: ws.custom_pack || {},
              contacts: contactsMap
            },
            this.user.role !== 'master'
          );
          // Remove imediatamente do cache local do motor qualquer conversa apagada pelo painel na Vercel (tombstone)
          for (const [cid, cObj] of Object.entries(localStorageInstance.data.contacts || {})) {
            if (localStorageInstance.dirtyContactIds.has(cid)) continue;
            const tombMs = localStorageInstance.getDeletedChatTombstoneMs(cid, cObj?.phone || '');
            const lastMs = new Date(cObj?.lastMessageAt || 0).getTime() || 0;
            if (tombMs > 0 && lastMs <= tombMs + 2000) {
              delete localStorageInstance.data.contacts[cid];
              if (this.broadcastFn) this.broadcastFn('crm_updated', {});
            }
          }
          localStorageInstance.workspaceDirty = false;
          if (initial) {
            localStorageInstance.dirtyContactIds.clear();
            localStorageInstance.deletedContactIds.clear();
            localStorageInstance.initialContactKeys = new Set(Object.keys(localStorageInstance.data.contacts || {}));
          }
          localStorageInstance.writeNow();
          localStorageInstance.workspaceDirty = false;
          this.lastSyncedConfigHash = computeWorkspaceConfigHash(localStorageInstance.data);
        } finally {
          localStorageInstance.onMutate = prevMutate;
        }

        if (initial) {
          fs.writeFileSync(ownerFile, JSON.stringify({ userId: uid }), { mode: 0o600 });
        }

        // Faz cache em segundo plano dos áudios estratégicos da nuvem para envio rápido no Baileys
        for (const v of localStorageInstance.getVoiceLibrary()) {
          if (v?.filename && v?.url && /^https?:\/\//i.test(v.url)) {
            ensureLocalMediaCached(v.filename, v.url).catch(() => {});
          }
        }
      }
    }
  }

  scheduleLocalToCloudSync() {
    if (!this.client || !this.user?.id) return;
    // Não reinicie o prazo a cada alteração: importações contínuas não podem
    // deixar mensagens ao vivo esperando indefinidamente para subir à nuvem.
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.flushLocalToCloud().catch((err) => {
        console.error('[CloudWorker] Erro ao sincronizar dados com Supabase:', err.message);
        if (!this.syncTimer && this.client && this.user?.id) {
          this.syncTimer = setTimeout(() => { this.syncTimer = null; this.scheduleLocalToCloudSync(); }, 5000);
        }
      });
    }, 450);
  }

  async flushLocalToCloud() {
    if (!this.client || !this.user?.id) return;
    if (this.syncInFlight) {
      this.pendingFlush = true;
      if (this.currentFlushPromise) {
        await this.currentFlushPromise.catch(() => {});
      }
      return;
    }

    this.syncInFlight = true;
    this.currentFlushPromise = (async () => {
      try {
        do {
          this.pendingFlush = false;
          let rewroteLocalMediaUrl = false;

          // Sobe eventuais áudios/imagens locais recém-salvos ainda sem URL https:// da nuvem
          for (const v of localStorageInstance.getVoiceLibrary()) {
            if (v?.filename && (!v.url || v.url.startsWith('/uploads/'))) {
              const fp = path.join(UPLOADS_DIR, v.filename);
              if (fs.existsSync(fp)) {
                const pubUrl = await uploadMediaBufferToCloud(
                  this.client,
                  this.user.id,
                  v.filename,
                  fs.readFileSync(fp),
                  'audio/ogg'
                );
                if (pubUrl) {
                  v.url = pubUrl;
                  rewroteLocalMediaUrl = true;
                }
              }
            }
          }

          // Sobe mídias e arquivos recebidos dos clientes (áudio, foto, vídeo, PDF, planilha, doc, zip...) p/ ouvir/ver/baixar na Vercel!
          for (const cid of localStorageInstance.dirtyContactIds) {
            const contact = localStorageInstance.data.contacts[cid];
            if (!contact?.messages?.length) continue;
            const recent = contact.messages.slice(-15);
            for (const m of recent) {
              if (m?.mediaUrl && m.mediaUrl.startsWith('/uploads/')) {
                const fn = path.basename(m.mediaUrl);
                const fp = path.join(UPLOADS_DIR, fn);
                if (fs.existsSync(fp)) {
                  const ext = path.extname(fn).toLowerCase();
                  const mime =
                    m.mediaMime ||
                    (ext === '.ogg' || ext === '.opus' ? 'audio/ogg' :
                    ext === '.mp3' ? 'audio/mpeg' :
                    ext === '.m4a' ? 'audio/mp4' :
                    ext === '.wav' ? 'audio/wav' :
                    ext === '.webm' ? 'audio/webm' :
                    ext === '.mp4' ? 'video/mp4' :
                    ext === '.png' ? 'image/png' :
                    ext === '.webp' ? 'image/webp' :
                    ext === '.gif' ? 'image/gif' :
                    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                    ext === '.pdf' ? 'application/pdf' :
                    ext === '.csv' ? 'text/csv' :
                    ext === '.txt' ? 'text/plain' :
                    ext === '.json' ? 'application/json' :
                    ext === '.xml' ? 'application/xml' :
                    ext === '.zip' ? 'application/zip' :
                    ext === '.doc' ? 'application/msword' :
                    ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                    ext === '.xls' ? 'application/vnd.ms-excel' :
                    ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                    'application/octet-stream');
                  const pubUrl = await uploadMediaBufferToCloud(this.client, this.user.id, fn, fs.readFileSync(fp), mime);
                  if (pubUrl) {
                    m.mediaUrl = pubUrl;
                    rewroteLocalMediaUrl = true;
                  }
                }
              }
            }
          }

          if (rewroteLocalMediaUrl) {
            const prevMutate = localStorageInstance.onMutate;
            localStorageInstance.onMutate = null;
            try {
              localStorageInstance.writeNow();
            } finally {
              localStorageInstance.onMutate = prevMutate;
            }
          }

          await flushTenantStoreToCloud(this.client, this.user.id, localStorageInstance, {
            isWorkerSync: true,
            lastConfigHash: this.lastSyncedConfigHash,
            onConfigFlushed: (nextHash) => {
              this.lastSyncedConfigHash = nextHash;
            }
          });
        } while (this.pendingFlush);
      } finally {
        this.syncInFlight = false;
        this.currentFlushPromise = null;
      }
    })();

    await this.currentFlushPromise;
  }

  async pushRuntimeHeartbeat() {
    if (!this.client || !this.user?.id || !this.whatsappManager) return;
    try {
      this.deviceIdentity = getOrCreateDeviceIdentity();
      const myDevId = this.deviceIdentity.deviceId;
      const platformLabel = detectWorkerPlatformLabel();
      const nowIso = trueNowIso();
      const st = this.whatsappManager.getPublicState();
      const localActiveSlots = this.whatsappManager.getActiveLocalSlotIds
        ? this.whatsappManager.getActiveLocalSlotIds()
        : (st.status !== 'disconnected' ? ['slot_1'] : []);

      // 1. Registra/atualiza este aparelho em zapia_worker_devices e lê estado atual dos slots da conta
      const [, slotsRes] = await Promise.all([
        this.client.from('zapia_worker_devices').upsert(
          {
            user_id: this.user.id,
            device_id: myDevId,
            device_label: this.deviceIdentity.deviceName,
            platform: platformLabel,
            version: APP_VERSION,
            active_slots: localActiveSlots,
            online: true,
            heartbeat_at: nowIso,
            updated_at: nowIso
          },
          { onConflict: 'user_id,device_id' }
        ),
        this.client.from('zapia_wa_slots').select('*').eq('user_id', this.user.id)
      ]);

      const remoteSlotsMap = new Map((slotsRes.data || []).map((r) => [normalizeSlotId(r.slot_id), r]));
      const peerPhones = [];
      this.peerSlotOwners.clear();

      for (const [sid, row] of remoteSlotsMap.entries()) {
        const peerOnline = Boolean(row.worker_online) && isWorkerHeartbeatFresh(row.worker_heartbeat_at);
        if (row.device_id && row.device_id !== myDevId) {
          this.peerSlotOwners.set(sid, {
            deviceId: row.device_id,
            online: peerOnline,
            status: row.status || 'disconnected',
            phone: row.connected_user?.phone || ''
          });
          if (peerOnline && row.status === 'connected' && row.connected_user?.phone) {
            peerPhones.push(row.connected_user.phone);
          }
        }
      }
      if (this.whatsappManager.setCloudPeerSlotPhones) {
        this.whatsappManager.setCloudPeerSlotPhones(peerPhones);
      }

      // 2. Atualiza apenas os slots pertencentes a este aparelho (ou livres sem outro aparelho ativo), evitando Furo #2!
      const slotUpserts = [];
      for (const sid of WA_SLOT_IDS) {
        const localSlot = st.slots?.[sid];
        if (!localSlot) continue;
        const remoteRow = remoteSlotsMap.get(sid);
        const ownedByOtherOnlineDevice =
          remoteRow?.device_id &&
          remoteRow.device_id !== myDevId &&
          Boolean(remoteRow.worker_online) &&
          isWorkerHeartbeatFresh(remoteRow.worker_heartbeat_at) &&
          remoteRow.status !== 'disconnected';

        const locallyActive =
          localSlot.status !== 'disconnected' ||
          Boolean(localSlot.lastError) ||
          this.whatsappManager.hasSavedSession?.(sid) ||
          remoteRow?.device_id === myDevId;

        if (locallyActive && !ownedByOtherOnlineDevice) {
          slotUpserts.push({
            user_id: this.user.id,
            slot_id: sid,
            device_id: localSlot.status === 'disconnected' && !this.whatsappManager.hasSavedSession?.(sid) ? '' : myDevId,
            device_label: this.deviceIdentity.deviceName,
            label: localSlot.label || `Chip ${sid.slice(-1)}`,
            ai_enabled: localSlot.aiEnabled !== false,
            status: localSlot.status || 'disconnected',
            qr_data_url: localSlot.qrDataUrl || '',
            pairing_code: localSlot.pairingCode || '',
            connected_user: localSlot.connectedUser || null,
            last_error: localSlot.lastError || '',
            worker_online: true,
            worker_heartbeat_at: nowIso,
            updated_at: nowIso
          });
        } else if (!remoteRow && sid === 'slot_1') {
          slotUpserts.push({
            user_id: this.user.id,
            slot_id: 'slot_1',
            device_id: myDevId,
            device_label: this.deviceIdentity.deviceName,
            label: localSlot.label || 'Chip 1',
            ai_enabled: localSlot.aiEnabled !== false,
            status: localSlot.status || 'disconnected',
            qr_data_url: localSlot.qrDataUrl || '',
            pairing_code: localSlot.pairingCode || '',
            connected_user: localSlot.connectedUser || null,
            last_error: localSlot.lastError || '',
            worker_online: true,
            worker_heartbeat_at: nowIso,
            updated_at: nowIso
          });
        }
      }

      if (slotUpserts.length > 0) {
        await this.client.from('zapia_wa_slots').upsert(slotUpserts, { onConflict: 'user_id,slot_id' });
      }

      // 3. Espelha zapia_wa_runtime legado APENAS se o slot_1 não estiver ativo em outro aparelho (evita Furo #2!)
      const otherOwnsSlot1 =
        this.peerSlotOwners.get('slot_1')?.online &&
        this.peerSlotOwners.get('slot_1')?.status !== 'disconnected';

      if (!otherOwnsSlot1) {
        await this.client.from('zapia_wa_runtime').upsert(
          {
            user_id: this.user.id,
            status: st.status || 'disconnected',
            qr_data_url: st.qrDataUrl || '',
            pairing_code: st.pairingCode || '',
            connected_user: st.connectedUser || null,
            last_error: st.lastError || '',
            proactive_state: st.proactive || { queueLength: 0, paused: false, processing: false },
            worker_online: true,
            worker_heartbeat_at: nowIso,
            worker_platform: platformLabel,
            updated_at: nowIso
          },
          { onConflict: 'user_id' }
        );
      }
    } catch (err) {
      console.error('[CloudWorker] Erro no heartbeat:', err.message);
    }
  }

  startBackgroundLoops() {
    this.stopBackgroundLoops();
    if (!this.client || !this.user?.id) return;

    // 1. Canal Realtime para resposta instantânea (<200ms) aos comandos vindos da Vercel e edições de treinamento
    this.realtimeChannel = this.client
      .channel(`zapia-worker-${this.user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'zapia_commands',
          filter: `user_id=eq.${this.user.id}`
        },
        (payload) => {
          if (payload?.new?.status === 'pending') {
            this.executeCommandRow(payload.new).catch(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'zapia_workspaces',
          filter: `user_id=eq.${this.user.id}`
        },
        () => {
          this.pullCloudIntoLocal(false).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'zapia_contacts',
          filter: `user_id=eq.${this.user.id}`
        },
        (payload) => {
          if (payload?.eventType === 'DELETE' && payload?.old?.chat_id) {
            const delCid = payload.old.chat_id;
            const prevMutate = localStorageInstance.onMutate;
            localStorageInstance.onMutate = null;
            try {
              delete localStorageInstance.data.contacts[delCid];
              localStorageInstance.initialContactKeys = new Set(Object.keys(localStorageInstance.data.contacts || {}));
              localStorageInstance.writeNow();
              localStorageInstance.workspaceDirty = false;
            } finally {
              localStorageInstance.onMutate = prevMutate;
            }
            if (this.broadcastFn) this.broadcastFn('crm_updated', {});
            return;
          }
          this.pullCloudIntoLocal(false).catch(() => {});
        }
      )
      .subscribe();

    // 2. Polling resiliente de segurança a cada 2.5s (caso o 4G do celular oscile o WebSocket Realtime)
    this.commandPollTimer = setInterval(() => {
      this.pollPendingCommands().catch(() => {});
    }, 2500);

    // 3. Heartbeat a cada 12s + verificação de sincronia de workspace + limpeza leve de comandos antigos (>48h)
    this.pruneOldCommands().catch(() => {});
    let hbTicks = 0;
    this.heartbeatTimer = setInterval(() => {
      this.pushRuntimeHeartbeat().catch(() => {});
      this.pullCloudIntoLocal(false).catch(() => {});
      if (++hbTicks % 1800 === 0) {
        this.pruneOldCommands().catch(() => {});
      }
    }, 12_000);

    // A campanha só é iniciada pelo usuário; esta chave permite desativar o motor em emergência.
    if (process.env.IENVIA_CAMPANHAS_EXPERIMENTAL !== '0' && this.whatsappManager?.slots) {
      try {
        const client = this.client, owner = this.user.id;
        const carregarArquivo = criarLeitorMediaCampanha({client,userId:owner,panelUrl:'https://zap-ia-studio.vercel.app',supabaseUrl:SUPABASE_URL});
        let motor;
        const sessaoAtiva = () => this.campaignMotor === motor && this.client === client && this.user?.id === owner;
        motor = conectarMotorCampanhas({
          client,userId:owner,workerId:crypto.randomUUID(),deviceId:this.deviceIdentity.deviceId,
          whatsapp:this.whatsappManager,storage:localStorageInstance,sessaoAtiva,carregarArquivo,
          maxWaSlots:()=>clampMaxWaSlots(this.user?.maxWaSlots,this.user?.role),
          converterVoz:convertToCanonicalWhatsAppVoice,
          registrar:({acao,enviado,jid})=>{
            if(!sessaoAtiva())return;
            const slot=this.whatsappManager.slots[acao.slotId];
            const chatId=slot.toStorageKey(jid),key={id:enviado.key.id,remoteJid:jid,fromMe:true};
            const text=acao.material.tipo==='texto'?acao.material.texto:acao.material.tipo==='imagem'?'[Imagem enviada pela campanha]':'[Áudio enviado pela campanha]';
            localStorageInstance.appendContactMessage(chatId,{role:'assistant',text,phone:acao.telefone,contactName:acao.nome,campaignId:acao.campanhaId,waMsgId:enviado.key.id,waMsgKey:key,ack:1,timestamp:trueNowIso()});
            this.broadcastFn?.('crm_updated',{chatId});
          },aoErro:()=>console.error('[Campanhas] Falha de processamento. Verifique o estado antes de qualquer reenvio.')
        });
        this.campaignMotor=motor;motor.iniciar();
      } catch(err) { console.error('[Campanhas] Motor experimental não iniciado:',err.message); }
    }
  }

  async pruneOldCommands() {
    if (!this.client || !this.user?.id) return;
    try {
      const cutoffIso = new Date(trueNowMs() - 48 * 3600_000).toISOString();
      await this.client
        .from('zapia_commands')
        .delete()
        .eq('user_id', this.user.id)
        .in('status', ['done', 'error'])
        .lt('created_at', cutoffIso);
    } catch {}
  }

  shouldThisDeviceExecuteCommand(row) {
    const myDevId = this.deviceIdentity.deviceId;
    if (row.target_device_id && row.target_device_id !== myDevId) {
      return false;
    }
    if (!row.target_device_id && row.slot_id) {
      const sid = normalizeSlotId(row.slot_id);
      const localSlot = this.whatsappManager?.getSlot?.(sid);
      const localHasSlot =
        localSlot &&
        (localSlot.status === 'connected' ||
          localSlot.status === 'connecting' ||
          localSlot.status === 'qr_ready' ||
          localSlot.hasSavedSession());
      if (!localHasSlot) {
        const peer = this.peerSlotOwners.get(sid);
        if (peer?.online && peer.status !== 'disconnected') {
          return false;
        }
      }
    }
    // Se for comando genérico (ex: send_proactive em auto_rotate) sem slot fixo e este aparelho não tiver nenhum chip conectado,
    // mas outro aparelho tiver chip conectado, deixa o aparelho conectado reivindicar!
    if (
      !row.target_device_id &&
      !row.slot_id &&
      (row.action === 'send_proactive' || row.action === 'queue_start' || row.action === 'wa_test_owner_alert')
    ) {
      const localConnected = this.whatsappManager?.getConnectedSlots?.()?.length || 0;
      const anyPeerConnected = Array.from(this.peerSlotOwners.values()).some(
        (p) => p.online && p.status === 'connected'
      );
      if (localConnected === 0 && anyPeerConnected) {
        return false;
      }
    }
    return true;
  }

  stopBackgroundLoops() {
    const campaignMotor = this.campaignMotor;
    this.campaignMotor = null;
    campaignMotor?.parar();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.commandPollTimer) {
      clearInterval(this.commandPollTimer);
      this.commandPollTimer = null;
    }
    if (this.realtimeChannel && this.client) {
      try {
        this.client.removeChannel(this.realtimeChannel);
      } catch {}
      this.realtimeChannel = null;
    }
  }

  async pollPendingCommands() {
    if (!this.client || !this.user?.id) return;
    const { data: rows } = await this.client
      .from('zapia_commands')
      .select('*')
      .eq('user_id', this.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    for (const row of rows || []) {
      await this.executeCommandRow(row);
    }
  }

  async executeCommandRow(row) {
    if (!row?.id || this.processingCommands.has(row.id) || !this.whatsappManager) return;
    if (!this.shouldThisDeviceExecuteCommand(row)) return;
    this.processingCommands.add(row.id);

    try {
      // Reivindicação Atômica (Furo #1 — SELECT FOR UPDATE SKIP LOCKED no PostgreSQL):
      // Garante que apenas 1 aparelho execute o comando mesmo com 2+ dispositivos online!
      const { data: claimedRows, error: claimErr } = await this.client.rpc('claim_zapia_command', {
        p_command_id: row.id,
        p_device_id: this.deviceIdentity.deviceId
      });
      if (claimErr || !Array.isArray(claimedRows) || claimedRows.length === 0) {
        return;
      }

      const p = row.payload || {};
      const targetSlotId = normalizeSlotId(row.slot_id || p.slotId || 'slot_1');
      let result = { ok: true };

      switch (row.action) {
        case 'wa_connect': {
          // Validação dupla da cota máxima de Chips por cliente (Furo #12)
          const { data: uRow } = await this.client
            .from('zapia_users')
            .select('role, max_wa_slots')
            .eq('user_id', this.user.id)
            .maybeSingle();
          const maxSlots = clampMaxWaSlots(uRow?.max_wa_slots ?? this.user?.maxWaSlots, uRow?.role || this.user?.role);
          const slotNum = Number(targetSlotId.slice(-1)) || 1;
          if (slotNum > maxSlots) {
            throw new Error(`Plano limitado a ${maxSlots} Chip(s) WhatsApp.`);
          }
          const st = await this.whatsappManager.connect(p.pairingPhone || null, targetSlotId);
          await this.pushRuntimeHeartbeat();
          result = {
            ok: true,
            slotId: targetSlotId,
            slotState: st.slots?.[targetSlotId] || st,
            waState: st
          };
          break;
        }
        case 'wa_disconnect': {
          const st = await this.whatsappManager.disconnect(p.clearSession !== false, targetSlotId);
          if (p.clearSession !== false && this.client && this.user?.id) {
            await this.client
              .from('zapia_wa_slots')
              .upsert(
                {
                  user_id: this.user.id,
                  slot_id: targetSlotId,
                  device_id: '',
                  device_label: '',
                  status: 'disconnected',
                  qr_data_url: '',
                  pairing_code: '',
                  connected_user: null,
                  last_error: '',
                  worker_online: true,
                  worker_heartbeat_at: trueNowIso(),
                  updated_at: trueNowIso()
                },
                { onConflict: 'user_id,slot_id' }
              );
          }
          await this.pushRuntimeHeartbeat();
          result = {
            ok: true,
            slotId: targetSlotId,
            slotState: st.slots?.[targetSlotId] || st,
            waState: st
          };
          break;
        }
        case 'wa_backup_slot_auth': {
          const engine = this.whatsappManager.getSlot(targetSlotId);
          const expectedPhone = String(p.expectedPhone || '').replace(/\D/g, '');
          const actualPhone = String(engine?.connectedUser?.phone || '').replace(/\D/g, '');
          if (!this.user?.id || !['slot_2','slot_3'].includes(targetSlotId) || engine?.status !== 'connected' ||
              !expectedPhone || expectedPhone !== actualPhone) {
            throw new Error('Número ou chip conectado não corresponde ao solicitado; nada foi desconectado.');
          }
          const backup = backupSlotAuth({ authRoot: AUTH_DIR, recoveryRoot: path.join(DATA_DIR, 'recovery-before-pairing'),
            userId: this.user.id, slotId: targetSlotId, authDir: engine.authDir });
          result = { ok: true, slotId: targetSlotId, filesCopied: backup.copiedFiles };
          break;
        }
        case 'history_journal_enable': {
          if (!this.user?.id || IS_VERCEL) throw new Error('Diário local disponível apenas no motor vinculado à conta.');
          enableHistoryJournal(path.join(DATA_DIR, 'history-journal'), this.user.id);
          result = { ok: true, journalEnabled: true };
          break;
        }
        case 'history_runtime_diagnostics': {
          // Diagnóstico agregado, sem telefones, conteúdo de mensagens ou credenciais.
          const journalRoot = path.join(DATA_DIR, 'history-journal');
          const journalEnabled = Boolean(this.user?.id && !IS_VERCEL && isHistoryJournalEnabled(journalRoot, this.user.id));
          const slots = WA_SLOT_IDS.map((slotId) => {
            const engine = this.whatsappManager.getSlot?.(slotId);
            const cards = Object.entries(localStorageInstance.data.contacts || {})
              .filter(([key, card]) => normalizeSlotId(card?.slotId || parseContactChannelKey(key).slotId) === slotId)
              .map(([, card]) => card);
            const counts = cards.map(c => Array.isArray(c?.messages) ? c.messages.length : 0);
            return {
              slotId,
              status: engine?.status || 'disconnected',
              hasSavedSession: Boolean(engine?.hasSavedSession?.()),
              bootstrapMarker: Boolean(engine?.hasCompletedHistoryBootstrap?.()),
              lastHistoryProtocolStatus: engine?.lastHistoryProtocolStatus || null,
              journalFileCount: journalEnabled ? countJournalFiles(journalRoot, this.user.id, slotId) : 0,
              lastJournalError: engine?.lastHistoryJournalError || null,
              liveMessageDiagnostics: engine?.getLiveMessageDiagnostics?.() || null,
              processedHistoryChunks: Array.isArray(engine?.sock?.authState?.creds?.processedHistoryMessages)
                ? engine.sock.authState.creds.processedHistoryMessages.length : 0,
              contacts: cards.length,
              contactsWithMessages: counts.filter(Boolean).length,
              messagesInCache: counts.reduce((a, b) => a + b, 0),
              maxMessagesInCache: counts.reduce((a, b) => Math.max(a, b), 0)
            };
          });
          let sqliteAvailable = false;
          try { await import('node:sqlite'); sqliteAvailable = true; } catch {}
          result = { ok: true, nodeVersion: process.versions.node, sqliteAvailable, journalEnabled, slots };
          break;
        }
        case 'wa_sync_history': {
          const out = await this.whatsappManager.syncAllConversationsFromPhone({
            force: true,
            waitMs: Number(p.waitMs) || 6500,
            slotId: p.slotId ? normalizeSlotId(p.slotId) : null
          });
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
          break;
        }
        case 'relay_owner_alert': {
          const slot1 = this.whatsappManager.getSlot('slot_1');
          if (!slot1 || slot1.status !== 'connected' || !slot1.sock) {
            throw new Error('Chip 1 não está conectado neste aparelho para repassar o alerta.');
          }
          await slot1.sendDirectAlertText(p.ownerPhoneDigits, p.alertText);
          await this.flushLocalToCloud();
          result = { ok: true, sentViaSlot: 'slot_1' };
          break;
        }
        case 'rename_worker_device': {
          this.deviceIdentity = renameLocalDeviceIdentity(p.deviceName);
          await this.pushRuntimeHeartbeat();
          result = { ok: true, device: this.deviceIdentity };
          break;
        }
        case 'fetch_chat_history': {
          const out = await this.whatsappManager.fetchOlderMessagesForChat(
            p.chatId,
            Number(p.count) || 50
          );
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
          break;
        }
        case 'wa_test_owner_alert': {
          const out = await this.whatsappManager.sendTestAlertToOwner(p.phone, targetSlotId);
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
          break;
        }
        case 'send_crm_reply': {
          await this.pullCloudIntoLocal(false);
          const cleanJid = String(p.chatId || '').replace(/^demo_/, '');
          await this.whatsappManager.sendManualOwnerMessage(cleanJid, p.text, true, {
            quotedMsgId: p.quotedMsgId || '',
            slotId: p.slotId || undefined
          });
          localStorageInstance.markContactRead(cleanJid);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(cleanJid) || cleanJid;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'crm_react_message': {
          await this.pullCloudIntoLocal(false);
          const updated = await this.whatsappManager.reactToWhatsappMessage(p.chatId, p.msgId, p.emoji || '');
          await this.flushLocalToCloud();
          result = { ok: true, contact: updated };
          break;
        }
        case 'crm_edit_message': {
          await this.pullCloudIntoLocal(false);
          const updated = await this.whatsappManager.editWhatsappMessage(p.chatId, p.msgId, p.text || '');
          await this.flushLocalToCloud();
          result = { ok: true, contact: updated };
          break;
        }
        case 'crm_delete_message': {
          await this.pullCloudIntoLocal(false);
          const updated = await this.whatsappManager.deleteWhatsappMessageForEveryone(p.chatId, p.msgId);
          await this.flushLocalToCloud();
          result = { ok: true, contact: updated };
          break;
        }
        case 'crm_forward_message': {
          await this.pullCloudIntoLocal(false);
          const updatedDest = await this.whatsappManager.forwardCrmMessage(p.fromChatId, p.msgId, p.toChatId);
          await this.flushLocalToCloud();
          result = { ok: true, targetContact: updatedDest };
          break;
        }
        case 'send_crm_catalog': {
          await this.pullCloudIntoLocal(false);
          const biz = localStorageInstance.getBusiness();
          const item = (biz.catalog || []).find((i) => i.id === p.itemId);
          if (!item) throw new Error('Item do catálogo não encontrado.');
          for (const mf of item.mediaFiles || []) {
            if (mf?.filename && mf?.url) await ensureLocalMediaCached(mf.filename, mf.url);
          }
          if ((item.mediaFiles && item.mediaFiles.length > 0) || item.mediaFile?.filename) {
            await this.whatsappManager.sendCatalogMediaFile(p.chatId, item, 'owner');
          } else {
            const txt = `*${item.name}*${item.price ? ` — R$ ${item.price}` : ''}\n${item.description || ''}${item.paymentLink ? `\n${item.paymentLink}` : ''}`.trim();
            await this.whatsappManager.sendManualOwnerMessage(p.chatId, txt, true);
          }
          localStorageInstance.pauseContact(p.chatId, biz.lockUntilManualResume ? 'forever' : 60, 'Item enviado manualmente no CRM');
          localStorageInstance.markContactRead(p.chatId);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_crm_pix': {
          await this.pullCloudIntoLocal(false);
          const biz = localStorageInstance.getBusiness();
          await this.whatsappManager.sendPixPayloadToChat(p.chatId, biz, p.amount ?? null, 'owner', p.chatId);
          localStorageInstance.pauseContact(p.chatId, biz.lockUntilManualResume ? 'forever' : 60, 'PIX enviado manualmente no CRM');
          localStorageInstance.markContactRead(p.chatId);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_crm_library_voice': {
          await this.pullCloudIntoLocal(false);
          const biz = localStorageInstance.getBusiness();
          const vItem = (biz.voiceLibrary || []).find((v) => v.id === p.voiceId);
          if (vItem?.filename && vItem?.url) {
            await ensureLocalMediaCached(vItem.filename, vItem.url);
          }
          await this.whatsappManager.sendLibraryVoiceToChat(p.chatId, p.voiceId, {
            senderRole: 'owner',
            pauseAi: true
          });
          localStorageInstance.markContactRead(p.chatId);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_crm_recorded_voice': {
          await this.pullCloudIntoLocal(false);
          const localAudio = await ensureLocalMediaCached(p.filename, p.mediaUrl);
          if (!localAudio) throw new Error('Arquivo de áudio gravado não encontrado para envio.');
          const oggBuffer = fs.readFileSync(localAudio);
          const sentVoice = await this.whatsappManager.sendCanonicalVoiceNote({
            chatId: p.chatId,
            oggBuffer,
            durationSec: p.durationSec || 2,
            waveform: p.waveform || null
          });
          const biz = localStorageInstance.getBusiness();
          localStorageInstance.data.stats.totalMediaSent += 1;
          localStorageInstance.appendContactMessage(p.chatId, {
            role: 'owner',
            text: `🎤 [Nota de voz gravada/enviada (${p.durationSec || 1}s)]`,
            ...(sentVoice?.key?.id ? { waMsgId: sentVoice.key.id } : {}),
            mediaUrl: p.mediaUrl,
            durationSec: p.durationSec || 1,
            waveform: p.waveform
          });
          localStorageInstance.pauseContact(p.chatId, biz.lockUntilManualResume ? 'forever' : 60, 'Nota de voz enviada manualmente pelo painel');
          localStorageInstance.markContactRead(p.chatId);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_crm_attachment': {
          await this.pullCloudIntoLocal(false);
          const localFile = await ensureLocalMediaCached(p.filename, p.mediaUrl);
          if (!localFile) throw new Error('Arquivo anexo não encontrado para envio.');
          const fileBuffer = fs.readFileSync(localFile);
          await this.whatsappManager.sendManualAttachment({
            chatId: p.chatId,
            buffer: fileBuffer,
            mimeType: p.mimeType || 'image/jpeg',
            fileName: p.originalName || p.filename || 'anexo',
            caption: p.caption || '',
            mediaUrl: p.mediaUrl || `/uploads/${p.filename}`,
            pauseAi: true
          });
          localStorageInstance.markContactRead(p.chatId);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_proactive': {
          await this.pullCloudIntoLocal(false);
          const out = await this.whatsappManager.sendProactiveAiOpening(
            p.phone,
            p.text,
            p.name,
            p.voiceId || '',
            p.channelMode || 'auto_rotate'
          );
          await this.flushLocalToCloud();
          result = { ok: true, ...out, stats: localStorageInstance.data.stats };
          break;
        }
        case 'crm_block_contact': {
          await this.pullCloudIntoLocal(false);
          const contact = await this.whatsappManager.setWhatsAppBlockStatus(p.chatId, Boolean(p.blocked));
          await this.flushLocalToCloud();
          result = { ok: true, contact };
          break;
        }
        case 'crm_send_vcard': {
          await this.pullCloudIntoLocal(false);
          const contact = await this.whatsappManager.sendContactVCardOnWhatsApp(p.targetChatId, p.cardContact || {});
          await this.flushLocalToCloud();
          result = { ok: true, contact };
          break;
        }
        case 'update_motor_now': {
          const { spawnSync } = await import('node:child_process');
          const scriptPath = path.resolve(DATA_DIR, '..', 'scripts', 'auto_update_boot.mjs');
          if (fs.existsSync(scriptPath)) {
            spawnSync(process.execPath, ['--dns-result-order=ipv4first', scriptPath], {
              cwd: path.resolve(DATA_DIR, '..'),
              stdio: 'inherit'
            });
          }
          await this.flushLocalToCloud();
          result = { ok: true, restartingForUpdate: true };
          setTimeout(() => {
            console.log('🔄 [Auto-Update Remoto] Reiniciando motor na nova versão...');
            process.exit(42);
          }, 700);
          break;
        }
        case 'queue_start': {
          await this.pullCloudIntoLocal(false);
          const queue = this.whatsappManager.enqueueProactiveBatch(
            p.leads || [],
            p.text || '',
            p.channelMode || 'auto_rotate'
          );
          await this.pushRuntimeHeartbeat();
          await this.flushLocalToCloud();
          result = { ok: true, queue };
          break;
        }
        case 'queue_pause': {
          const queue = this.whatsappManager.pauseProactiveQueue(p.paused !== false);
          await this.pushRuntimeHeartbeat();
          await this.flushLocalToCloud();
          result = { ok: true, queue };
          break;
        }
        case 'queue_clear': {
          const queue = this.whatsappManager.clearProactiveQueue();
          await this.pushRuntimeHeartbeat();
          await this.flushLocalToCloud();
          result = { ok: true, queue };
          break;
        }
        default:
          throw new Error(`Ação desconhecida: ${row.action}`);
      }

      await this.client
        .from('zapia_commands')
        .update({
          status: 'done',
          result,
          processed_at: trueNowIso()
        })
        .eq('id', row.id);
    } catch (err) {
      await this.client
        .from('zapia_commands')
        .update({
          status: 'error',
          error_text: err.message || 'Erro ao processar comando no Motor WhatsApp',
          processed_at: trueNowIso()
        })
        .eq('id', row.id);
    } finally {
      this.processingCommands.delete(row.id);
    }
  }
}

export const cloudWorker = new CloudWorkerBridge();

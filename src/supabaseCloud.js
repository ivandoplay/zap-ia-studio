import fs from 'node:fs';
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
  createCleanDatabaseForNewTenant,
  localStorageInstance
} from './storage.js';

const CLOUD_SESSION_FILE = path.join(DATA_DIR, 'cloud_session.json');
const WORKER_HEARTBEAT_TTL_MS = 40_000;

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
  return Date.now() - ts <= WORKER_HEARTBEAT_TTL_MS;
}

export function mapCloudRuntimeToWaState(rt = null, botEnabled = true) {
  const online = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
  return {
    status: online ? (rt?.status || 'disconnected') : 'disconnected',
    rawStatus: rt?.status || 'disconnected',
    qrDataUrl: online ? (rt?.qr_data_url || null) : null,
    pairingCode: online ? (rt?.pairing_code || null) : null,
    connectedUser: online ? (rt?.connected_user || null) : null,
    lastKnownUser: rt?.connected_user || null,
    lastError: online ? (rt?.last_error || null) : null,
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
    workerPlatform: rt?.worker_platform || null
  };
}

/**
 * Login com Usuário + Senha (sem exibir e-mail técnico para o cliente).
 */
export async function signInWithUsernamePassword(usernameInput, password) {
  const email = usernameToAuthEmail(usernameInput);
  const cleanUser = normalizeUsername(usernameInput);
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
  let { data: profile } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!profile) {
    const meta = data.user.user_metadata || {};
    const newProfile = {
      user_id: data.user.id,
      username: meta.username || cleanUser || 'usuario',
      display_name: meta.display_name || cleanUser || 'Usuário',
      role: meta.role === 'master' ? 'master' : 'user',
      is_active: true,
      last_seen_at: new Date().toISOString()
    };
    const { data: inserted } = await authed
      .from('zapia_users')
      .upsert(newProfile, { onConflict: 'user_id' })
      .select('*')
      .maybeSingle();
    profile = inserted || newProfile;
  }

  if (profile.is_active === false) {
    throw new Error('Esta conta está temporariamente bloqueada pelo administrador.');
  }

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
      isActive: profile.is_active !== false
    }
  };
}

export async function refreshCloudSession(refreshToken) {
  if (!refreshToken) throw new Error('Sessão expirada. Faça login novamente.');
  const anon = createAnonClient();
  const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session || !data?.user) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  const authed = createAnonClient(data.session.access_token);
  const { data: profile } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) {
    throw new Error('Esta conta está bloqueada pelo administrador.');
  }

  return {
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    },
    user: {
      id: data.user.id,
      username: profile?.username || normalizeUsername(data.user.email || ''),
      displayName: profile?.display_name || profile?.username || 'Usuário',
      role: profile?.role || 'user',
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
  const { data: profile } = await authed
    .from('zapia_users')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) {
    const blockedErr = new Error('Conta bloqueada pelo administrador.');
    blockedErr.code = 'ACCOUNT_BLOCKED';
    throw blockedErr;
  }

  const effectiveProfile = profile || {
    user_id: data.user.id,
    username: data.user.user_metadata?.username || normalizeUsername(data.user.email || ''),
    display_name: data.user.user_metadata?.display_name || 'Usuário',
    role: data.user.user_metadata?.role === 'master' ? 'master' : 'user',
    is_active: true
  };

  return {
    client: authed,
    authUser: data.user,
    profile: effectiveProfile
  };
}

/**
 * Carrega o workspace isolado da conta logada a partir do Supabase (usado em cada request Serverless na Vercel).
 */
export async function loadTenantContextFromCloud(client, authUser, profile) {
  const uid = authUser.id;
  const isMaster = profile?.role === 'master';

  const [wsRes, contactsRes, rtRes] = await Promise.all([
    client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
    client.from('zapia_contacts').select('chat_id, data').eq('user_id', uid),
    client.from('zapia_wa_runtime').select('*').eq('user_id', uid).maybeSingle()
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

  tenantStore.cloudClient = client;
  tenantStore.waRuntime = mapCloudRuntimeToWaState(rtRes.data, tenantStore.data.settings?.botEnabled !== false);

  tenantStore.flushCloud = async () => {
    await flushTenantStoreToCloud(client, uid, tenantStore);
  };

  return tenantStore;
}

export async function flushTenantStoreToCloud(client, userId, tenantStore) {
  if (!client || !userId || !tenantStore) return;

  // Detecta contatos deletados diretamente via `delete storage.data.contacts[id]`
  const currentKeys = new Set(Object.keys(tenantStore.data.contacts || {}));
  for (const prevKey of tenantStore.initialContactKeys || []) {
    if (!currentKeys.has(prevKey)) {
      tenantStore.deletedContactIds.add(prevKey);
    }
  }

  const tasks = [];

  if (tenantStore.workspaceDirty) {
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
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      )
    );
    tenantStore.workspaceDirty = false;
  }

  if (tenantStore.deletedContactIds.size > 0) {
    const delIds = Array.from(tenantStore.deletedContactIds);
    tenantStore.deletedContactIds.clear();
    tasks.push(
      client
        .from('zapia_contacts')
        .delete()
        .eq('user_id', userId)
        .in('chat_id', delIds)
    );
  }

  if (tenantStore.dirtyContactIds.size > 0) {
    const rows = [];
    for (const cid of tenantStore.dirtyContactIds) {
      const c = tenantStore.data.contacts[cid];
      if (!c) continue;
      rows.push({
        user_id: userId,
        chat_id: cid,
        data: c,
        last_message_at: c.lastMessageAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    tenantStore.dirtyContactIds.clear();
    if (rows.length > 0) {
      tasks.push(
        client.from('zapia_contacts').upsert(rows, { onConflict: 'user_id,chat_id' })
      );
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
    tenantStore.initialContactKeys = new Set(Object.keys(tenantStore.data.contacts || {}));
  }
}

/**
 * Faz upload de áudio OGG/Opus, imagem de catálogo ou mídia recebida para o bucket isolado `<user_id>/<filename>`.
 */
export async function uploadMediaBufferToCloud(client, userId, filename, buffer, contentType = 'application/octet-stream') {
  if (!client || !userId || !filename || !buffer) return null;
  const safeName = path.basename(filename);
  const storagePath = `${userId}/${safeName}`;
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: true
  });
  if (error) {
    console.error('[CloudMedia] Falha ao enviar mídia para Supabase Storage:', error.message);
    return null;
  }
  const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

/**
 * No Motor Termux/PC: garante que um arquivo enviado pela Vercel exista localmente em `data/uploads/` antes do envio via Baileys.
 */
export async function ensureLocalMediaCached(filename, remoteUrl = '') {
  if (!filename && !remoteUrl) return null;
  const safeName = path.basename(filename || new URL(remoteUrl).pathname);
  const localPath = path.join(UPLOADS_DIR, safeName);
  if (fs.existsSync(localPath)) return localPath;

  const targetUrl =
    remoteUrl && /^https?:\/\//i.test(remoteUrl)
      ? remoteUrl
      : null;

  if (!targetUrl) return null;

  try {
    const resp = await fetch(targetUrl);
    if (!resp.ok) return null;
    const arr = await resp.arrayBuffer();
    fs.writeFileSync(localPath, Buffer.from(arr));
    return localPath;
  } catch (err) {
    console.error('[CloudMedia] Falha ao baixar mídia da nuvem para cache local:', err.message);
    return null;
  }
}

/**
 * Despacha um comando ao vivo da Vercel para o Motor WhatsApp (Termux / PC) daquela conta e aguarda conclusão.
 */
export async function dispatchCommandToWorker(client, userId, action, payload = {}, timeoutMs = 8800) {
  const { data: rt } = await client
    .from('zapia_wa_runtime')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const online = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
  if (!online) {
    const err = new Error(
      'Seu Motor WhatsApp (Termux no celular ou PC) está offline no momento. Inicie o motor na sua conta para conectar o WhatsApp ou disparar mensagens ao vivo.'
    );
    err.statusCode = 503;
    err.workerOffline = true;
    throw err;
  }

  const startedAtIso = new Date().toISOString();
  const { data: cmd, error: insErr } = await client
    .from('zapia_commands')
    .insert({
      user_id: userId,
      action,
      payload,
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

    // Para conexão de QR Code / Código de 8 dígitos, retorna assim que o código já tiver aparecido no runtime
    if (action === 'wa_connect') {
      const { data: freshRt } = await client
        .from('zapia_wa_runtime')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (freshRt && freshRt.updated_at > startedAtIso) {
        if (payload?.pairingPhone && freshRt.pairing_code) {
          return { ok: true, pairingCode: freshRt.pairing_code, waState: mapCloudRuntimeToWaState(freshRt) };
        }
        if (!payload?.pairingPhone && (freshRt.qr_data_url || freshRt.status === 'connected')) {
          return { ok: true, qrDataUrl: freshRt.qr_data_url, waState: mapCloudRuntimeToWaState(freshRt) };
        }
      }
    }
  }

  return {
    ok: true,
    queued: true,
    message: 'Comando enviado ao Motor WhatsApp e em processamento.'
  };
}

// ============================================================================
// GERENCIAMENTO DE CONTAS (EXCLUSIVO ADMIN MASTER — SERVER-SIDE SERVICE ROLE)
// ============================================================================

export async function listManagedUsers() {
  const admin = getAdminClient();
  const [usersRes, rtRes, contactsRes] = await Promise.all([
    admin.from('zapia_users').select('*').order('created_at', { ascending: true }),
    admin.from('zapia_wa_runtime').select('user_id, status, connected_user, worker_online, worker_heartbeat_at, worker_platform'),
    admin.from('zapia_contacts').select('user_id')
  ]);

  if (usersRes.error) throw new Error(usersRes.error.message);

  const rtMap = new Map((rtRes.data || []).map((r) => [r.user_id, r]));
  const contactCounts = new Map();
  for (const c of contactsRes.data || []) {
    contactCounts.set(c.user_id, (contactCounts.get(c.user_id) || 0) + 1);
  }

  return (usersRes.data || []).map((u) => {
    const rt = rtMap.get(u.user_id);
    const workerOnline = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
    return {
      userId: u.user_id,
      username: u.username,
      displayName: u.display_name || u.username,
      role: u.role || 'user',
      isActive: u.is_active !== false,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      contactsCount: contactCounts.get(u.user_id) || 0,
      workerOnline,
      workerPlatform: rt?.worker_platform || null,
      waStatus: workerOnline ? (rt?.status || 'disconnected') : 'offline',
      connectedPhone: rt?.connected_user?.id ? String(rt.connected_user.id).split(':')[0].split('@')[0] : null
    };
  });
}

export async function createManagedUser({ username, password, displayName }) {
  const admin = getAdminClient();
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error('O nome de usuário deve ter pelo menos 3 caracteres (letras/números).');
  }
  if (!password || String(password).length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }

  const email = usernameToAuthEmail(cleanUsername);
  const { data: existingRow } = await admin
    .from('zapia_users')
    .select('user_id')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (existingRow) {
    throw new Error(`Já existe uma conta com o usuário "${cleanUsername}".`);
  }

  const cleanDisplay = String(displayName || cleanUsername).trim();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: String(password),
    email_confirm: true,
    user_metadata: {
      username: cleanUsername,
      display_name: cleanDisplay,
      role: 'user'
    }
  });

  if (createErr || !created?.user) {
    throw new Error(createErr?.message || 'Não foi possível criar a conta no Supabase Auth.');
  }

  const uid = created.user.id;
  // Conta secundária nasce 100% LIMPA para qualquer nicho
  const cleanDb = createCleanDatabaseForNewTenant(cleanDisplay);

  await Promise.all([
    admin.from('zapia_users').upsert({
      user_id: uid,
      username: cleanUsername,
      display_name: cleanDisplay,
      role: 'user',
      is_active: true
    }, { onConflict: 'user_id' }),
    admin.from('zapia_workspaces').upsert({
      user_id: uid,
      business: cleanDb.business,
      settings: cleanDb.settings,
      stats: cleanDb.stats,
      logs: [],
      simulator_history: [],
      proactive_queue: [],
      custom_pack: {},
      updated_at: new Date().toISOString()
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
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
  ]);

  return {
    userId: uid,
    username: cleanUsername,
    displayName: cleanDisplay,
    role: 'user',
    isActive: true
  };
}

export async function updateManagedUser(targetUserId, { password, displayName, isActive } = {}) {
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
      display_name: String(displayName || target.username).trim(),
      role: target.role
    };
  }

  if (Object.keys(authPatch).length > 0) {
    const { error: authErr } = await admin.auth.admin.updateUserById(targetUserId, authPatch);
    if (authErr) throw new Error(authErr.message);
  }

  const dbPatch = {};
  if (displayName !== undefined) dbPatch.display_name = String(displayName || target.username).trim();
  if (typeof isActive === 'boolean') dbPatch.is_active = isActive;

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
  if (isAndroid) return 'Android · Termux';
  if (os.platform() === 'win32') return `Windows PC (${os.hostname()})`;
  return `${os.platform()} (${os.hostname()})`;
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
      fs.writeFileSync(this.filePath, JSON.stringify({ updatedAt: new Date().toISOString(), items: obj }, null, 2), 'utf8');
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
    this.client = null;
    this.user = null;
    this.whatsappManager = null;
    this.broadcastFn = null;
    this.heartbeatTimer = null;
    this.commandPollTimer = null;
    this.syncTimer = null;
    this.realtimeChannel = null;
    this.processingCommands = new Set();
    this.lastSyncedWorkspaceIso = '';
    this.syncInFlight = false;
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

    // Toda mutação local (nova msg WhatsApp, estágio CRM, estatística) agenda sync imediato para o Supabase
    localStorageInstance.onMutate = () => {
      this.scheduleLocalToCloudSync();
    };
  }

  getStatus() {
    return {
      configured: isCloudConfigured(),
      loggedIn: Boolean(this.user?.id),
      user: this.user || null,
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
    // Se for a conta Master em máquina que já tinha sessão conectada na raiz data/wa_auth/creds.json, migra sem perder conexão!
    if (role === 'master') {
      const rootCreds = path.join(AUTH_DIR, 'creds.json');
      const targetCreds = path.join(userAuthDir, 'creds.json');
      if (fs.existsSync(rootCreds) && !fs.existsSync(targetCreds)) {
        try {
          for (const entry of fs.readdirSync(AUTH_DIR, { withFileTypes: true })) {
            if (entry.isFile()) {
              fs.copyFileSync(path.join(AUTH_DIR, entry.name), path.join(userAuthDir, entry.name));
            }
          }
          console.log('[CloudWorker] Sessão WhatsApp existente migrada para o cofre isolado da conta Master.');
        } catch (err) {
          console.warn('[CloudWorker] Aviso ao copiar sessão WhatsApp existente:', err.message);
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
      throw new Error('Esta conta está bloqueada pelo administrador.');
    }
    return this.getStatus();
  }

  async promptTerminalLoginIfInteractive() {
    if (IS_VERCEL || this.user?.id) return;
    if (!process.stdin.isTTY || process.env.ZAPIA_NO_TTY_PROMPT === '1') {
      console.log('☁️  [Nuvem ZAP-IA] Motor aguardando login da conta em http://localhost:3000 (ou via API).');
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    try {
      console.log('\n========================================================');
      console.log('🔐 LOGIN DA SUA CONTA ZAP-IA STUDIO (MOTOR WHATSAPP)');
      console.log('   (Ou pressione ENTER em branco para logar pelo navegador)');
      console.log('========================================================');
      const u = (await ask('👉 Usuário: ')).trim();
      if (!u) {
        rl.close();
        console.log('🌐 Abra http://localhost:3000 no navegador para entrar na sua conta.\n');
        return;
      }
      const p = (await ask('🔑 Senha: ')).trim();
      rl.close();
      await this.loginWorkerWithCredentials(u, p);
      console.log(`✅ Conectado à nuvem como @${this.user.username} (${this.user.displayName})!\n`);
    } catch (err) {
      try { rl.close(); } catch {}
      console.error(`⚠️  Falha no login pelo terminal: ${err.message}. Você pode entrar pelo navegador em http://localhost:3000.\n`);
    }
  }

  async activateWorkerSession(authUser) {
    const { data: profile } = await this.client
      .from('zapia_users')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profile && profile.is_active === false) {
      await this.logoutWorker();
      return false;
    }

    this.user = {
      id: authUser.id,
      username: profile?.username || normalizeUsername(authUser.email || ''),
      displayName: profile?.display_name || profile?.username || 'Usuário',
      role: profile?.role || 'user',
      isActive: true
    };

    localStorageInstance.userId = this.user.id;
    localStorageInstance.username = this.user.username;
    localStorageInstance.userRole = this.user.role;

    // 1. Configura pasta isolada de autenticação Baileys para esta conta
    const userAuthDir = this.ensurePerUserWhatsAppAuthDir(this.user.id, this.user.role);

    // 2. Puxa os dados atuais dessa conta na nuvem (para que o celular/PC rode exatamente o cérebro desta conta!)
    await this.pullCloudIntoLocal(true);

    // 3. Inicia Heartbeat, Realtime de Comandos e Auto-Restore do WhatsApp desta conta
    this.startBackgroundLoops();
    await this.pushRuntimeHeartbeat();

    if (this.whatsappManager && fs.existsSync(path.join(userAuthDir, 'creds.json'))) {
      if (this.whatsappManager.status !== 'connected' && this.whatsappManager.status !== 'connecting') {
        this.whatsappManager.connect(null).catch((e) => {
          console.error('[CloudWorker] Erro ao restaurar WhatsApp da conta:', e.message);
        });
      }
    }

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
        await this.client
          .from('zapia_wa_runtime')
          .update({
            worker_online: false,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', this.user.id);
        await this.client.auth.signOut();
      } catch {}
    }
    this.sessionStore.clearAll();
    this.user = null;
    if (this.broadcastFn) {
      this.broadcastFn('cloud_auth', this.getStatus());
    }
  }

  async pullCloudIntoLocal(initial = false) {
    if (!this.client || !this.user?.id) return;
    const uid = this.user.id;

    const [wsRes, contactsRes] = await Promise.all([
      this.client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
      initial
        ? this.client.from('zapia_contacts').select('chat_id, data').eq('user_id', uid)
        : Promise.resolve({ data: null })
    ]);

    const ws = wsRes.data;
    if (ws) {
      if (initial || (ws.updated_at && ws.updated_at > this.lastSyncedWorkspaceIso)) {
        this.lastSyncedWorkspaceIso = ws.updated_at || new Date().toISOString();
        const contactsMap = initial ? {} : localStorageInstance.data.contacts;
        if (initial && Array.isArray(contactsRes.data)) {
          for (const row of contactsRes.data) {
            if (row?.chat_id && row?.data) contactsMap[row.chat_id] = row.data;
          }
        }
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
          localStorageInstance.workspaceDirty = false;
          if (initial) {
            localStorageInstance.dirtyContactIds.clear();
            localStorageInstance.deletedContactIds.clear();
            localStorageInstance.initialContactKeys = new Set(Object.keys(localStorageInstance.data.contacts || {}));
          }
          localStorageInstance.writeNow();
          localStorageInstance.workspaceDirty = false;
        } finally {
          localStorageInstance.onMutate = prevMutate;
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
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.flushLocalToCloud().catch((err) => {
        console.error('[CloudWorker] Erro ao sincronizar dados com Supabase:', err.message);
      });
    }, 450);
  }

  async flushLocalToCloud() {
    if (!this.client || !this.user?.id || this.syncInFlight) return;
    this.syncInFlight = true;
    try {
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
            if (pubUrl) v.url = pubUrl;
          }
        }
      }

      // Sobe mídias recentes de contatos (ex: áudio que o cliente mandou no WhatsApp!) para tocar no navegador da Vercel!
      for (const cid of localStorageInstance.dirtyContactIds) {
        const contact = localStorageInstance.data.contacts[cid];
        if (!contact?.messages?.length) continue;
        const recent = contact.messages.slice(-4);
        for (const m of recent) {
          if (m?.mediaUrl && m.mediaUrl.startsWith('/uploads/')) {
            const fn = path.basename(m.mediaUrl);
            const fp = path.join(UPLOADS_DIR, fn);
            if (fs.existsSync(fp)) {
              const ext = path.extname(fn).toLowerCase();
              const mime =
                ext === '.ogg' ? 'audio/ogg' :
                ext === '.mp3' ? 'audio/mpeg' :
                ext === '.png' ? 'image/png' :
                ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
              const pubUrl = await uploadMediaBufferToCloud(this.client, this.user.id, fn, fs.readFileSync(fp), mime);
              if (pubUrl) m.mediaUrl = pubUrl;
            }
          }
        }
      }

      await flushTenantStoreToCloud(this.client, this.user.id, localStorageInstance);
      this.lastSyncedWorkspaceIso = new Date().toISOString();
    } finally {
      this.syncInFlight = false;
    }
  }

  async pushRuntimeHeartbeat() {
    if (!this.client || !this.user?.id || !this.whatsappManager) return;
    try {
      const st = this.whatsappManager.getPublicState();
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
          worker_heartbeat_at: new Date().toISOString(),
          worker_platform: detectWorkerPlatformLabel(),
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
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
      .subscribe();

    // 2. Polling resiliente de segurança a cada 2.5s (caso o 4G do celular oscile o WebSocket Realtime)
    this.commandPollTimer = setInterval(() => {
      this.pollPendingCommands().catch(() => {});
    }, 2500);

    // 3. Heartbeat a cada 12s + verificação de sincronia de workspace
    this.heartbeatTimer = setInterval(() => {
      this.pushRuntimeHeartbeat().catch(() => {});
      this.pullCloudIntoLocal(false).catch(() => {});
    }, 12_000);
  }

  stopBackgroundLoops() {
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
    this.processingCommands.add(row.id);

    try {
      await this.client
        .from('zapia_commands')
        .update({ status: 'processing' })
        .eq('id', row.id);

      const p = row.payload || {};
      let result = { ok: true };

      switch (row.action) {
        case 'wa_connect': {
          const st = await this.whatsappManager.connect(p.pairingPhone || null);
          await this.pushRuntimeHeartbeat();
          result = { ok: true, waState: st };
          break;
        }
        case 'wa_disconnect': {
          const st = await this.whatsappManager.disconnect(p.clearSession !== false);
          await this.pushRuntimeHeartbeat();
          result = { ok: true, waState: st };
          break;
        }
        case 'wa_test_owner_alert': {
          const out = await this.whatsappManager.sendTestAlertToOwner(p.phone);
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
          break;
        }
        case 'send_crm_reply': {
          const cleanJid = String(p.chatId || '').replace(/^demo_/, '');
          await this.whatsappManager.sendManualOwnerMessage(cleanJid, p.text, true);
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
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
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_crm_recorded_voice': {
          const localAudio = await ensureLocalMediaCached(p.filename, p.mediaUrl);
          if (!localAudio) throw new Error('Arquivo de áudio gravado não encontrado para envio.');
          const oggBuffer = fs.readFileSync(localAudio);
          await this.whatsappManager.sendCanonicalVoiceNote({
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
            mediaUrl: p.mediaUrl,
            durationSec: p.durationSec || 1,
            waveform: p.waveform
          });
          localStorageInstance.pauseContact(p.chatId, biz.lockUntilManualResume ? 'forever' : 60, 'Nota de voz enviada manualmente pelo painel');
          await this.flushLocalToCloud();
          const key = localStorageInstance.findSiblingContactKey(p.chatId) || p.chatId;
          result = { ok: true, sentRealWhatsApp: true, contact: localStorageInstance.data.contacts[key] };
          break;
        }
        case 'send_proactive': {
          await this.pullCloudIntoLocal(false);
          const out = await this.whatsappManager.sendProactiveAiOpening(p.phone, p.text, p.name, p.voiceId || '');
          await this.flushLocalToCloud();
          result = { ok: true, ...out, stats: localStorageInstance.data.stats };
          break;
        }
        case 'queue_start': {
          await this.pullCloudIntoLocal(false);
          const queue = this.whatsappManager.enqueueProactiveBatch(p.leads || [], p.text || '');
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
          processed_at: new Date().toISOString()
        })
        .eq('id', row.id);
    } catch (err) {
      await this.client
        .from('zapia_commands')
        .update({
          status: 'error',
          error_text: err.message || 'Erro ao processar comando no Motor WhatsApp',
          processed_at: new Date().toISOString()
        })
        .eq('id', row.id);
    } finally {
      this.processingCommands.delete(row.id);
    }
  }
}

export const cloudWorker = new CloudWorkerBridge();

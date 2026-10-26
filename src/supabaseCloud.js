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
  localStorageInstance,
  mergeContactMessagesUnion
} from './storage.js';

const CLOUD_SESSION_FILE = path.join(DATA_DIR, 'cloud_session.json');
const WORKER_HEARTBEAT_TTL_MS = 95_000;
const APP_VERSION = (() => {
  try {
    const pkgPath = path.resolve(DATA_DIR, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '4.9.0';
  } catch {
    return '4.9.0';
  }
})();

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
  const age = Date.now() - ts;
  // Tolera até 60s de relógio adiantado no celular e até 95s de oscilação 4G/Doze
  return age >= -60_000 && age <= WORKER_HEARTBEAT_TTL_MS;
}

export function mapCloudRuntimeToWaState(rt = null, botEnabled = true) {
  const online = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
  const platformStr = String(rt?.worker_platform || '');
  const verMatch = platformStr.match(/v(\d+\.\d+\.\d+)/i);
  const rawStatus = rt?.status || 'disconnected';
  const updAgeMs = rt?.updated_at ? Math.max(0, Date.now() - new Date(rt.updated_at).getTime()) : 999_999;

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
      role: 'user',
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

  // Zero-Trust: role NUNCA é lida de user_metadata (editável pelo cliente), somente da tabela protegida zapia_users!
  const effectiveProfile = profile || {
    user_id: data.user.id,
    username: normalizeUsername(data.user.email || '') || 'usuario',
    display_name: data.user.user_metadata?.display_name || 'Usuário',
    role: 'user',
    is_active: true
  };

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
export async function loadTenantContextFromCloud(client, authUser, profile) {
  const uid = authUser.id;
  const isMaster = profile?.role === 'master';

  const [wsRes, contactsRes, rtRes] = await Promise.all([
    client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
    client.from('zapia_contacts').select('chat_id, data').eq('user_id', uid).order('last_message_at', { ascending: false }).limit(2000),
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

    // Proteção Anti-Sobrescrita Multi-Dispositivo (Vercel <-> Termux):
    // Ao salvar poucos contatos (ex.: marcar como lido, pausar IA, etapa Kanban ou nota interna na Vercel),
    // faz união (CRDT) das mensagens já salvas no Supabase para NUNCA apagar mensagens recém-enviadas pelo motor!
    let remoteMap = new Map();
    if (dirtyIds.length <= 15) {
      try {
        const { data: remoteRows } = await client
          .from('zapia_contacts')
          .select('chat_id, data')
          .eq('user_id', userId)
          .in('chat_id', dirtyIds);
        if (Array.isArray(remoteRows)) {
          remoteMap = new Map(remoteRows.map((r) => [r.chat_id, r.data]));
        }
      } catch {
        // Segue normalmente caso falhe leitura auxiliar
      }
    }

    const rows = [];
    for (const cid of dirtyIds) {
      const c = tenantStore.data.contacts[cid];
      if (!c) continue;
      const remoteData = remoteMap.get(cid);
      if (remoteData?.messages?.length) {
        c.messages = mergeContactMessagesUnion(c.messages, remoteData.messages);
        const lastReal = [...(c.messages || [])].reverse().find((m) => m.role !== 'internal_note');
        if (lastReal?.timestamp && (!c.lastMessageAt || lastReal.timestamp > c.lastMessageAt)) {
          c.lastMessageAt = lastReal.timestamp;
        }
      }
      rows.push({
        user_id: userId,
        chat_id: cid,
        data: c,
        last_message_at: c.lastMessageAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
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
  const [usersRes, rtRes, contactsRes, wsRes] = await Promise.all([
    admin.from('zapia_users').select('*').order('created_at', { ascending: true }),
    admin.from('zapia_wa_runtime').select('user_id, status, connected_user, worker_online, worker_heartbeat_at, worker_platform'),
    admin.from('zapia_contacts').select('user_id, data'),
    admin.from('zapia_workspaces').select('user_id, business, settings, stats, updated_at')
  ]);

  if (usersRes.error) throw new Error(usersRes.error.message);

  const rtMap = new Map((rtRes.data || []).map((r) => [r.user_id, r]));
  const wsMap = new Map((wsRes.data || []).map((w) => [w.user_id, w]));
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
    const cStat = contactStats.get(u.user_id) || { total: 0, awaitingHuman: 0, unread: 0, messages: 0 };
    const workerOnline = Boolean(rt?.worker_online) && isWorkerHeartbeatFresh(rt?.worker_heartbeat_at);
    const waConnected = workerOnline && rt?.status === 'connected';

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

    return {
      userId: u.user_id,
      username: u.username,
      displayName: u.display_name || u.username,
      customerPhone: u.customer_phone || '',
      adminNotes: u.admin_notes || '',
      role: u.role || 'user',
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
      workerPlatform: rt?.worker_platform || null,
      waStatus: workerOnline ? (rt?.status || 'disconnected') : 'offline',
      connectedPhone: rt?.connected_user?.id
        ? String(rt.connected_user.id).split(':')[0].split('@')[0]
        : (rt?.connected_user?.phone || null)
    };
  });
}

export async function createManagedUser({ username, password, displayName, customerPhone = '', adminNotes = '' }) {
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
  const cleanPhone = String(customerPhone || '').replace(/\D/g, '');
  const cleanNotes = String(adminNotes || '').trim();

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

  await Promise.all([
    admin.from('zapia_users').upsert({
      user_id: uid,
      username: cleanUsername,
      display_name: cleanDisplay,
      customer_phone: cleanPhone,
      admin_notes: cleanNotes,
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
    customerPhone: cleanPhone,
    adminNotes: cleanNotes,
    role: 'user',
    isActive: true
  };
}

export async function updateManagedUser(targetUserId, { password, displayName, isActive, customerPhone, adminNotes } = {}) {
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
    this.lastSyncedContactsIso = '';
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
      throw new Error('Esta conta está bloqueada pelo administrador.');
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
      console.log('☁️  [Nuvem ZAP-IA] Motor aguardando login da conta em http://localhost:3000 (ou via API).');
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    try {
      console.log('\n========================================================');
      console.log('🔐 1º PASSO — VINCULAR SUA CONTA ZAP-IA STUDIO');
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

  async markWorkerOfflineNow() {
    this.stopBackgroundLoops();
    if (!this.client || !this.user?.id) return;
    try {
      await this.flushLocalToCloud().catch(() => {});
      await this.client
        .from('zapia_wa_runtime')
        .update({
          worker_online: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', this.user.id);
    } catch {}
  }

  async pullCloudIntoLocal(initial = false) {
    if (!this.client || !this.user?.id) return;
    const uid = this.user.id;

    const contactsQuery = initial || !this.lastSyncedContactsIso
      ? this.client
          .from('zapia_contacts')
          .select('chat_id, data, updated_at')
          .eq('user_id', uid)
          .order('last_message_at', { ascending: false })
          .limit(2000)
      : this.client
          .from('zapia_contacts')
          .select('chat_id, data, updated_at')
          .eq('user_id', uid)
          .gt('updated_at', this.lastSyncedContactsIso);

    const [wsRes, contactsRes] = await Promise.all([
      this.client.from('zapia_workspaces').select('*').eq('user_id', uid).maybeSingle(),
      contactsQuery
    ]);

    let contactsChanged = false;
    const healedIds = [];
    if (Array.isArray(contactsRes?.data) && contactsRes.data.length > 0) {
      const prevLocalContacts = { ...(localStorageInstance.data.contacts || {}) };
      const prevMutate = localStorageInstance.onMutate;
      localStorageInstance.onMutate = null;
      try {
        if (initial) {
          localStorageInstance.data.contacts = {};
        }
        let maxIso = this.lastSyncedContactsIso;
        for (const row of contactsRes.data) {
          if (row?.updated_at && (!maxIso || row.updated_at > maxIso)) {
            maxIso = row.updated_at;
          }
          if (!row?.chat_id || !row?.data) continue;
          // Não sobrescreve contato que possui mutação local pendente de upload
          if (!initial && localStorageInstance.dirtyContactIds.has(row.chat_id)) continue;

          const prevLocal = prevLocalContacts[row.chat_id];
          const cloudContact = { ...row.data };
          if (prevLocal?.messages?.length) {
            const beforeCount = Array.isArray(cloudContact.messages) ? cloudContact.messages.length : 0;
            cloudContact.messages = mergeContactMessagesUnion(cloudContact.messages, prevLocal.messages);
            if (cloudContact.messages.length > beforeCount) {
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
        if (maxIso) this.lastSyncedContactsIso = maxIso;
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
      this.lastSyncedContactsIso = new Date().toISOString();
    }

    const ws = wsRes.data;
    if (ws) {
      if (initial || (ws.updated_at && ws.updated_at > this.lastSyncedWorkspaceIso)) {
        this.lastSyncedWorkspaceIso = ws.updated_at || new Date().toISOString();
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

          await flushTenantStoreToCloud(this.client, this.user.id, localStorageInstance);
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
        case 'wa_sync_history': {
          const out = await this.whatsappManager.syncAllConversationsFromPhone({
            force: true,
            waitMs: Number(p.waitMs) || 6500
          });
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
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
          const out = await this.whatsappManager.sendTestAlertToOwner(p.phone);
          await this.flushLocalToCloud();
          result = { ok: true, ...out };
          break;
        }
        case 'send_crm_reply': {
          await this.pullCloudIntoLocal(false);
          const cleanJid = String(p.chatId || '').replace(/^demo_/, '');
          await this.whatsappManager.sendManualOwnerMessage(cleanJid, p.text, true, {
            quotedMsgId: p.quotedMsgId || ''
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

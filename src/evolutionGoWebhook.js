/**
 * Evolution Go Webhook Router
 * Recebe mensagens do Evolution Go, processa com a IA do Ienvia Motor (skills) e responde.
 * Funciona no Vercel (serverless) e na VPS/Docker (motor ou servidor standalone).
 *
 * Integração: Evolution Go → POST /webhook → IA (Gemini/OpenRouter) → Resposta via API Evolution Go
 *
 * Configuração (env):
 *   EVOLUTION_GO_URL         — URL do pool Evolution Go (default: pool pageup)
 *   EVOLUTION_GO_API_KEY     — Chave global (para /instance/all)
 *   EVOLUTION_INSTANCE_USERS — Mapa instância → user_id Supabase (multi-tenant)
 *   EVOLUTION_DEFAULT_USER_ID — user_id padrão (se não tiver mapa)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — business/settings/histórico no Supabase
 *
 * Mount no motor: app.use('/api/evolution-webhook', evolutionGoWebhookRouter)
 * Servidor standalone: evolution-webhook.mjs (root)
 */

import { Router } from 'express';
import express from 'express';
import { generateSmartReply } from './aiEngine.js';
import { getAdminClient } from './supabaseCloud.js';
import { trueNowIso } from './trueClock.js';

export const evolutionGoWebhookRouter = Router();

// Parse de JSON (o motor já tem, mas o server standalone precisa)
evolutionGoWebhookRouter.use(express.json({ limit: '10mb' }));

const EVOLUTION_GO_URL = process.env.EVOLUTION_GO_URL || 'https://pool-evolution-go-025.cloud2.pageup.dev.br';
const EVOLUTION_GO_API_KEY = process.env.EVOLUTION_GO_API_KEY || 'de641771b68731fb4340696241bd2cd6';

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const memoryHistory = new Map(); // chatId -> [messages] (uso quando sem Supabase)

// ======================== RESOLVER USUÁRIO (tenant) ========================
function resolveUserId(instanceName) {
  let map = {};
  try {
    map = JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}');
  } catch {}
  return map[instanceName] || process.env.EVOLUTION_DEFAULT_USER_ID || null;
}

// ======================== CARREGAR BUSINESS + SETTINGS (Supabase) ========================
async function loadTenant(instanceName) {
  if (!HAS_SUPABASE) return { profile: {}, settings: {}, userId: null };
  const userId = resolveUserId(instanceName);
  if (!userId) {
    console.warn(`[EvolutionWebhook] Nenhum user_id mapeado para a instância "${instanceName}" — veja EVOLUTION_INSTANCE_USERS`);
    return { profile: {}, settings: {}, userId: null };
  }
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('zapia_workspaces')
    .select('business, settings')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    console.warn(`[EvolutionWebhook] Workspace não encontrado para user_id ${userId}: ${error?.message || 'sem dados'}`);
    return { profile: {}, settings: {}, userId };
  }
  return { profile: data.business || {}, settings: data.settings || {}, userId };
}

// ======================== HISTÓRICO DA CONVERSA ========================
async function loadHistory(userId, chatId) {
  if (!userId) return memoryHistory.get(chatId) || [];
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('zapia_contacts')
    .select('data')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error || !data?.data) return [];
  return (data.data.messages || []).filter((m) => m && m.role !== 'internal_note');
}

async function saveHistory(userId, chatId, messages, contactName) {
  if (!userId) {
    memoryHistory.set(chatId, messages);
    return;
  }
  const admin = getAdminClient();
  const contact = {
    name: contactName || chatId,
    messages,
    lastMessageAt: trueNowIso(),
    stage: 'ativo',
    unreadCount: 0,
    archived: false,
  };
  const { error } = await admin
    .from('zapia_contacts')
    .upsert(
      {
        user_id: userId,
        chat_id: chatId,
        data: contact,
        last_message_at: trueNowIso(),
        updated_at: trueNowIso(),
      },
      { onConflict: 'user_id,chat_id' }
    );
  if (error) console.warn(`[EvolutionWebhook] Falha ao salvar histórico: ${error.message}`);
}

// ======================== ENVIAR MENSAGEM (API Evolution Go) ========================
async function getInstanceToken(instanceName) {
  const response = await fetch(`${EVOLUTION_GO_URL}/instance/all`, {
    headers: { 'apikey': EVOLUTION_GO_API_KEY },
  });
  const result = await response.json();
  if (!result.data) return null;
  const instance = result.data.find((i) => i.name === instanceName);
  return instance ? instance.token : null;
}

async function sendMessage(instanceName, number, text, tokenOverride) {
  const token = tokenOverride || await getInstanceToken(instanceName);
  if (!token) return { error: 'Token não encontrado para ' + instanceName };
  const response = await fetch(`${EVOLUTION_GO_URL}/send/text`, {
    method: 'POST',
    headers: {
      'apikey': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number, text }),
  });
  return await response.json();
}

// ======================== ROTAS ========================
evolutionGoWebhookRouter.post('/webhook', async (req, res) => {
  // Payload oficial Evolution Go: {event, instance, data:{key, message}}
  // Também aceita formato antigo: {instance: {data: {instance, key, message}}}
  const instanceName = req.body?.instance?.data?.instance || req.body?.instance;
  const key = req.body?.instance?.data?.key || req.body?.data?.key;
  const message = req.body?.instance?.data?.message || req.body?.data?.message;
  const instanceToken = req.body?.instanceToken || req.body?.instance?.data?.instanceToken || req.body?.apikey || null;
  const event = req.body?.event || req.body?.instance?.data?.event || 'MESSAGE';

  if (!instanceName || !key) {
    return res.status(400).json({ error: 'Invalid webhook payload', received: req.body });
  }

  // Ignorar eventos que não são mensagens
  const isMessageEvent = ['MESSAGE', 'MESSAGE_RECEIVED', 'messages.upsert'].includes(
    String(event).toUpperCase()
  );
  if (!isMessageEvent) {
    return res.status(200).json({ ok: true, ignored: 'event', event });
  }

  const remoteJid = key?.remoteJid || '';
  if (key?.fromMe || key?.IsFromMe) {
    return res.status(200).json({ ok: true, ignored: 'fromMe' });
  }
  if (remoteJid.endsWith('@g.us')) {
    return res.status(200).json({ ok: true, ignored: 'group' });
  }

  const phoneNumber = remoteJid.split('@')[0];
  const chatId = remoteJid || `${phoneNumber}@s.whatsapp.net`;

  // Extrair texto da mensagem
  const msgType = message;
  let userText = '';
  if (msgType?.conversation) {
    userText = msgType.conversation;
  } else if (msgType?.extendedTextMessage?.text) {
    userText = msgType.extendedTextMessage.text;
  } else if (msgType?.imageMessage?.caption) {
    userText = msgType.imageMessage.caption;
  }

  if (!userText) {
    return res.status(200).json({ ok: true, ignored: 'no-text' });
  }

  try {
    // Carregar tenant (business + settings) e histórico
    const tenant = await loadTenant(instanceName);
    const history = await loadHistory(tenant.userId, chatId);
    const nextHistory = [...history, { role: 'user', text: userText, ts: Date.now() }];

    // Gerar resposta com IA (skills do Ienvia Motor — demo fallback se sem chaves)
    const reply = await generateSmartReply({
      profile: tenant.profile,
      settings: tenant.settings,
      history: nextHistory.slice(0, -1),
      userText,
      contactName: phoneNumber,
      allowDemoFallback: true,
    });

    // Enviar resposta
    if (reply.cleanText) {
      await sendMessage(instanceName, phoneNumber, reply.cleanText, instanceToken);
    }

    // Persistir histórico
    nextHistory.push({ role: 'assistant', text: reply.cleanText, ts: Date.now() });
    if (nextHistory.length > 40) nextHistory.splice(0, nextHistory.length - 40);
    await saveHistory(tenant.userId, chatId, nextHistory, phoneNumber);

    console.log(
      `[EvolutionWebhook] ${instanceName} → ${phoneNumber}: "${userText.slice(0, 40)}" → "${String(reply.cleanText).slice(0, 60)}"`
    );
    return res.status(200).json({ ok: true, reply: reply.cleanText, provider: reply.providerUsed });
  } catch (err) {
    console.error('[EvolutionWebhook] Erro:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

evolutionGoWebhookRouter.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

evolutionGoWebhookRouter.get('/status', (req, res) => {
  res.json({
    ok: true,
    evolutionGoUrl: EVOLUTION_GO_URL,
    supabase: HAS_SUPABASE,
    instances: HAS_SUPABASE ? Object.keys(JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}')) : [],
  });
});

// Enviar mensagem manual (teste)
evolutionGoWebhookRouter.post('/send', async (req, res) => {
  const { instance, number, text } = req.body;
  res.json(await sendMessage(instance, number, text));
});

/**
 * Evolution Go Webhook Router
 * Recebe mensagens do Evolution Go, processa com a IA do Ienvia Motor (skills) e responde.
 * Funciona no Vercel (serverless) e na VPS/Docker (motor ou servidor standalone).
 *
 * Integração: Evolution Go → POST /webhook → IA (Gemini/OpenRouter) → Resposta via API Evolution Go
 *
 * Suporte: texto, áudio (voz) e imagem. Aceita os dois formatos de payload do Evolution Go:
 *   1. {event, instance, data: {key, message}}          — formato novo (evolution-api)
 *   2. {event, instance, data: {Info, Message}}         — formato evolution-foundation
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
import { convertToCanonicalWhatsAppVoice } from './audioProcessor.js';
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
  // Aceita os dois formatos de payload do Evolution Go
  const instanceName = req.body?.instance?.data?.instance || req.body?.instance;
  const data = req.body?.instance?.data || req.body?.data || {};
  const info = data.Info || {};
  const message = data.message || data.Message || req.body?.instance?.data?.message || req.body?.instance?.data?.Message || {};
  const instanceToken = req.body?.instanceToken || data.instanceToken || req.body?.apikey || null;
  const event = req.body?.event || data.event || 'MESSAGE';

  if (!instanceName) {
    return res.status(400).json({ error: 'Invalid webhook payload', received: req.body });
  }

  // Ignorar eventos que não são mensagens
  const isMessageEvent = ['MESSAGE', 'MESSAGE_RECEIVED', 'messages.upsert'].includes(
    String(event).toUpperCase()
  );
  if (!isMessageEvent) {
    return res.status(200).json({ ok: true, ignored: 'event', event });
  }

  // Remetente/destinatário (aceita key.remoteJid e Info.Chat/Sender)
  const key = data.key || {};
  const remoteJid = key.remoteJid || info.Chat || info.Sender || '';
  if (!remoteJid) {
    return res.status(200).json({ ok: true, ignored: 'no-jid' });
  }
  if (key.fromMe ?? key.IsFromMe ?? info.IsFromMe) {
    return res.status(200).json({ ok: true, ignored: 'fromMe' });
  }
  if (remoteJid.endsWith('@g.us') || info.IsGroup) {
    return res.status(200).json({ ok: true, ignored: 'group' });
  }

  const phoneNumber = remoteJid.split('@')[0];
  const chatId = remoteJid;

  // Extrair texto e mídia da mensagem
  let userText = '';
  let media = null;

  if (message.conversation) {
    userText = message.conversation;
  } else if (message.extendedTextMessage?.text) {
    userText = message.extendedTextMessage.text;
  } else if (message.imageMessage?.caption) {
    userText = message.imageMessage.caption;
  }

  // Áudio / imagem (base64 do payload)
  if (message.audioMessage || message.imageMessage) {
    const b64Raw = data.base64 || message.base64 || '';
    if (b64Raw) {
      const b64 = String(b64Raw).replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 0) {
        if (message.audioMessage) {
          try {
            // Converte para voz canônica do WhatsApp (Ogg/Opus) — ffmpeg se disponível, JS puro se já for Ogg/Opus
            const canonical = await convertToCanonicalWhatsAppVoice(buf, 'audio.ogg');
            media = { mimeType: canonical.mimeType, buffer: canonical.buffer, durationSec: canonical.durationSec };
          } catch (err) {
            console.warn('[EvolutionWebhook] Áudio não convertível (mídia bruta enviada):', err.message);
            media = { mimeType: 'audio/ogg', buffer: buf };
          }
        } else if (message.imageMessage) {
          media = { mimeType: message.imageMessage.mimetype || 'image/jpeg', buffer: buf };
        }
      }
    }
  }

  if (!userText && !media) {
    return res.status(200).json({ ok: true, ignored: 'no-text' });
  }

  try {
    // Carregar tenant (business + settings) e histórico
    const tenant = await loadTenant(instanceName);
    const history = await loadHistory(tenant.userId, chatId);
    const userTurn = { role: 'user', text: userText || (media ? '[áudio/imagem]' : ''), ts: Date.now() };
    const nextHistory = [...history, userTurn];

    // Gerar resposta com IA (skills do Ienvia Motor — demo fallback se sem chaves)
    const reply = await generateSmartReply({
      profile: tenant.profile,
      settings: tenant.settings,
      history: nextHistory.slice(0, -1),
      userText,
      media,
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
      `[EvolutionWebhook] ${instanceName} → ${phoneNumber}: "${userText || '[mídia]'}" → "${String(reply.cleanText).slice(0, 60)}"`
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

// ROTEIRA TEMPORÁRIA (setup): listar user_ids do auth.users para mapear instâncias
evolutionGoWebhookRouter.get('/users', async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase.auth.admin.listUsers({ limit: 100 });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ users: (data?.users || []).map((u) => ({ id: u.id, email: u.email })) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

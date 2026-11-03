/**
 * Evolution API v2 Webhook Router
 * Recebe mensagens do Evolution API v2, processa com a IA do Ienvia Motor (skills) e responde.
 * Funciona no Vercel (serverless) e na VPS/Docker (motor ou servidor standalone).
 *
 * Integração: Evolution API v2 → POST /webhook → IA (Gemini/OpenRouter) → Resposta via API Evolution API v2
 *
 * Suporte: texto, áudio (voz) e imagem. Aceita os dois formatos de payload do Evolution API v2:
 *   1. {event, instance, data: {key, message}}          — formato novo (evolution-api)
 *   2. {event, instance, data: {Info, Message}}         — formato evolution-foundation
 *
 * Configuração (env):
 *   EVOLUTION_API_URL         — URL do pool Evolution API v2 (default: pool pageup)
 *   EVOLUTION_API_KEY     — Chave global (para /instance/all)
 *   EVOLUTION_INSTANCE_USERS — Mapa instância → user_id Supabase (multi-tenant)
 *   EVOLUTION_DEFAULT_USER_ID — user_id padrão (se não tiver mapa)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — business/settings/histórico no Supabase
 *
 * Mount no motor: app.use('/api/evolution-webhook', evolutionApiWebhookRouter)
 * Servidor standalone: evolution-webhook.mjs (root)
 */

import { Router } from 'express';
import express from 'express';
import { generateSmartReply } from './aiEngine.js';
import { getAdminClient } from './supabaseCloud.js';
import { convertToCanonicalWhatsAppVoice } from './audioProcessor.js';
import { trueNowIso } from './trueClock.js';
import { buildContactChannelKey } from './storage.js';
import { assertEvolutionApiAccepted } from './evolutionApiResponse.js';

export const evolutionApiWebhookRouter = Router();

// Parse de JSON (o motor já tem, mas o server standalone precisa)
evolutionApiWebhookRouter.use(express.json({ limit: '10mb' }));

const EVOLUTION_API_URL = String(process.env.EVOLUTION_API_URL || 'https://pool-evolution-api-067.cloud2.pageup.dev.br').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const memoryHistory = new Map(); // chatId -> [messages] (uso quando sem Supabase)

// ======================== RESOLVER USUÁRIO (tenant) ========================
function scopedChatId(instanceName, jid) {
  const slot = String(instanceName || '').match(/zap-ia-(?:[0-9a-f-]{36}-)?(slot_[1-3])$/i)?.[1] || 'slot_1';
  return buildContactChannelKey(slot, jid);
}

function resolveUserId(instanceName) {
  let map = {};
  try {
    map = JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}');
  } catch {}
  const tenant = String(instanceName || '').match(/^zap-ia-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-slot_[1-3]$/i)?.[1];
  return tenant || map[instanceName] || process.env.EVOLUTION_DEFAULT_USER_ID || null;
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
  const incoming = (Array.isArray(messages) ? messages : []).filter(Boolean).map((m) => {
    const timestamp = new Date(m.timestamp || m.ts || Date.now()).toISOString();
    const waMsgId = String(m.waMsgId || m.id || '');
    return { ...m, id: m.id || waMsgId || `evo-${timestamp}`, ...(waMsgId ? { waMsgId } : {}), timestamp };
  });
  if (!userId) {
    const prior = memoryHistory.get(chatId) || [];
    const map = new Map(prior.map((m) => [m.waMsgId || m.id, m]));
    for (const m of incoming) map.set(m.waMsgId || m.id, { ...(map.get(m.waMsgId || m.id) || {}), ...m });
    memoryHistory.set(chatId, [...map.values()].slice(-120)); return { error: null };
  }
  const admin = getAdminClient();
  const { data: row, error: readError } = await admin.from('zapia_contacts').select('data').eq('user_id', userId).eq('chat_id', chatId).maybeSingle();
  if (readError) return { error: readError.message };
  const existing = row?.data && typeof row.data === 'object' ? row.data : {};
  const byKey = new Map((Array.isArray(existing.messages) ? existing.messages : []).map((m) => [String(m.waMsgId || m.id || `${m.role}|${m.timestamp}|${m.text}`), m]));
  for (const m of incoming) {
    const k = String(m.waMsgId || m.id || `${m.role}|${m.timestamp}|${m.text}`);
    let target = byKey.get(k);
    // Merge a paired IA SEND_MESSAGE webhook with the assistant turn that the same
    // serverless invocation may have persisted before/after the webhook callback.
    if (!target && (m.role === 'owner' || m.role === 'assistant') && m.text) {
      const t = Date.parse(m.timestamp || 0);
      target = [...byKey.values()].find((old) => ['owner','assistant'].includes(old.role) && old.text === m.text && Math.abs(Date.parse(old.timestamp || 0) - t) <= 60_000);
    }
    if (target) {
      Object.assign(target, m, { role:target.role === 'assistant' && m.role === 'owner' ? 'assistant' : m.role });
      if (m.waMsgId) target.waMsgId = m.waMsgId;
    } else byKey.set(k, m);
  }
  const merged = [...new Set(byKey.values())].sort((x,y) => Date.parse(x.timestamp || 0)-Date.parse(y.timestamp || 0)).slice(-120);
  const latest = merged.at(-1)?.timestamp || existing.lastMessageAt || trueNowIso();
  const contact = { ...existing, ...(contactName && (!existing.name || existing.name === chatId) ? { name: contactName } : {}), messages: merged, lastMessageAt: latest };
  const { error } = await admin.from('zapia_contacts').upsert({ user_id:userId, chat_id:chatId, data:contact, last_message_at:latest, updated_at:trueNowIso() }, { onConflict:'user_id,chat_id' });
  if (error) console.warn(`[EvolutionWebhook] Falha ao salvar histórico: ${error.message}`);
  return { error:error?.message || null };
}
function ackLevelFromEvolutionUpdate(value) {
  if (typeof value === 'number') return value >= 4 ? 3 : value === 3 ? 2 : value === 2 ? 1 : 0;
  const status = String(value || '').toUpperCase();
  if (status === 'READ' || status === 'PLAYED') return 3;
  if (status === 'DELIVERY_ACK' || status === 'DELIVERED') return 2;
  if (status === 'SERVER_ACK' || status === 'SENT') return 1;
  return 0;
}

async function persistMessageAck(userId, chatId, messageId, ack) {
  if (!userId || !messageId || ack < 1) return false;
  const admin = getAdminClient();
  const { data: row, error: readError } = await admin.from('zapia_contacts').select('data').eq('user_id', userId).eq('chat_id', chatId).maybeSingle();
  if (readError || !row?.data || !Array.isArray(row.data.messages)) return false;
  const message = row.data.messages.find((item) => String(item.waMsgId || item.id || '') === String(messageId));
  if (!message) return false;
  message.ack = Math.max(Number(message.ack) || 0, ack);
  delete message.deliveryStatus;
  const { error } = await admin.from('zapia_contacts').upsert({ user_id: userId, chat_id: chatId, data: row.data, last_message_at: row.data.lastMessageAt || null, updated_at: trueNowIso() }, { onConflict: 'user_id,chat_id' });
  if (error) console.warn(`[EvolutionWebhook] Falha ao salvar confirmação de entrega: ${error.message}`);
  return !error;
}

function extractMessageText(message = {}) {
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || message.documentMessage?.caption || message.buttonsResponseMessage?.selectedDisplayText || message.listResponseMessage?.title || '';
}

// ======================== ENVIAR MENSAGEM (Evolution API v2) ========================
async function sendMessage(instanceName, number, text) {
  if (!EVOLUTION_API_KEY) return { error: 'EVOLUTION_API_KEY não configurada.' };
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, text }),
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) {
      const errorText = typeof data?.error === 'string' ? data.error : data?.error?.message;
      return { error: errorText || data?.message || `Evolution API HTTP ${response.status}` };
    }
    try { return assertEvolutionApiAccepted(data); }
    catch (err) { return { error: err.message }; }
  } catch (err) {
    return { error: err.message };
  }
}

// ======================== ROTAS ========================
evolutionApiWebhookRouter.post('/webhook', async (req, res) => {
  // Aceita os dois formatos de payload do Evolution API v2
  const instanceName = req.body?.instance?.data?.instance || req.body?.instance;
  const data = req.body?.instance?.data || req.body?.data || {};
  const info = data.Info || {};
  const message = data.message || data.Message || req.body?.instance?.data?.message || req.body?.instance?.data?.Message || {};
  const event = req.body?.event || data.event || 'MESSAGE';

  if (!instanceName) {
    return res.status(400).json({ error: 'Invalid webhook payload', received: req.body });
  }

  // Ignorar eventos que não são mensagens
  const eventKey = String(event).trim().toUpperCase().replace(/[.\s-]+/g, '_');
  if (eventKey === 'MESSAGES_UPDATE') {
    const updates = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [data];
    const userId = resolveUserId(instanceName);
    let updated = 0;
    for (const item of updates) {
      const updateKey = item?.key || item?.data?.key || {};
      const remote = updateKey.remoteJid || item?.remoteJid || '';
      const messageId = updateKey.id || item?.id || '';
      const status = item?.update?.status ?? item?.status ?? item?.ack ?? item?.data?.status;
      const ack = ackLevelFromEvolutionUpdate(status);
      if (remote && messageId && ack > 0 && await persistMessageAck(userId, scopedChatId(instanceName, remote), String(messageId), ack)) updated += 1;
    }
    return res.status(200).json({ ok: true, updated, event: eventKey });
  }
  const isHistoryEvent = eventKey.includes('HISTORY_SYNC') || eventKey === 'HISTORYSYNC';
  const isMessageEvent = ['MESSAGE', 'MESSAGE_RECEIVED', 'MESSAGES_UPSERT', 'SEND_MESSAGE'].includes(eventKey) || isHistoryEvent;
  if (!isMessageEvent) return res.status(200).json({ ok: true, ignored: 'event', event });

  // Remetente/destinatário (aceita key.remoteJid e Info.Chat/Sender)
  const key = data.key || {};
  const remoteJid = key.remoteJid || info.Chat || info.Sender || '';
  if (!remoteJid && !isHistoryEvent) return res.status(200).json({ ok: true, ignored: 'no-jid' });
  const fromMe = Boolean(key.fromMe ?? key.IsFromMe ?? info.IsFromMe ?? data.fromMe ?? data.IsFromMe);
  if (isHistoryEvent) {
    const tenant = await loadTenant(instanceName);
    const conversations = data.conversations || data.Conversations;
    const entries = data.messages || data.Messages || data.history || data.History || (Array.isArray(conversations) ? conversations.flatMap((c) => (c.messages || c.Messages || []).map((m) => ({ ...m, _chat: c.id || c.chat || c.Info?.Chat || c.Jid }))) : []);
    const list = Array.isArray(entries) ? entries : (entries ? [entries] : []); let saved = 0;
    for (const entry of list) {
      const ei = entry.Info || entry.info || {}; const ek = entry.key || ei.Key || {}; const jid = ek.remoteJid || ei.Chat || entry.chat || entry._chat || remoteJid;
      if (!jid || jid.endsWith('@g.us')) continue;
      const payload = entry.message || entry.Message || entry; const text = extractMessageText(payload); const id = ek.id || ei.ID || entry.id || ei.Id;
      const raw = entry.messageTimestamp || ei.Timestamp || entry.timestamp || ei.TimestampMS; const n = Number(raw); const ts = new Date(n > 1e12 ? n : n > 0 ? n*1000 : Date.now()).toISOString();
      if (!id && !text) continue;
      await saveHistory(tenant.userId, scopedChatId(instanceName, jid), [{ id:String(id || `history-${ts}`), ...(id ? {waMsgId:String(id)} : {}), waMsgKey:ek, role:(ek.fromMe ?? ei.IsFromMe) ? 'owner' : 'user', text:text || '[mídia]', timestamp:ts, historical:true }], jid.split('@')[0]); saved++;
    }
    return res.status(200).json({ ok:true, historical:true, saved });
  }
  if (remoteJid.endsWith('@g.us') || info.IsGroup) {
    return res.status(200).json({ ok: true, ignored: 'group' });
  }

  const phoneNumber = remoteJid.split('@')[0];
  const chatId = scopedChatId(instanceName, remoteJid);

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

  if (!userText && !media) userText = extractMessageText(message) || (message.videoMessage ? '[vídeo]' : message.documentMessage ? '[documento]' : '');
  if (!userText && !media) return res.status(200).json({ ok: true, ignored: 'no-text' });
  if (fromMe || eventKey === 'SEND_MESSAGE') {
    try { const tenant = await loadTenant(instanceName); const id = key.id || info.ID || data.id; const raw = data.messageTimestamp || info.Timestamp || data.timestamp; const n = Number(raw); const ts = new Date(n > 1e12 ? n : n > 0 ? n*1000 : Date.now()).toISOString();
      await saveHistory(tenant.userId, chatId, [{id:String(id || `out-${ts}`), ...(id ? {waMsgId:String(id)} : {}), waMsgKey:key, role:'owner', text:userText || '[mídia]', timestamp:ts}], phoneNumber);
      return res.status(200).json({ok:true, persisted:true, role:'owner'}); } catch(err) { return res.status(200).json({ok:false,error:err.message}); }
  }

  try {
    // Carregar tenant (business + settings) e histórico — paralelo para reduzir latency
    const userId = resolveUserId(instanceName);
    const [tenant, history] = await Promise.all([
      loadTenant(instanceName),
      loadHistory(userId, chatId),
    ]);
    const rawTs = data.messageTimestamp || info.Timestamp || data.timestamp; const n = Number(rawTs); const timestamp = new Date(n > 1e12 ? n : n > 0 ? n*1000 : Date.now()).toISOString();
    const waMsgId = key.id || info.ID || data.id;
    const userTurn = { id:String(waMsgId || `in-${timestamp}`), ...(waMsgId ? {waMsgId:String(waMsgId)} : {}), waMsgKey:key, role:'user', text:userText || '[mídia]', timestamp };
    if (waMsgId && history.some((m) => String(m.waMsgId || m.id || '') === String(waMsgId))) {
      return res.status(200).json({ ok:true, duplicate:true });
    }
    const nextHistory = [...history, userTurn];

    // Verificar se IA está ligada para este número (settings.botEnabled do workspace)
    const iaEnabled = tenant.settings?.botEnabled !== false;

    let reply;
    if (iaEnabled) {
      // Gerar resposta com IA (skills do Ienvia Motor — demo fallback se sem chaves)
      reply = await generateSmartReply({
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
        const sent = await sendMessage(instanceName, phoneNumber, reply.cleanText);
        if (sent?.error) throw new Error(sent.error);
      }
    } else {
      // IA desligada para este número: apenas registrar a mensagem, não responder
      // (opcional: settings.iaOffReply — mensagem de fallback)
      const offReply = tenant.settings?.iaOffReply || '';
      if (offReply) {
        const sent = await sendMessage(instanceName, phoneNumber, offReply);
        if (sent?.error) throw new Error(sent.error);
        reply = { cleanText: offReply, providerUsed: 'ia_off_fallback' };
      } else {
        reply = { cleanText: '', providerUsed: 'ia_off' };
      }
    }

    // Persistir histórico (sem resposta da IA se desligada)
    if (reply.cleanText) nextHistory.push({ id:`ai-${Date.now()}`, role:'assistant', text:reply.cleanText, timestamp:trueNowIso() });
    if (nextHistory.length > 120) nextHistory.splice(0, nextHistory.length - 120);
    const saveResult = await saveHistory(tenant.userId, chatId, nextHistory, phoneNumber);

    console.log(
      `[EvolutionWebhook] ${instanceName} → ${phoneNumber}: "${userText || '[mídia]'}" → "${String(reply.cleanText).slice(0, 60)}" (IA: ${iaEnabled ? 'on' : 'off'})`
    );
    return res.status(200).json({ ok: true, reply: reply.cleanText, provider: reply.providerUsed, iaEnabled });
  } catch (err) {
    console.error('[EvolutionWebhook] Erro:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

evolutionApiWebhookRouter.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

evolutionApiWebhookRouter.get('/status', (req, res) => {
  res.json({
    ok: true,
    evolutionApiUrl: EVOLUTION_API_URL,
    evolutionApiConfigured: Boolean(EVOLUTION_API_KEY),
    supabase: HAS_SUPABASE,
    instances: HAS_SUPABASE ? Object.keys(JSON.parse(process.env.EVOLUTION_INSTANCE_USERS || '{}')) : [],
  });
});

// Enviar mensagem manual (teste)
evolutionApiWebhookRouter.post('/send', (_req, res) => res.status(404).json({ ok: false, error: 'Rota desativada.' }));

// LIMPAR conversas de teste no CRM (temporário)
evolutionApiWebhookRouter.post('/clear', (_req, res) => res.status(404).json({ ok: false, error: 'Rota desativada.' }));

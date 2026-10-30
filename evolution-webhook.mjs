/**
 * Evolution Go Webhook Server
 * Recebe mensagens do Evolution Go, processa com IA (Ienvia Motor skills) e responde.
 *
 * Integração: Evolution Go → Webhook → IA (Gemini/OpenRouter) → Resposta via Evolution Go API
 *
 * Formato do payload do Evolution Go (oficial):
 * {
 *   "event": "MESSAGE",
 *   "instance": "nome-da-instancia",          // string
 *   "data": {
 *     "key": { "remoteJid": "55X@s.whatsapp.net", "fromMe": false, "id": "..." },
 *     "message": { "conversation": "texto" },
 *     "messageTimestamp": "...",
 *     "pushName": "..."
 *   },
 *   "instanceId": "uuid",
 *   "instanceToken": "token-da-instancia"      // optional em algumas versões
 * }
 *
 * Também aceita o formato antigo: { instance: { data: { instance, key, message } } }
 */

import express from 'express';
import cors from 'cors';
import {
  buildSystemPrompt,
  generateSmartReply,
  analyzeLeadSentiment,
  detectPromptInjection,
  polishHumanWhatsappReply,
  parseGeminiKeyPool,
  isSoloProfessionalProfile,
} from './src/aiEngine.js';
import { storage } from './src/storage.js';
import { trueNowIso } from './src/trueClock.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Configurações
const EVOLUTION_GO_URL = process.env.EVOLUTION_GO_URL || 'https://pool-evolution-go-025.cloud2.pageup.dev.br';
const EVOLUTION_GO_API_KEY = process.env.EVOLUTION_GO_API_KEY || 'de641771b68731fb4340696241bd2cd6';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Estado do motor (para múltiplas contas)
const instances = new Map(); // instanceName -> { token, jid, connected }

// Histórico de conversas (por número)
const conversations = new Map(); // phoneNumber -> [messages]

// ======================== WEBHOOK (mensagens recebidas do Evolution Go) ========================
app.post('/webhook', async (req, res) => {
  // Aceita o formato oficial e o formato antigo (instance.data.*)
  const instanceName = req.body?.instance?.data?.instance || req.body?.instance;
  const key = req.body?.instance?.data?.key || req.body?.data?.key;
  const message = req.body?.instance?.data?.message || req.body?.data?.message;
  const instanceToken = req.body?.instanceToken || req.body?.instance?.data?.instanceToken || req.body?.apikey || null;
  const event = req.body?.event || req.body?.instance?.data?.event || 'MESSAGE';

  if (!instanceName || !key) {
    return res.status(400).json({ error: 'Invalid webhook payload', received: req.body });
  }

  // Verificar segredo opcional (header X-Webhook-Secret ou body)
  if (WEBHOOK_SECRET) {
    const secret = req.header('X-Webhook-Secret') || req.body?.secret;
    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  // Ignorar eventos que não são mensagens
  const isMessageEvent = ['MESSAGE', 'MESSAGE_RECEIVED', 'messages.upsert'].includes(
    String(event).toUpperCase()
  );
  if (!isMessageEvent) {
    return res.status(200).json({ ok: true, ignored: 'event', event });
  }

  const remoteJid = key?.remoteJid || '';
  const from = remoteJid || key?.from || '';
  const phoneNumber = from.split('@')[0];

  // Não responde mensagens próprias (isFromMe / IsFromMe)
  if (key?.fromMe || key?.IsFromMe) {
    return res.status(200).json({ ok: true, ignored: 'fromMe' });
  }

  // Não responde mensagens de grupos
  if (remoteJid.endsWith('@g.us')) {
    return res.status(200).json({ ok: true, ignored: 'group' });
  }

  // Extrair texto da mensagem (message já é o objeto WhatsApp {conversation, ...})
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

  // Processar com IA
  try {
    // Histórico da conversa
    if (!conversations.has(phoneNumber)) {
      conversations.set(phoneNumber, []);
    }
    const history = conversations.get(phoneNumber);

    // Adiciona mensagem do usuário
    history.push({ role: 'user', text: userText, ts: Date.now() });

    // Limita histórico
    if (history.length > 20) history.splice(0, history.length - 20);

    // Carregar configuração do perfil/cliente
    const profile = storage.data.profile || {};
    const settings = storage.data.settings || {};

    // Gerar resposta com IA (demo fallback se não houver chaves do cliente)
    const reply = await generateSmartReply({
      profile,
      settings,
      history,
      userText,
      contactName: phoneNumber,
      allowDemoFallback: true,
    });

    // Enviar resposta
    if (reply.cleanText) {
      await sendMessage(instanceName, phoneNumber, reply.cleanText, instanceToken);
    }

    // Salvar no histórico
    history.push({ role: 'assistant', text: reply.cleanText, ts: Date.now() });

    console.log(`[Webhook] ${instanceName} → ${phoneNumber}: "${userText.slice(0, 40)}" → "${String(reply.cleanText).slice(0, 60)}"`);
    return res.status(200).json({ ok: true, reply: reply.cleanText });
  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

// ======================== SEND MESSAGE (envia via Evolution Go API) ========================
async function sendMessage(instanceName, number, text, tokenOverride) {
  // Pegar token da instância (usar o do payload do webhook se disponível)
  const token = tokenOverride || await getInstanceToken(instanceName);

  if (!token) {
    console.error('[SendMessage] Token não encontrado para', instanceName);
    return { error: 'Token não encontrado para ' + instanceName };
  }

  const response = await fetch(`${EVOLUTION_GO_URL}/send/text`, {
    method: 'POST',
    headers: {
      'apikey': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number,
      text,
    }),
  });

  const result = await response.json();
  if (result.error) {
    console.error('[SendMessage] Erro:', result.error);
  } else {
    console.log('[SendMessage] Enviada para', number, '-', text.substring(0, 50));
  }
  return result;
}

// ======================== PEGAR TOKEN DA INSTÂNCIA ========================
async function getInstanceToken(instanceName) {
  // Verificar cache primeiro
  const cached = instances.get(instanceName);
  if (cached?.token) return cached.token;

  // Listar instâncias
  const response = await fetch(`${EVOLUTION_GO_URL}/instance/all`, {
    headers: { 'apikey': EVOLUTION_GO_API_KEY },
  });

  const result = await response.json();
  if (!result.data) return null;

  const instance = result.data.find((i) => i.name === instanceName);
  if (instance) {
    instances.set(instanceName, {
      token: instance.token,
      jid: instance.jid,
      connected: instance.connected,
    });
    return instance.token;
  }
  return null;
}

// ======================== ROTAS DE TESTE ========================
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    evolutionGoUrl: EVOLUTION_GO_URL,
    instances: Array.from(instances.keys()),
    conversations: Array.from(conversations.keys()),
  });
});

// Enviar mensagem manual (teste)
app.post('/send', async (req, res) => {
  const { instance, number, text } = req.body;
  const result = await sendMessage(instance, number, text);
  res.json(result);
});

// ======================== INÍCIO ========================
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Evolution Go Webhook rodando em :${PORT}`);
  console.log(`   Webhook: http://localhost:${PORT}/webhook`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Status:  http://localhost:${PORT}/status`);
});

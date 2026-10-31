/**
 * Evolution Go Cloud Bridge Router
 * Permite ao painel nuvem (Vercel) conectar WhatsApp via Evolution Go API sem motor local (Termux/PC).
 *
 * Fluxo:
 *   1. Criar instância (POST /instance/create)
 *   2. Conectar (POST /instance/connect) → QR code ou código de pareamento
 *   3. Status (GET /instance/status)
 *   4. Reconectar (POST /instance/reconnect)
 *   5. Desconectar (POST /instance/disconnect)
 *
 * Mount no server.js: app.use('/api/evolution-cloud', evolutionGoCloudRouter)
 */

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'crypto';

export const evolutionGoCloudRouter = Router();
evolutionGoCloudRouter.use(express.json({ limit: '10mb' }));

const EVOLUTION_GO_URL = process.env.EVOLUTION_GO_URL || 'https://pool-evolution-go-025.cloud2.pageup.dev.br';
const EVOLUTION_GO_API_KEY = process.env.EVOLUTION_GO_API_KEY || 'de641771b68731fb4340696241bd2cd6';

// Cache de instâncias no formato que o painel espera (waState.slots)
const instanceCache = new Map(); // slotId → { instanceId, name, token, status, qrDataUrl, pairingCode, ... }

/**
 * Faz requisição à API Evolution Go com a chave global.
 */
async function evolutionGoFetch(path, options = {}, tokenOverride = null) {
  const headers = {
    'apikey': tokenOverride || EVOLUTION_GO_API_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const url = `${EVOLUTION_GO_URL}${path}`;
  try {
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/**
 * Lista todas as instâncias da conta.
 */
async function listInstances() {
  const result = await evolutionGoFetch('/instance/all');
  if (result.ok && Array.isArray(result.data?.data)) {
    return result.data.data;
  }
  return [];
}

/**
 * Cria uma nova instância na Evolution Go.
 */
async function createInstance(instanceId, name, token) {
  return evolutionGoFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({ instanceId, name, token }),
  });
}

/**
 * Busca a instância por nome.
 */
async function findInstanceByName(name) {
  const instances = await listInstances();
  return instances.find(i => i.name === name);
}

/**
 * Busca ou cria uma instância para um slot.
 */
async function ensureInstance(slotId, suffix) {
  const name = `zap-ia-${slotId}${suffix ? '-' + suffix : ''}`;
  let instance = await findInstanceByName(name);
  if (!instance) {
    const instanceId = randomUUID();
    const token = `zap_ia_${slotId}_${Date.now().toString(36)}`;
    const createResult = await createInstance(instanceId, name, token);
    if (createResult.ok) {
      instance = {
        id: instanceId,
        name,
        token,
        data: { id: instanceId, name, token },
      };
      // Aguarda um pouco para a instância estar disponível
      await new Promise(r => setTimeout(r, 1500));
    } else {
      return { error: `Falha ao criar instância: ${createResult.data?.error || createResult.error}` };
    }
  }
  return { instance };
}

/**
 * Conecta a instância e obtém QR code.
 */
async function connectInstance(instanceToken, webhookUrl = null) {
  const body = { immediate: false };
  if (webhookUrl) {
    body.webhookUrl = webhookUrl;
    body.subscribe = ['MESSAGE'];
  }
  return evolutionGoFetch('/instance/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  }, instanceToken);
}

/**
 * Obtém o QR code de uma instância.
 */
async function getInstanceQr(instanceToken) {
  return evolutionGoFetch('/instance/qr', { method: 'GET' }, instanceToken);
}

/**
 * Gera código de pareamento para um número.
 */
async function requestPairingCode(instanceToken, phone) {
  return evolutionGoFetch('/instance/pair', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  }, instanceToken);
}

/**
 * Reconecta uma instância.
 */
async function reconnectInstance(instanceToken) {
  return evolutionGoFetch('/instance/reconnect', {
    method: 'POST',
    body: JSON.stringify({}),
  }, instanceToken);
}

/**
 * Desconecta uma instância.
 */
async function disconnectInstance(instanceToken) {
  return evolutionGoFetch('/instance/disconnect', {
    method: 'POST',
    body: JSON.stringify({}),
  }, instanceToken);
}

/**
 * Obtém o status de uma instância.
 */
async function getInstanceStatus(instanceToken) {
  return evolutionGoFetch('/instance/status', { method: 'GET' }, instanceToken);
}

// A API Evolution Go já retorna QR code como data URL (data:image/png;base64,...)
// não é necessário converter — o valor é usado diretamente.

// ======================== ROTAS ========================

/**
 * GET /api/evolution-cloud/status
 * Retorna o estado atual das instâncias Evolution Go.
 */
evolutionGoCloudRouter.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const instances = await listInstances();
    const slots = {};
    for (const inst of instances) {
      // Parse slot ID from instance name (zap-ia-slot_1)
      const slotMatch = inst.name?.match(/zap-ia-(slot_\d+)/);
      const slotId = slotMatch ? slotMatch[1] : 'slot_1';
      slots[slotId] = {
        slotId,
        instanceId: inst.id,
        name: inst.name,
        status: inst.connected ? 'connected' : 'disconnected',
        phone: inst.jid ? inst.jid.split(':')[0] : null,
        webhookUrl: inst.webhook || null,
      };
    }

    // Check cache for QR codes and pairing codes
    for (const [slotId, cached] of instanceCache.entries()) {
      if (!slots[slotId]) {
        slots[slotId] = { slotId, ...cached };
      } else {
        slots[slotId].qrDataUrl = cached.qrDataUrl || null;
        slots[slotId].pairingCode = cached.pairingCode || null;
      }
    }

    res.json({
      ok: true,
      available: true,
      slots,
      instanceCount: instances.length,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, available: false });
  }
});

/**
 * POST /api/evolution-cloud/connect
 * Cria/reusa instância, conecta e retorna QR code.
 * Body: { slotId, pairingPhone }
 */
evolutionGoCloudRouter.post('/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const pairingPhone = req.body?.pairingPhone || null;

    // Busca ou cria instância
    const { instance, error } = await ensureInstance(slotId);
    if (error) return res.status(500).json({ ok: false, error });

    const instanceToken = instance.token;

    // Se foi solicitado código de pareamento
    if (pairingPhone) {
      const pairResult = await requestPairingCode(instanceToken, pairingPhone);
      if (pairResult.ok) {
        const code = pairResult.data?.data?.PairingCode || pairResult.data?.data?.code || pairResult.data?.PairingCode || pairResult.data?.code || null;
        // Cache do código de pareamento
        instanceCache.set(slotId, {
          instanceId: instance.id,
          name: instance.name,
          token: instanceToken,
          status: 'qr_ready',
          pairingCode: code,
          qrDataUrl: null,
        });
        return res.json({
          ok: true,
          slotId,
          instanceId: instance.id,
          status: 'qr_ready',
          pairingCode: code,
          qrDataUrl: null,
        });
      }
      const errMsg = pairResult.data?.error || pairResult.error || '';
      if (errMsg.includes('429') || errMsg.includes('rate-overlimit')) {
        return res.status(429).json({
          ok: false,
          error: 'Número temporariamente limitado pelo WhatsApp (429). Aguarde 15-40 minutos e tente novamente.',
        });
      }
      return res.status(500).json({ ok: false, error: `Falha ao gerar código: ${errMsg}` });
    }

    // Conecta a instância (com webhook configurado para receber mensagens)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${baseUrl}/api/evolution-webhook`;
    const connectResult = await connectInstance(instanceToken, webhookUrl);

    // Obtém QR code (pode ser assincrono)
    let qrDataUrl = null;
    try {
      const qrResult = await getInstanceQr(instanceToken);
      if (qrResult.ok && qrResult.data?.data) {
        // Formato: { data: { qrcode: "data:image/png;base64,...", code: "https://wa.me/..." } }
        qrDataUrl = qrResult.data.data.qrcode || null;
      }
    } catch {
      // QR pode ainda não estar disponível, voltamos com status connecting
    }

    const status = qrDataUrl ? 'qr_ready' : 'connecting';

    // Cache
    instanceCache.set(slotId, {
      instanceId: instance.id,
      name: instance.name,
      token: instanceToken,
      status,
      qrDataUrl,
      pairingCode: null,
    });

    res.json({
      ok: true,
      slotId,
      instanceId: instance.id,
      status,
      pairingCode: null,
      qrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/refresh-qr
 * Atualiza o QR code de uma instância (para quando ainda não está disponível).
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/refresh-qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = instanceCache.get(slotId);
    if (!cached) {
      return res.status(404).json({ ok: false, error: 'Instância não encontrada' });
    }

    const qrResult = await getInstanceQr(cached.token);
    let qrDataUrl = null;
    if (qrResult.ok && qrResult.data?.data) {
      qrDataUrl = qrResult.data.data.qrcode || null;
    }

    if (qrDataUrl) {
      cached.qrDataUrl = qrDataUrl;
      cached.status = 'qr_ready';
    }

    res.json({
      ok: true,
      slotId,
      status: cached.status,
      qrDataUrl: qrDataUrl || cached.qrDataUrl,
      pairingCode: cached.pairingCode,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/reconnect
 * Reconecta uma instância existente.
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/reconnect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = instanceCache.get(slotId);
    if (!cached) {
      return res.status(404).json({ ok: false, error: 'Instância não encontrada' });
    }

    const reconnectResult = await reconnectInstance(cached.token);
    if (!reconnectResult.ok) {
      return res.status(500).json({ ok: false, error: `Falha ao reconectar: ${reconnectResult.data?.error || reconnectResult.error}` });
    }

    // Tenta obter QR code
    let qrDataUrl = null;
    try {
      const qrResult = await getInstanceQr(cached.token);
      if (qrResult.ok && qrResult.data?.data?.qrcode) {
        qrDataUrl = qrResult.data.data.qrcode;
      }
    } catch {}

    cached.status = qrDataUrl ? 'qr_ready' : 'connecting';
    cached.qrDataUrl = qrDataUrl || null;

    res.json({
      ok: true,
      slotId,
      status: cached.status,
      qrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/disconnect
 * Desconecta uma instância.
 * Body: { slotId }
 */
evolutionGoCloudRouter.post('/disconnect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || 'slot_1';
    const cached = instanceCache.get(slotId);
    if (!cached) {
      return res.status(404).json({ ok: false, error: 'Instância não encontrada' });
    }

    const disconnectResult = await disconnectInstance(cached.token);
    cached.status = 'disconnected';
    cached.qrDataUrl = null;
    cached.pairingCode = null;

    res.json({ ok: true, slotId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/evolution-cloud/delete
 * Deleta uma instância da Evolution Go.
 * Body: { slotId } or { instanceId }
 */
evolutionGoCloudRouter.post('/delete', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slotId = req.body?.slotId || null;
    const instanceId = req.body?.instanceId || null;

    if (!instanceId && !slotId) {
      return res.status(400).json({ ok: false, error: 'Informe slotId ou instanceId' });
    }

    const targetId = instanceId || (instanceCache.get(slotId)?.instanceId);
    if (!targetId) {
      return res.status(404).json({ ok: false, error: 'Instância não encontrada' });
    }

    const result = await evolutionGoFetch(`/instance/delete/${targetId}`, { method: 'DELETE' });
    if (result.ok) {
      if (slotId) instanceCache.delete(slotId);
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: `Falha ao deletar: ${result.data?.error || result.error}` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ======================== UTILITÁRIO PARA O SERVER ========================
// Retorna o status real dos slots da Evolution Go (para merge no waState do poll)
// Exportado para server.js usar no /api/cloud/poll quando em modo nuvem (vercel_cloud).
export async function getEvolutionGoSlotStatus() {
  const instances = await listInstances();
  const slots = {};
  for (const inst of instances) {
    const slotMatch = inst.name?.match(/zap-ia-(slot_\d+)/);
    const slotId = slotMatch ? slotMatch[1] : 'slot_1';
    const cached = instanceCache.get(slotId) || {};
    slots[slotId] = {
      slotId,
      instanceId: inst.id,
      name: inst.name,
      status: inst.connected ? 'connected' : 'disconnected',
      phone: inst.jid ? inst.jid.split(':')[0] : null,
      qrDataUrl: inst.qrcode || cached.qrDataUrl || null,
      pairingCode: cached.pairingCode || null,
    };
  }
  return slots;
}

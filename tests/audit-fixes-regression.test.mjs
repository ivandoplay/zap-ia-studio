import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Executar somente na cópia isolada');
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.ZAPIA_NO_TTY_PROMPT = '1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Storage, localStorageInstance: store } = await import('../src/storage.js');
const { whatsappManager } = await import('../src/whatsappManager.js');
const { cloudWorker, buildCloudMultiSlotWaState } = await import('../src/supabaseCloud.js');

store.inMemory = true;
store.onMutate = null;
store.data.settings.securityPin = '';
cloudWorker.getStatus = () => ({ configured: false, loggedIn: false });
cloudWorker.tryRestoreSavedLogin = async () => false;
cloudWorker.promptTerminalLoginIfInteractive = async () => {};
whatsappManager.autoRestoreIfSessionExists = async () => {};

let server;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  server = this;
  return originalListen.call(this, 0, '127.0.0.1');
};
await import('../src/server.js');
http.Server.prototype.listen = originalListen;
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('buildCloudMultiSlotWaState nao ressuscita slot_1 desconectado em conta multi-slot', () => {
  const nowIso = new Date().toISOString();
  const multiSlot = buildCloudMultiSlotWaState({
    rtRow: {
      status: 'connected',
      worker_online: true,
      worker_heartbeat_at: nowIso,
      connected_user: { id: '558699990002', phone: '558699990002', name: 'Chip 2' }
    },
    slotRows: [
      { slot_id: 'slot_1', status: 'disconnected', worker_online: true, worker_heartbeat_at: nowIso, device_id: 'dev-1' },
      { slot_id: 'slot_2', status: 'connected', worker_online: true, worker_heartbeat_at: nowIso, device_id: 'dev-1', connected_user: { id: '558699990002', phone: '558699990002', name: 'Chip 2' } }
    ],
    deviceRows: [{ device_id: 'dev-1', device_label: 'PC', online: true, heartbeat_at: nowIso }],
    settings: { botEnabled: true, waSlots: {} },
    maxWaSlots: 3
  });
  assert.equal(multiSlot.slots.slot_1.status, 'disconnected');
  assert.equal(multiSlot.slots.slot_1.connectedUser, null);
  assert.equal(multiSlot.slots.slot_2.status, 'connected');
  assert.equal(multiSlot.status, 'connected');

  const legacy = buildCloudMultiSlotWaState({
    rtRow: {
      status: 'connected',
      worker_online: true,
      worker_heartbeat_at: nowIso,
      connected_user: { id: '558699990001', phone: '558699990001', name: 'Legado' }
    },
    slotRows: [],
    deviceRows: [],
    settings: { botEnabled: true, waSlots: {} },
    maxWaSlots: 1
  });
  assert.equal(legacy.slots.slot_1.status, 'connected');
  assert.equal(legacy.slots.slot_1.connectedUser?.phone, '558699990001');
});

test('BUG-009: fingerprint permanece estavel entre import-preview e import-text sem updatedAt persistido', async () => {
  delete store.data.business.updatedAt;
  store.data.business.voiceLibrary = [{ id: 'aud_1', name: 'Saudacao', filename: 'x.ogg' }];

  const payload = {
    profile: {
      name: 'Clinica Homologada',
      niche: 'Saude',
      tone: 'acolhedor',
      faqs: [{ question: 'Atendem sabado?', answer: 'Sim, ate 12h.' }]
    },
    approvedMessages: [{ title: 'Oi', text: 'Ola! Como posso ajudar?' }],
    operationalSkills: [{ name: 'Triagem', when: 'Inicio', bodyMd: 'Pergunte o motivo do contato.' }],
    humanizationSkills: [{ name: 'Tom', goal: 'Responder com clareza.' }]
  };

  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'treinamento.json');
  const prev1 = await (await fetch(`${base}/api/training-packs/import-preview`, { method: 'POST', body: form })).json();
  assert.equal(prev1.ok, true);

  await new Promise((r) => setTimeout(r, 20));
  const form2 = new FormData();
  form2.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'treinamento.json');
  const prev2 = await (await fetch(`${base}/api/training-packs/import-preview`, { method: 'POST', body: form2 })).json();
  assert.equal(prev2.ok, true);
  assert.equal(prev2.preview.currentFingerprint, prev1.preview.currentFingerprint);

  const applyRes = await fetch(`${base}/api/training-packs/import-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: JSON.stringify(payload),
      filename: 'treinamento.json',
      expectedFingerprint: prev1.preview.currentFingerprint
    })
  });
  const applyBody = await applyRes.json();
  assert.equal(applyRes.status, 200, JSON.stringify(applyBody));
  assert.equal(applyBody.ok, true);

  const s1 = new Storage({
    inMemory: true,
    isCloudTenant: true,
    fallbackClean: true,
    initialData: { business: { name: 'Tenant Sem UpdatedAt', voiceLibrary: [{ id: 'aud_1', name: 'Saudacao', filename: 'x.ogg' }] } }
  });
  await new Promise((r) => setTimeout(r, 15));
  const s2 = new Storage({
    inMemory: true,
    isCloudTenant: true,
    fallbackClean: true,
    initialData: { business: { name: 'Tenant Sem UpdatedAt', voiceLibrary: [{ id: 'aud_1', name: 'Saudacao', filename: 'x.ogg' }] } }
  });
  assert.equal(s1.data.business.updatedAt, '');
  assert.equal(s2.data.business.updatedAt, '');
  assert.equal(s1.data.business.voiceLibrary[0].createdAt, '');
  assert.equal(s2.data.business.voiceLibrary[0].createdAt, '');

  // Stale fingerprint after applying MUST still yield 409
  const staleRes = await fetch(`${base}/api/training-packs/import-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: JSON.stringify(payload),
      filename: 'treinamento.json',
      expectedFingerprint: prev1.preview.currentFingerprint
    })
  });
  assert.equal(staleRes.status, 409);
});

test('BUG-008: system-prompt/preview diferencia estado salvo de rascunho nao salvo', async () => {
  const b = store.getBusiness();
  const baseDraft = {
    name: b.name,
    niche: b.niche,
    assistantName: b.assistantName,
    soloIdentity: Boolean(b.soloIdentity),
    tone: b.tone,
    companySummary: b.companySummary || '',
    deliveryAndPayment: b.deliveryAndPayment || '',
    goldenRules: b.goldenRules || '',
    extraInstructions: b.extraInstructions || '',
    lockUntilManualResume: Boolean(b.lockUntilManualResume),
    promptShieldEnabled: Boolean(b.promptShieldEnabled),
    faqs: (b.faqs || []).map((f) => ({ question: f.question || '', answer: f.answer || '' }))
  };

  const savedRes = await fetch(`${base}/api/business/system-prompt/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ business: baseDraft })
  });
  const savedBody = await savedRes.json();
  assert.equal(savedRes.status, 200);
  assert.equal(savedBody.source, 'saved');

  const dirtyRes = await fetch(`${base}/api/business/system-prompt/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ business: { ...baseDraft, companySummary: `${baseDraft.companySummary} (rascunho)` } })
  });
  const dirtyBody = await dirtyRes.json();
  assert.equal(dirtyRes.status, 200);
  assert.equal(dirtyBody.source, 'unsaved_form_snapshot');
});

test('app.js expoe checkEvolutionCloud no topo, mapeia slots para UUID em /historico e campanhas trata falha', () => {
  const appJs = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const idxDecl = appJs.indexOf('async function checkEvolutionCloud()');
  const idxBind = appJs.indexOf('function bindEvents()');
  assert.ok(idxDecl > 0 && idxBind > 0 && idxDecl < idxBind, 'checkEvolutionCloud deve estar no escopo global antes de bindEvents');
  assert.match(appJs, /histInstanceId\(c\.id\)/);
  assert.match(appJs, /00000000-0000-4000-8000-/);
  assert.match(appJs, /m\.at \|\| m\.timestamp \|\| m\.createdAt/);

  const campJs = fs.readFileSync(path.join(root, 'public/campanhas.js'), 'utf8');
  assert.match(campJs, /Não foi possível carregar as campanhas agora/);

  const redactedPass = ['Davi32', 'ivan@#'].join('');
  for (const doc of ['DOCUMENTACAO_CORRECOES.md', 'GUIA_PARA_IA.md', 'CONTEXTO_SISTEMA.md']) {
    const content = fs.readFileSync(path.join(root, doc), 'utf8');
    assert.equal(content.includes(redactedPass), false, `${doc} nao deve conter senha em texto claro`);
  }
});

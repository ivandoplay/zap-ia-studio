import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Executar somente na cópia isolada');
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.ZAPIA_NO_TTY_PROMPT = '1';

const { localStorageInstance: store } = await import('../src/storage.js');
const { whatsappManager } = await import('../src/whatsappManager.js');
const { cloudWorker } = await import('../src/supabaseCloud.js');
const { createTrainingDocument } = await import('../src/shared/contracts/training-domain.js');

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

const blueprint = {
  profile: {
    name: 'Empresa de Homologação',
    niche: 'Serviços',
    tone: 'acolhedor',
    faqs: [{ question: 'Qual o horário?', answer: 'De segunda a sexta.' }]
  },
  approvedMessages: [{ title: 'Boas-vindas', text: 'Olá! Como podemos ajudar?' }],
  operationalSkills: [{ name: 'Acolhimento', when: 'Primeiro contato', bodyMd: 'Faça uma pergunta objetiva.' }],
  humanizationSkills: [{ name: 'Naturalidade', goal: 'Responder com clareza.' }]
};

async function preview(payload, filename = 'treinamento.json') {
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), filename);
  return fetch(`${base}/api/training-packs/import-preview`, { method: 'POST', body: form });
}

test('HTTP preview route authenticates local workspace and does not mutate active training', async () => {
  const before = structuredClone(store.getBusiness());
  const response = await preview(blueprint);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.preview.businessName, 'Empresa de Homologação');
  assert.equal(body.preview.counts.messages, 1);
  assert.equal(body.preview.counts.operationalSkills, 1);
  assert.equal(body.preview.counts.humanizationSkills, 1);
  assert.match(body.preview.currentFingerprint, /^[a-f0-9]{64}$/i);
  assert.deepEqual(store.getBusiness(), before, 'prévia não altera o perfil ativo');
});

test('HTTP preview route rejects only a raw training-v2 draft with 409', async () => {
  const draft = createTrainingDocument({ name: 'Rascunho não homologado', tone: 'acolhedor' });
  const response = await preview(draft, 'rascunho-v2.json');
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.error, /training-v2/);
});

test('HTTP import confirmation requires a current preview fingerprint', async () => {
  const response = await fetch(`${base}/api/training-packs/import-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'treinamento.json', content: JSON.stringify(blueprint) })
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /prévia/i);
});

test('HTTP import confirmation rejects a stale preview fingerprint without overwriting newer data', async () => {
  const previewResponse = await preview(blueprint);
  const previewBody = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  const originalName = store.getBusiness().name;
  store.getBusiness().name = 'Alteração mais recente';
  const confirm = await fetch(`${base}/api/training-packs/import-text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: 'treinamento.json',
      content: JSON.stringify(blueprint),
      expectedFingerprint: previewBody.preview.currentFingerprint
    })
  });
  assert.equal(confirm.status, 409);
  assert.equal(store.getBusiness().name, 'Alteração mais recente');
  store.getBusiness().name = originalName;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  clearInterval(whatsappManager.followUpTimer);
  if (store.saveTimer) clearTimeout(store.saveTimer);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const nativeFetch = globalThis.fetch;
process.env.EVOLUTION_API_URL = 'https://evolution.test';
process.env.EVOLUTION_API_KEY = 'global-test-key';
process.env.EVOLUTION_DEFAULT_USER_ID = 'tenant-1';
process.env.EVOLUTION_INSTANCE_USERS = '{}';
delete process.env.VERCEL;

let connectPayload = { pairingCode: null, code: '2@raw-qr-payload', base64: 'data:image/png;base64,UE5H', count: 1 };
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  requests.push({ url: href, options });
  let body = {};
  if (href.endsWith('/instance/fetchInstances')) {
    body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'close' }];
  } else if (href.includes('/webhook/set/')) {
    body = { webhook: { enabled: true } };
  } else if (href.includes('/instance/connect/')) {
    body = connectPayload;
  } else if (href.includes('/instance/connectionState/')) {
    body = { instance: { instanceName: 'zap-ia-slot_1', state: 'connecting' } };
  }
  return { ok: true, status: 201, text: async () => JSON.stringify(body) };
};
const { evolutionApiCloudRouter } = await import('../src/evolutionApiCloud.js');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.cloudAuth = { authUser: { id: 'tenant-1' } }; next(); });
app.use('/cloud', evolutionApiCloudRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

 test('pareamento por QR usa base64 para a imagem e nunca confunde `code` com `pairingCode`', async () => {
  requests.length = 0;
  connectPayload = { pairingCode: null, code: '2@raw-qr-payload', base64: 'data:image/png;base64,UE5H', count: 1 };
  const response = await nativeFetch(`${base}/cloud/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotId: 'slot_1' }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.status, 'qr_ready');
  assert.equal(result.qrDataUrl, 'data:image/png;base64,UE5H');
  assert.equal(result.pairingCode, null);
  const webhook = requests.find((r) => r.url.includes('/webhook/set/'));
  assert.ok(webhook);
  assert.deepEqual(JSON.parse(webhook.options.body), { webhook: { enabled: true, url: `${base}/api/evolution-webhook/webhook`, byEvents: false, base64: true, events: ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONTACTS_UPDATE', 'CHATS_UPDATE'] } });
});

test('pareamento por número usa apenas pairingCode e passa o número como query', async () => {
  requests.length = 0;
  connectPayload = { pairingCode: '12345678', code: '2@raw-qr-payload', base64: null, count: 1 };
  const response = await nativeFetch(`${base}/cloud/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotId: 'slot_1', pairingPhone: '55 (86) 99999-8888' }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.pairingCode, '12345678');
  assert.ok(result.qrDataUrl.startsWith('data:image/png;base64,'), 'gera uma imagem se a API devolver somente o code cru');
  assert.ok(requests.some((r) => r.url.includes('/instance/connect/zap-ia-slot_1?number=5586999998888')));
});

test.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

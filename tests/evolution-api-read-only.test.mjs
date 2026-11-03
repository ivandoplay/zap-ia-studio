import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import express from 'express';

process.env.EVOLUTION_API_URL = 'https://evolution.read-only.test';
process.env.EVOLUTION_API_KEY = 'synthetic-evolution-test-key';
process.env.EVOLUTION_DEFAULT_USER_ID = '11111111-1111-4111-8111-111111111111';
process.env.EVOLUTION_INSTANCE_USERS = '{}';
process.env.VERCEL = '1';

const calls = [];
let contactsStatus = 200;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace('https://evolution.read-only.test', '');
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ path, method: options.method || 'GET', body });
  let payload;
  if (path === '/instance/fetchInstances') {
    payload = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
  } else if (path.includes('/instance/connectionState/')) {
    payload = { instance: { state: 'open' } };
  } else if (path.includes('/chat/findContacts/')) {
    payload = [{ remoteJid: 'PERSONAL_JID@s.whatsapp.net', pushName: 'PRIVATE_CONTACT_NAME', profilePictureUrl: 'https://private.invalid/photo' }];
  } else if (path.includes('/chat/findChats/')) {
    payload = [{ remoteJid: 'PERSONAL_CHAT@s.whatsapp.net', pushName: 'PRIVATE_CHAT_NAME' }];
  } else if (path.includes('/chat/findMessages/')) {
    payload = { messages: { records: [{ key: { id: 'PRIVATE_MESSAGE_ID', fromMe: false }, messageTimestamp: 1730000000, message: { conversation: 'PRIVATE_MESSAGE_BODY' } }] } };
  } else {
    payload = { message: 'unknown endpoint' };
  }
  const status = path.includes('/chat/findContacts/') ? contactsStatus : 200;
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
};

const { getEvolutionApiReadOnlyDiagnostics, evolutionApiCloudRouter } = await import('../src/evolutionApiCloud.js');

test('diagnóstico de produção usa somente endpoints de leitura e devolve indicadores agregados', async () => {
  calls.length = 0;
  contactsStatus = 200;
  const result = await getEvolutionApiReadOnlyDiagnostics('11111111-1111-4111-8111-111111111111');
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.connectedInstanceCount, 1);
  assert.equal(result.slots[0].contacts.recordsRead, 1);
  assert.equal(result.slots[0].chats.recordsRead, 1);
  assert.equal(result.slots[0].historySample.sampleSize, 1);
  assert.equal(calls.some((call) => call.path.includes('/chat/findContacts/')), true);
  assert.equal(calls.some((call) => call.path.includes('/chat/findChats/')), true);
  assert.equal(calls.some((call) => call.path.includes('/chat/findMessages/')), true);
  assert.equal(calls.some((call) => !['GET', 'POST'].includes(call.method)), false);
  assert.equal(calls.filter((call) => call.method === 'POST').every((call) => /\/chat\/(findContacts|findChats|findMessages)\//.test(call.path)), true);
  const serialized = JSON.stringify(result);
  for (const secret of ['PERSONAL_JID', 'PERSONAL_CHAT', 'PRIVATE_CONTACT_NAME', 'PRIVATE_CHAT_NAME', 'PRIVATE_MESSAGE_ID', 'PRIVATE_MESSAGE_BODY', 'private.invalid']) {
    assert.equal(serialized.includes(secret), false, `response leaked ${secret}`);
  }
});

test('resposta HTTP 403 é classificada como falha de autenticação sem texto bruto', async () => {
  calls.length = 0;
  contactsStatus = 403;
  const result = await getEvolutionApiReadOnlyDiagnostics('11111111-1111-4111-8111-111111111111');
  assert.equal(result.ok, false);
  assert.equal(result.slots[0].contacts.errorCategory, 'authentication');
  assert.equal(result.slots[0].contacts.statusCode, 403);
  assert.equal(JSON.stringify(result).includes('unknown endpoint'), false);
});

test('rota temporária exige usuário dono, limita chamadas e não cria fluxo de escrita', async () => {
  contactsStatus = 200;
  calls.length = 0;
  const app = express();
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    req.cloudAuth = { authUser: id ? { id: String(id) } : null, isRemoteImpersonation: req.headers['x-test-impersonation'] === '1' };
    next();
  });
  app.use('/api/evolution-cloud', evolutionApiCloudRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (headers = {}) => new Promise((resolve, reject) => {
    httpGet({ hostname: '127.0.0.1', port: server.address().port, path: '/api/evolution-cloud/diagnostics/read-only', headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    }).on('error', reject);
  });
  try {
    const unauthorized = await request({ 'x-test-user': 'other-user' });
    assert.equal(unauthorized.status, 403);
    assert.equal(calls.length, 0);
    const first = await request({ 'x-test-user': '11111111-1111-4111-8111-111111111111' });
    assert.equal(first.status, 200);
    assert.equal(first.body.readOnly, true);
    assert.equal(JSON.stringify(first.body).includes('PRIVATE_MESSAGE_BODY'), false);
    const repeated = await request({ 'x-test-user': '11111111-1111-4111-8111-111111111111' });
    assert.equal(repeated.status, 429);
    assert.equal(calls.some((call) => /\/(sendText|sendMedia|updateBlockStatus|deleteMessage)/i.test(call.path)), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

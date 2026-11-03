import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EVOLUTION_API_URL = 'https://evolution.test';
process.env.EVOLUTION_API_KEY = 'global-test-key';
process.env.EVOLUTION_DEFAULT_USER_ID = 'tenant-1';
process.env.EVOLUTION_INSTANCE_USERS = '{}';

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  let body = {};
  if (String(url).endsWith('/instance/fetchInstances')) {
    body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
  } else if (String(url).includes('/instance/connectionState/')) {
    body = { instance: { instanceName: 'zap-ia-slot_1', state: 'open' } };
  } else if (String(url).includes('/chat/findMessages/')) {
    body = { messages: { records: [] } };
  } else {
    body = { key: { id: 'message-1' }, status: 'PENDING' };
  }
  return { ok: true, status: 201, text: async () => JSON.stringify(body) };
};
const { sendEvolutionApiText, requestEvolutionApiHistory } = await import('../src/evolutionApiCloud.js');

test('Evolution API v2 envia texto pela instância do tenant e usa endpoint/payload v2', async () => {
  requests.length = 0;
  const result = await sendEvolutionApiText('tenant-1', '558899999999@s.whatsapp.net', 'Olá');
  assert.deepEqual(result, { key: { id: 'message-1' }, status: 'PENDING' });
  const send = requests.find((r) => r.url.includes('/message/sendText/'));
  assert.ok(send);
  assert.equal(send.options.headers.apikey, 'global-test-key');
  assert.deepEqual(JSON.parse(send.options.body), { number: '558899999999', text: 'Olá' });
});

test('Histórico usa chat/findMessages com JID, paginação e offset limitado', async () => {
  requests.length = 0;
  await requestEvolutionApiHistory('tenant-1', '558899999999@s.whatsapp.net', 35, { id: 'wa-id-1' });
  const history = requests.find((r) => r.url.includes('/chat/findMessages/'));
  assert.ok(history);
  assert.deepEqual(JSON.parse(history.options.body), {
    where: { key: { remoteJid: '558899999999@s.whatsapp.net' } }, page: 1, offset: 35
  });
});

test('resposta HTTP 2xx com rejeição de aplicação não é tratada como envio aceito', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: false, message: 'Instância sem conexão' }) });
  await assert.rejects(() => sendEvolutionApiText('tenant-1', '558899999999@s.whatsapp.net', 'Não enviar'), /Instância sem conexão/);
});

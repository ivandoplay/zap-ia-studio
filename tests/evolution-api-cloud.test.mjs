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
const { sendEvolutionApiText, sendEvolutionApiMedia, sendEvolutionApiContact, reactEvolutionApiMessage, editEvolutionApiMessage, deleteEvolutionApiMessage, markEvolutionApiRead, requestEvolutionApiHistory } = await import('../src/evolutionApiCloud.js');

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


test('contratos auxiliares usam os payloads definidos no Evolution API v2.3.7', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = { key: { id: 'message-1' }, status: 'PENDING' };
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { instanceName: 'zap-ia-slot_1', state: 'open' } };
    return { ok: true, status: 201, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  await sendEvolutionApiMedia('tenant-1', '558899999999@s.whatsapp.net', { url: 'https://files.test/photo.png', type: 'image', caption: 'Foto', filename: 'foto.png', mimeType: 'image/png' });
  await sendEvolutionApiContact('tenant-1', '558899999999@s.whatsapp.net', { name: 'Contato', phone: '558899999999', company: 'Empresa' });
  await reactEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1', '👍', false);
  await editEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1', 'Corrigida');
  await deleteEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1');
  await markEvolutionApiRead('tenant-1', '558899999999@s.whatsapp.net', ['msg-1']);

  const bodyFor = (path) => JSON.parse(requests.find((r) => r.url.includes(path)).options.body);
  assert.deepEqual(bodyFor('/message/sendMedia/'), { number: '558899999999', mediatype: 'image', media: 'https://files.test/photo.png', caption: 'Foto', fileName: 'foto.png', mimetype: 'image/png' });
  assert.deepEqual(bodyFor('/message/sendContact/'), { number: '558899999999', contact: [{ fullName: 'Contato', wuid: '558899999999', phoneNumber: '+558899999999', organization: 'Empresa' }] });
  assert.deepEqual(bodyFor('/message/sendReaction/'), { key: { remoteJid: '558899999999@s.whatsapp.net', fromMe: false, id: 'msg-1' }, reaction: '👍' });
  assert.deepEqual(bodyFor('/chat/updateMessage/'), { number: '558899999999', key: { remoteJid: '558899999999@s.whatsapp.net', fromMe: true, id: 'msg-1' }, text: 'Corrigida' });
  assert.deepEqual(bodyFor('/chat/deleteMessageForEveryone/'), { id: 'msg-1', remoteJid: '558899999999@s.whatsapp.net', fromMe: true });
  assert.deepEqual(bodyFor('/chat/markMessageAsRead/'), { readMessages: [{ id: 'msg-1', remoteJid: '558899999999@s.whatsapp.net', fromMe: false }] });

  const callsBeforeEmptyRead = requests.length;
  assert.deepEqual(await markEvolutionApiRead('tenant-1', '558899999999@s.whatsapp.net', []), { skipped: true, reason: 'no-message-ids' });
  assert.equal(requests.length, callsBeforeEmptyRead, 'lista vazia não deve chamar a API que rejeita readMessages vazio');
});

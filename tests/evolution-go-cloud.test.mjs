import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EVOLUTION_GO_URL = 'https://evolution.test';
process.env.EVOLUTION_GO_API_KEY = 'global-test-key';
process.env.EVOLUTION_DEFAULT_USER_ID = 'tenant-1';
process.env.EVOLUTION_INSTANCE_USERS = '{}';

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url:String(url), options });
  const body = String(url).endsWith('/instance/all')
    ? { data:[{ id:'instance-1', name:'zap-ia-slot_1', token:'instance-token', connected:true }] }
    : { data:{ id:'message-1' } };
  return { ok:true, status:200, text:async () => JSON.stringify(body) };
};
const { sendEvolutionGoText, requestEvolutionGoHistory } = await import('../src/evolutionGoCloud.js');

test('Evolution Go cloud sender uses tenant-owned connected instance and canonical API payload', async () => {
  requests.length = 0;
  const result = await sendEvolutionGoText('tenant-1', '558899999999@s.whatsapp.net', 'Olá');
  assert.deepEqual(result, { data:{ id:'message-1' } });
  const send = requests.find((r) => r.url.endsWith('/send/text'));
  assert.ok(send);
  assert.equal(send.options.headers.apikey, 'instance-token');
  assert.deepEqual(JSON.parse(send.options.body), {
    number:'558899999999@s.whatsapp.net', text:'Olá', formatJid:true
  });
});

test('HistorySync sends count at top level and message anchor under messageInfo', async () => {
  requests.length = 0;
  await requestEvolutionGoHistory('tenant-1', '558899999999@s.whatsapp.net', 35, {
    id:'wa-id-1', isFromMe:false, timestamp:'2026-10-31T12:00:00.000Z'
  });
  const sync = requests.find((r) => r.url.endsWith('/chat/history-sync'));
  assert.ok(sync);
  assert.deepEqual(JSON.parse(sync.options.body), {
    count:35,
    messageInfo:{ chat:'558899999999@s.whatsapp.net', id:'wa-id-1', isFromMe:false, isGroup:false, sender:'', timestamp:'2026-10-31T12:00:00.000Z' }
  });
});

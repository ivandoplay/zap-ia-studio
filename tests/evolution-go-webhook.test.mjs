import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.EVOLUTION_GO_URL = 'https://evolution.test';
process.env.EVOLUTION_GO_API_KEY = 'global-test-key';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { evolutionGoWebhookRouter } = await import('../src/evolutionGoWebhook.js');
const app = express();
app.use('/hook', evolutionGoWebhookRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/hook`;
test.after(() => new Promise((resolve) => server.close(resolve)));

test('persists Evolution Go fromMe events instead of discarding them', async () => {
  const response = await fetch(`${base}/webhook`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({
      event:'SEND_MESSAGE', instance:'zap-ia-slot_1',
      data:{ key:{ remoteJid:'558899999999@s.whatsapp.net', id:'sent-1', fromMe:true }, message:{ conversation:'Mensagem enviada' }, messageTimestamp:1793448000 }
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, persisted:true, role:'owner' });
});

test('ingests HistorySync messages and normalizes them as history events', async () => {
  const response = await fetch(`${base}/webhook`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({
      event:'history_sync', instance:'zap-ia-slot_1',
      data:{ conversations:[{ id:'558899999999@s.whatsapp.net', messages:[{ key:{id:'old-1',remoteJid:'558899999999@s.whatsapp.net',fromMe:false}, message:{conversation:'Histórica'}, messageTimestamp:1793447000 }] }] }
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, historical:true, saved:1 });
});

test('disables unauthenticated maintenance routes', async () => {
  const response = await fetch(`${base}/clear`, { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
  assert.equal(response.status, 404);
});

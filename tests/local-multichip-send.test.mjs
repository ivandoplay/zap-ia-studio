import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { localStorageInstance as storage } from '../src/storage.js';
import { whatsappManager } from '../src/whatsappManager.js';
import { cloudWorker } from '../src/supabaseCloud.js';

// Execute somente em uma cópia isolada, sem sessões nem credenciais reais.
assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Use somente o projeto isolado de teste');
const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
assert.equal((serverSource.match(/whatsappManager\.waitUntilConnected\(7000, chatId\)/g) || []).length, 6, 'Todas as seis rotas locais devem verificar o chip correto');
assert.ok(!serverSource.includes('whatsappManager.waitUntilConnected(7000)'), 'Nenhuma rota deve verificar o chip padrão por engano');
storage.inMemory = true;
storage.data.contacts = {};
storage.data.settings.securityPin = '';
cloudWorker.getStatus = () => ({ configured: false, loggedIn: false });
cloudWorker.tryRestoreSavedLogin = async () => false;
cloudWorker.promptTerminalLoginIfInteractive = async () => {};
whatsappManager.autoRestoreIfSessionExists = async () => {};

const calls = [];
for (const slot of Object.values(whatsappManager.slots)) {
  slot.waitUntilConnected = async (timeout) => {
    calls.push(['ready', slot.slotId, timeout]);
    return slot.slotId !== 'slot_3';
  };
  slot.sendManualOwnerMessage = async (chatId, text) => {
    calls.push(['send', slot.slotId, chatId, text]);
    storage.upsertContact(chatId, { name: 'Teste isolado' }, { deferSave: true });
  };
}
// Redireciona a escuta do servidor de teste para uma porta efêmera em localhost.
let server;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (_port, _host, callback) {
  server = this;
  return originalListen.call(this, 0, '127.0.0.1', callback);
};
await import('../src/server.js');
http.Server.prototype.listen = originalListen;
if (!server.listening) await once(server, 'listening');
const port = server.address().port;
async function send(chatId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/crm/${encodeURIComponent(chatId)}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ text: 'Teste isolado sem WhatsApp' })
  });
  return { status: response.status, body: await response.json() };
}
try {
  const one = await send('111111111111@s.whatsapp.net');
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.sentRealWhatsApp, true);
  assert.deepEqual(calls.splice(0), [['ready','slot_1',7000], ['send','slot_1','111111111111@s.whatsapp.net','Teste isolado sem WhatsApp']]);

  const two = await send('slot_2::222222222222@lid');
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.deepEqual(calls.splice(0), [['ready','slot_2',7000], ['send','slot_2','slot_2::222222222222@lid','Teste isolado sem WhatsApp']]);

  const three = await send('slot_3::333333333333@lid');
  assert.equal(three.status, 503, JSON.stringify(three.body));
  assert.deepEqual(calls.splice(0), [['ready','slot_3',7000]], 'Não enviar por outro chip quando o chip da conversa estiver offline');
  console.log('OK: endpoint local com chips 1 e 2, e bloqueio seguro quando chip 3 está offline.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
  clearInterval(whatsappManager.followUpTimer);
}

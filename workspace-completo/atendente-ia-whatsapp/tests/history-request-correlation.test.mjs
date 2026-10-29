import assert from 'node:assert/strict';
import { localStorageInstance as store } from '../src/storage.js';
import { whatsappManager } from '../src/whatsappManager.js';

store.inMemory = true;
store.onMutate = null;
store.data.contacts = {};
const slot = whatsappManager.slots.slot_2;
slot.waitUntilConnected = async () => true;
const chatId='slot_2::111111111111@s.whatsapp.net';
try {
  store.appendContactMessage(chatId,{role:'user',text:'teste',waMsgId:'ancora',timestamp:'2026-01-01T00:00:00.000Z'},{historical:true,deferSave:true});
  slot.sock={fetchMessageHistory:async()=> 'pedido-correto'};
  let concluded=false;
  const p=slot.fetchOlderMessagesForChat(chatId).then(v=>{concluded=true;return v;});
  await new Promise(r=>setTimeout(r,10));
  slot.ingestHistorySyncPayload({peerDataRequestSessionId:'pedido-de-outra-conversa',syncType:6,chats:[]});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(concluded,false,'Lote de outra solicitação não pode finalizar esta busca.');
  slot.ingestHistorySyncPayload({peerDataRequestSessionId:'pedido-correto',syncType:6,chats:[],messages:[]});
  const matching=await p;
  assert.equal(matching.historyResponseReceived,true,'Lote vazio com identificador correto deve ser reconhecido.');
  assert.equal(matching.addedCount,0);
  assert.equal(slot.historySyncWaiters.size,0);

  slot.sock={fetchMessageHistory:async()=>{
    slot.ingestHistorySyncPayload({peerDataRequestSessionId:'pedido-rapido',syncType:6});
    await new Promise(r=>setTimeout(r,5));
    return 'pedido-rapido';
  }};
  const early=await slot.fetchOlderMessagesForChat(chatId);
  assert.equal(early.historyResponseReceived,true,'Resposta antes da resolução da chamada deve ser preservada.');
  assert.equal(slot.historySyncWaiters.size,0);

  slot.sock={fetchMessageHistory:async()=>{throw new Error('falha simulada');}};
  await assert.rejects(slot.fetchOlderMessagesForChat(chatId),/falha simulada/);
  assert.equal(slot.historySyncWaiters.size,0,'Falha deve remover o observador imediatamente.');
  console.log('OK: resposta de histórico correlacionada à solicitação; concorrência, lote vazio e falha.');
} finally {
  clearInterval(whatsappManager.followUpTimer);
}

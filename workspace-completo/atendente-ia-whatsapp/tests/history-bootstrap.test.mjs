import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localStorageInstance as store } from '../src/storage.js';
import { whatsappManager } from '../src/whatsappManager.js';

store.inMemory = true;
store.onMutate = null;
store.data.contacts = {};
const slot = whatsappManager.slots.slot_2;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapia-historico-'));
slot.authDir = dir;
try {
  store.upsertContact('slot_2::111111111111@s.whatsapp.net', { phone:'111111111111' }, { deferSave:true });
  assert.equal(slot.hasCompletedHistoryBootstrap(), false, 'Uma conversa nova isolada não comprova importação do histórico.');
  fs.writeFileSync(path.join(dir,'zapia_history_sync.json'), JSON.stringify({ completedAt:new Date().toISOString(), totalConversations:1 }));
  assert.equal(slot.hasCompletedHistoryBootstrap(), false, 'Marcador antigo de contagem não comprova recebimento do histórico.');

  slot.ingestHistorySyncPayload({syncType:6,chats:[{id:'222222222222@s.whatsapp.net'}]});
  assert.equal(slot.hasCompletedHistoryBootstrap(), false, 'Histórico de uma conversa não comprova o lote inicial completo.');
  slot.ingestHistorySyncPayload({syncType:3,chats:[{id:'333333333333@s.whatsapp.net'}]});
  assert.equal(slot.hasCompletedHistoryBootstrap(), true, 'Um lote de histórico inicial efetivamente recebido deve ser reconhecido.');

  slot.waitUntilConnected = async () => true;
  slot.sock = { authState:{creds:{}}, sendPeerDataOperationMessage:async()=>{} };
  const noResponse = await slot.syncAllConversationsFromPhone({waitMs:10});
  assert.equal(noResponse.historyResponseReceived, false, 'Timeout não deve ser apresentado como histórico recebido.');
  assert.equal(noResponse.waitingForHistory, true);
  let syncFinished = false;
  const promise = slot.syncAllConversationsFromPhone({waitMs:300}).then((x)=>{ syncFinished=true; return x; });
  setTimeout(()=>slot.notifyHistoryWaiters({chatsAdded:0,msgsImported:2,syncType:6,peerDataRequestSessionId:'busca-individual'}),5);
  await new Promise(r=>setTimeout(r,15));
  assert.equal(syncFinished, false, 'Resposta de conversa individual não deve concluir sincronização geral.');
  slot.notifyHistoryWaiters({chatsAdded:1,msgsImported:2,syncType:3});
  const received = await promise;
  assert.equal(received.historyResponseReceived, true);
  assert.equal(received.waitingForHistory, false);
  const ongoing = slot.syncAllConversationsFromPhone({waitMs:40});
  const duplicate = await slot.syncAllConversationsFromPhone({force:true,waitMs:40});
  assert.equal(duplicate.alreadyRunning, true, 'Mesmo um pedido manual não deve criar solicitações simultâneas do mesmo chip.');
  await ongoing;
  slot.sock.sendPeerDataOperationMessage = async () => { throw new Error('falha simulada'); };
  await assert.rejects(slot.syncAllConversationsFromPhone({waitMs:10}), /Não foi possível solicitar o histórico/);
  assert.equal(slot.syncInProgress, false, 'Falha não pode travar solicitações futuras.');

  slot.isSelfJid=(jid)=>jid==='proprio@lid';
  slot.sock.sendPeerDataOperationMessage = async (request) => {
    if (request.fullHistorySyncOnDemandRequest) {
      const id=request.fullHistorySyncOnDemandRequest.requestMetadata.requestId;
      const emit=(requestId)=>slot.recordHistoryProtocolResponse({key:{fromMe:true,remoteJid:'proprio@lid'},message:{protocolMessage:{
        type:17,peerDataOperationRequestResponseMessage:{peerDataOperationRequestType:6,
          peerDataOperationResult:[{fullHistorySyncOnDemandRequestResponse:{requestMetadata:{requestId},responseCode:4}}]}
      }}});
      setTimeout(()=>emit('outra-solicitacao'),2);
      setTimeout(()=>emit(id),8);
    }
    return 'stanza-falso';
  };
  const refused=await slot.syncAllConversationsFromPhone({waitMs:300});
  assert.equal(refused.historyRejected,true,'Recusa correlacionada não deve parecer sucesso.');
  assert.equal(refused.historyProtocolCode,4);
  assert.equal(refused.historyResponseReceived,false,'Recusa não é lote recebido.');
  assert.equal(refused.waitingForHistory,false);
  assert.equal(slot.pendingFullHistoryRequest,null);
  console.log('OK: histórico inicial por chip e distinção entre resposta recebida e espera.');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
  clearInterval(whatsappManager.followUpTimer);
}

import assert from 'node:assert/strict';
import {proto} from '@whiskeysockets/baileys';
import {whatsappManager} from '../src/whatsappManager.js';
const slot=whatsappManager.slots.slot_2;
slot.isSelfJid=(jid)=>jid==='proprio@lid';
const message={
  key:{fromMe:true,remoteJid:'proprio@lid'},
  message:{protocolMessage:{
    type:proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE,
    peerDataOperationRequestResponseMessage:{
      peerDataOperationRequestType:proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
      stanzaId:'nao-salvar',peerDataOperationResult:[{fullHistorySyncOnDemandRequestResponse:{responseCode:4,requestMetadata:{requestId:'nao-salvar'}}}]
    }
  }}
};
try {
 assert.equal(slot.recordHistoryProtocolResponse({...message,key:{fromMe:false,remoteJid:'proprio@lid'}}),false);
 assert.equal(slot.recordHistoryProtocolResponse({...message,key:{fromMe:true,remoteJid:'outro@lid'}}),false);
 assert.equal(slot.lastHistoryProtocolStatus,null);
 assert.equal(slot.recordHistoryProtocolResponse(message),true);
 assert.equal(slot.lastHistoryProtocolStatus.code,4);
 assert.equal(slot.lastHistoryProtocolStatus.name,'ERROR_REQUEST_ON_NON_SMB_PRIMARY');
 assert.equal(JSON.stringify(slot.lastHistoryProtocolStatus).includes('nao-salvar'),false);
 message.message.protocolMessage.peerDataOperationRequestResponseMessage.peerDataOperationResult[0].fullHistorySyncOnDemandRequestResponse.responseCode=0;
 assert.equal(slot.recordHistoryProtocolResponse(message),true);
 assert.equal(slot.lastHistoryProtocolStatus.name,'REQUEST_SUCCESS');
 console.log('OK: resposta de protocolo restrita à própria conta e sem conteúdo.');
}finally{clearInterval(whatsappManager.followUpTimer)}

import {resolveLegacyTarget} from '../channels/legacyBridge.js';
import {dispatchError,requireUuid} from './contracts.js';
// Adapta somente uma referência de sessão já existente. Nunca obtém slot padrão, cria socket ou lê credenciais.
export function createLegacyLocalDriver({link,executorId,engine,getWorkerIdentity,now=Date.now}={}){
 executorId=requireUuid(executorId);const target=resolveLegacyTarget(link,'manual');
 if(target.transport!=='local_worker'||typeof getWorkerIdentity!=='function'||typeof engine?.sendManualOwnerMessage!=='function'||engine.slotId!==target.legacySlotId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Sessão legada não corresponde ao vínculo local.',403);
 const identity=Object.freeze({ownerId:target.ownerId,instanceId:target.channelId,executorId,transport:'local_worker',protocolVersion:1});
 function owned(){const actor=getWorkerIdentity();if(actor?.ownerId!==identity.ownerId||actor?.executorId!==executorId||engine.slotId!==target.legacySlotId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','A conta ativa ou a sessão do executor mudou.',403);}
 function connected(){return engine.status==='connected'&&!!engine.sock;}
 owned();
 return Object.freeze({identity,
  async inspect(){owned();return {...identity,observedAt:new Date(now()).toISOString(),connected:connected(),purposes:['manual']};},
  async sendText({recipient,text,purpose,requestId}){
   owned();requireUuid(requestId);
   if(purpose!=='manual')throw dispatchError('INSTANCE_CAPABILITY_UNAVAILABLE','O adaptador legado não executa IA ou campanhas.',503);
   if(!connected())throw dispatchError('INSTANCE_OFFLINE','Sessão indisponível. Não aguardamos reconexão nem trocamos de instância.',503);
   if(typeof recipient!=='string'||!(/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/).test(recipient)||typeof text!=='string'||!text.trim()||text.length>4096||text.includes('\0'))throw dispatchError('INVALID_DISPATCH','Destinatário ou texto inválido.',400);
   const chatId=target.legacySlotId==='slot_1'?recipient:`${target.legacySlotId}::${recipient}`;
   return engine.sendManualOwnerMessage(chatId,text,true,{requireConnectedNow:true,returnDispatchReceipt:true});
  }
 });
}

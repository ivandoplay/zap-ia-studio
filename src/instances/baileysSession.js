import {randomUUID} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {generateMessageIDV2} from '@whiskeysockets/baileys/lib/Utils/generics.js';
import {dispatchError,requireUuid,parseExecutionSnapshot,parseManualDriverInput} from './contracts.js';
import {instanceJid,normalizeBaileysIngress} from './baileysEvents.js';
// Porta concreta sobre um WASocket JÁ adquirido pelo worker. Nunca chama makeWASocket/auth/connect/logout.
export async function acquireBaileysInstanceSession({ownerId,instanceId,executorId,claimId,socket,getConnectionState,getWorkerIdentity,repository,journal,autoFlush=true,onFault=()=>{},now=Date.now,timeoutMs=3000}={}){
 ownerId=requireUuid(ownerId);instanceId=requireUuid(instanceId);executorId=requireUuid(executorId);claimId=requireUuid(claimId);
 const methods=['resolve','claimSession','checkSession','renewSession','prepareMessage','ingestEvent'];
 if(methods.some(k=>typeof repository?.[k]!=='function')||typeof socket?.sendMessage!=='function'||typeof socket.ev?.on!=='function'||typeof socket.ev?.off!=='function'||typeof getConnectionState!=='function'||typeof getWorkerIdentity!=='function'||journal?.identity?.ownerId!==ownerId||journal?.identity?.instanceId!==instanceId||['append','read','ack','stats'].some(k=>typeof journal[k]!=='function')||typeof autoFlush!=='boolean'||typeof onFault!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<5||timeoutMs>30000)throw new TypeError('Socket, journal privado, portas duráveis e contexto autenticado explícitos obrigatórios.');
 const ports=Object.fromEntries(methods.map(k=>[k,repository[k].bind(repository)])),ws=socket.ws,ev=socket.ev,send=socket.sendMessage.bind(socket),selfJid=instanceJid(socket.user?.id),scope={ownerId,instanceId,executorId};
 let detached=false,closedObserved=false,inflight=false,flushing=null,scheduled=false,dbFault=false,fatal=false;
 const counts={ingressCaptured:0,ingressPersisted:0,faults:0};let lastFault=null;
 function fault(code){counts.faults++;lastFault=code;try{onFault({code,...counts});}catch{}}
 function owned(){const actor=getWorkerIdentity();if(actor?.ownerId!==ownerId||actor?.executorId!==executorId||socket.ws!==ws||socket.ev!==ev||instanceJid(socket.user?.id)!==selfJid)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Conta ou referência do socket mudou.',403);if(detached)throw dispatchError('INSTANCE_SESSION_DETACHED','Referência de sessão removida.',503);}
 const online=()=>!closedObserved&&ws?.isOpen===true&&getConnectionState()==='open';
 async function bounded(fn){let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(dispatchError('INSTANCE_SESSION_REPOSITORY_TIMEOUT','Etapa persistente não confirmada. Nenhum retry de envio foi iniciado.',503)),timeoutMs);})]);}finally{clearTimeout(timer);}}
 owned();if(!online())throw dispatchError('INSTANCE_OFFLINE','Socket não está autenticado e aberto. Nenhuma conexão foi iniciada.',503);
 const config=parseExecutionSnapshot(await bounded(()=>ports.resolve({ownerId,instanceId})),scope),a=config.assignment;owned();
 if(!a||!a.enabled||!a.executorEnabled||a.executorId!==executorId||a.executorTransport!=='local_worker')throw dispatchError('INSTANCE_SCOPE_MISMATCH','Socket sem assignment local autorizado.',403);
 let lease=await bounded(()=>ports.claimSession({...scope,claimId,assignmentRevision:a.revision,selfJid}));
 if(lease?.claimed!==true)throw dispatchError('INSTANCE_SESSION_ALREADY_CLAIMED','Sessão não adquirida exclusivamente; resposta repetida não fornece capability.',409);
 const leaseId=requireUuid(lease.leaseId),identity=Object.freeze({...scope,transport:'local_worker',protocolVersion:1,leaseId});
 function verifyLease(value){if(!value||Object.entries(scope).some(([k,v])=>value[k]!==v)||value.leaseId!==leaseId||value.selfJid!==selfJid||value.assignmentRevision!==a.revision||!['createdAt','expiresAt','serverNow'].every(k=>typeof value[k]==='string'&&Number.isFinite(Date.parse(value[k])))||Date.parse(value.expiresAt)<=Date.parse(value.serverNow))throw dispatchError('INSTANCE_SCOPE_MISMATCH','Capability persistente da sessão não confirmada.',503);return value;}
 lease=verifyLease(lease);owned();let anchorServer=Date.parse(lease.serverNow),anchorMono=performance.now();
 const capturedAt=()=>new Date(anchorServer+performance.now()-anchorMono).toISOString();
 async function inspect(){owned();if(!online()||fatal||dbFault)return {...identity,connected:false,observedAt:new Date(now()).toISOString()};lease=verifyLease(await bounded(()=>ports.checkSession({...scope,leaseId})));owned();return {...identity,connected:online()&&!fatal&&!dbFault,observedAt:new Date(now()).toISOString()};}
 async function flush({limit=1000}={}){
  owned();if(!Number.isInteger(limit)||limit<1||limit>5000)throw new TypeError('Lote de flush inválido.');if(flushing)return flushing;
  flushing=(async()=>{let processed=0;try{
   while(processed<limit){owned();const batch=journal.read(Math.min(25,limit-processed));if(!batch.length)break;
    for(const entry of batch){owned();if(entry.executorId!==executorId)throw Error('Journal de outro executor');const result=await bounded(()=>ports.ingestEvent({...scope,leaseId:entry.leaseId,eventId:entry.eventId,observedAt:entry.observedAt,event:entry.event}));owned();if(result?.persisted!==true||result.ownerId!==ownerId||result.instanceId!==instanceId||result.eventId!==entry.eventId)throw Error('Recibo de entrada inválido');journal.ack(entry.eventId);processed++;counts.ingressPersisted++;}
   }dbFault=false;return {persisted:processed,pending:journal.stats().pending};
  }catch{dbFault=true;fault('INGRESS_DATABASE_PENDING');throw dispatchError('INSTANCE_INGRESS_PENDING','Entradas continuam no journal. Não houve retry de envio.',503);}})();
  try{return await flushing;}finally{flushing=null;}
 }
 function kick(){if(!autoFlush||dbFault||detached||scheduled||flushing)return;scheduled=true;queueMicrotask(async()=>{scheduled=false;try{const result=await flush();if(result.pending>0)kick();}catch{}});}
 function capture(type,record){try{owned();const observedAt=capturedAt(),event=normalizeBaileysIngress(type,record,{observedAt});journal.append({eventId:randomUUID(),leaseId,executorId,observedAt,event});counts.ingressCaptured++;kick();}catch{fatal=true;fault('INGRESS_JOURNAL_FAILURE');}}
 const handlers={
  'messages.upsert':value=>{if(!Array.isArray(value?.messages)||!['notify','append'].includes(value.type)){fatal=true;fault('INGRESS_INVALID_BATCH');return;}for(const record of value.messages)capture(value.type,record);},
  'messages.update':values=>{if(!Array.isArray(values)){fatal=true;fault('INGRESS_INVALID_BATCH');return;}for(const record of values)capture('receipt',record);},
  'messages.delete':value=>{if(Array.isArray(value?.keys))for(const key of value.keys)capture('delete',{key});else capture('chat',{delete:value});},
  'messaging-history.set':value=>{for(const record of value?.messages||[])capture('history',record);for(const record of value?.contacts||[])capture('contact',record);for(const record of value?.chats||[])capture('chat',record);},
  'contacts.upsert':values=>{for(const record of values||[])capture('contact',record);},
  'contacts.update':values=>{for(const record of values||[])capture('contact',record);},
  'chats.upsert':values=>{for(const record of values||[])capture('chat',record);},
  'chats.update':values=>{for(const record of values||[])capture('chat',record);},
  'lid-mapping.update':value=>capture('mapping',value),
  'connection.update':value=>{if(value?.connection==='close')closedObserved=true;}
 };
 for(const [event,handler] of Object.entries(handlers)){const safe=value=>{try{handler(value);}catch{capture('chat',{invalidBatch:event,payload:value});fatal=true;fault('INGRESS_INVALID_BATCH');}};handlers[event]=safe;ev.on(event,safe);}
 return Object.freeze({identity,inspect,flush,
  async renew(){owned();if(!online()||fatal)throw dispatchError('INSTANCE_OFFLINE','Sessão desconectada ou com falha não renova lease.',503);lease=verifyLease(await bounded(()=>ports.renewSession({...scope,leaseId})));owned();anchorServer=Math.max(Date.parse(capturedAt()),Date.parse(lease.serverNow));anchorMono=performance.now();return {renewed:true,expiresAt:lease.expiresAt};},
  async withCampaignOperation(operation){
   if(typeof operation!=='function')throw new TypeError('Operação de campanha explícita obrigatória.');owned();if(inflight)throw dispatchError('INSTANCE_BUSY','Sessão já possui envio em andamento.');inflight=true;try{if(!(await inspect()).connected)throw dispatchError('INSTANCE_OFFLINE','Sessão offline.');return await operation();}finally{inflight=false;}
  },
  async sendManualText(raw){
   if(!raw||Object.keys(raw).some(k=>!['recipient','text','requestId','purpose','requireConnectedNow','returnDispatchReceipt'].includes(k))||raw.requireConnectedNow!==true||raw.returnDispatchReceipt!==true)throw dispatchError('INVALID_DISPATCH','Envio exige conexão imediata e recibo explícito.',400);
   const input=parseManualDriverInput({recipient:raw.recipient,text:raw.text,requestId:raw.requestId,purpose:raw.purpose});owned();if(inflight)throw dispatchError('INSTANCE_BUSY','Sessão já possui envio em andamento.');inflight=true;
   try{if(!(await inspect()).connected)throw dispatchError('INSTANCE_OFFLINE','Socket offline ou ingestão precisa de revisão. Nada foi enfileirado.',503);
    const providerMessageId=generateMessageIDV2(selfJid),prepared=await bounded(()=>ports.prepareMessage({...scope,leaseId,requestId:input.requestId,recipient:input.recipient,text:input.text,providerMessageId}));
    if(prepared?.claimed!==true||prepared.ownerId!==ownerId||prepared.instanceId!==instanceId||prepared.requestId!==input.requestId||prepared.providerMessageId!==providerMessageId)throw dispatchError('DISPATCH_PREPARATION_UNCONFIRMED','Intenção não adquirida exclusivamente. Nenhum envio foi solicitado.',503);
    owned();if(!online()||fatal||dbFault)throw dispatchError('INSTANCE_OFFLINE','Socket indisponível após preparação. Não aguardamos reconexão.',503);
    const result=await send(input.recipient,{text:input.text,linkPreview:false},{messageId:providerMessageId});
    if(result?.key?.id!==providerMessageId)throw dispatchError('DISPATCH_PROVIDER_UNCERTAIN','Socket não confirmou o identificador preparado. Não repetir automaticamente.',503);
    return {accepted:true,providerMessageId};
   }finally{inflight=false;}
  },
  diagnostics(){owned();return {...counts,lastFault,blocked:fatal||dbFault,journal:journal.stats()};},
  detach(){if(detached)return;const actor=getWorkerIdentity();if(actor?.ownerId!==ownerId||actor?.executorId!==executorId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Conta do worker mudou.',403);if(inflight||flushing||scheduled)throw dispatchError('INSTANCE_BUSY','Sessão possui trabalho em andamento.');for(const [event,handler] of Object.entries(handlers))ev.off(event,handler);detached=true;}
 });
}

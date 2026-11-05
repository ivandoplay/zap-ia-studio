import {createHash} from 'node:crypto';
import {dispatchError,requireUuid,parseExecutionSnapshot,parseDispatchInput} from './contracts.js';
export {dispatchError,requireUuid} from './contracts.js';

// Catálogo de referências, não de sockets. Registrar/remover não conecta ou desconecta.
export function createInstanceRuntime({ownerId,executorId,repository,timeoutMs=8000,now=Date.now}={}){
 ownerId=requireUuid(ownerId);executorId=requireUuid(executorId);
 if(!repository||['resolve','reserve','start','finish'].some(key=>typeof repository[key]!=='function'))throw new TypeError('Repositório durável completo obrigatório; não há fallback em memória.');
 if(!Number.isInteger(timeoutMs)||timeoutMs<5||timeoutMs>30000)throw new TypeError('Prazo de execução entre 5 e 30000 ms obrigatório.');
 const ports=Object.fromEntries(['resolve','reserve','start','finish'].map(key=>[key,repository[key].bind(repository)]));
 const drivers=new Map(),active=new Set();
 async function bounded(operation,code='DISPATCH_REPOSITORY_TIMEOUT'){
  let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(dispatchError(code,'A etapa não respondeu no prazo. Nenhuma repetição foi iniciada.',503)),timeoutMs);})]);}finally{clearTimeout(timer);}
 }

 function attach(driver){
  const raw=driver?.identity,instanceId=requireUuid(raw?.instanceId);
  if(raw.ownerId!==ownerId||raw.executorId!==executorId||!['local_worker','evolution_api'].includes(raw.transport)||raw.protocolVersion!==1||typeof driver.inspect!=='function'||typeof driver.sendText!=='function')throw dispatchError('INSTANCE_SCOPE_MISMATCH','Driver incompatível com conta, instância, executor ou protocolo.',403);
  if(drivers.has(instanceId)){if(drivers.get(instanceId).driver===driver)return;throw dispatchError('INSTANCE_ALREADY_ATTACHED','Já há um driver para esta instância. Não trocamos sessões silenciosamente.');}
  drivers.set(instanceId,{identity:Object.freeze({ownerId,instanceId,executorId,transport:raw.transport,protocolVersion:1}),driver,inspect:driver.inspect.bind(driver),sendText:driver.sendText.bind(driver)});
 }
 function detach(instanceId){instanceId=requireUuid(instanceId);if(active.has(instanceId))throw dispatchError('INSTANCE_BUSY','A instância possui uma operação em andamento.');return drivers.delete(instanceId);}
 function response(input,state,duplicate=false){
  return {ownerId,instanceId:input.instanceId,executorId,requestId:input.requestId,status:['reserved','started'].includes(state)?'in_progress':state,duplicate,accepted:state==='accepted',delivered:false,queued:false,canRetryAutomatically:false};
 }
 function checkReady(snapshot,input,entry){
  const c=snapshot.instance,a=snapshot.assignment;
  if(!a||!a.enabled||!a.executorEnabled)throw dispatchError('INSTANCE_NOT_ASSIGNED','Instância sem executor habilitado. Nada foi enfileirado.',503);
  if(a.executorId!==executorId||a.executorTransport!==entry.identity.transport)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Executor ou transporte diferente do solicitado.',403);
  if(c.revision!==input.policyRevision||a.revision!==input.assignmentRevision)throw dispatchError('DISPATCH_CONFLICT','Configuração mudou. Atualize antes de decidir.');
  if(input.purpose==='ai'&&!c.aiEnabled)throw dispatchError('INSTANCE_AI_DISABLED','IA desativada nesta instância.',403);
  if(input.purpose==='campaign'&&!c.campaignsEnabled)throw dispatchError('INSTANCE_CAMPAIGNS_DISABLED','Campanhas desativadas nesta instância.',403);
  if(input.purpose!=='manual')throw dispatchError('AUTOMATION_INTEGRATION_PENDING','Automação requer integração transacional dos bloqueios globais, campanha e conversa. Nenhum envio automático foi liberado.',503);
 }
 function checkInspection(info,input,entry){
  const timestamp=Date.parse(info?.observedAt),age=now()-timestamp;
  if(info?.ownerId!==ownerId||info?.instanceId!==input.instanceId||info?.executorId!==executorId||info?.transport!==entry.identity.transport||info?.protocolVersion!==1)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Identidade do executor não confirmada.',503);
  if(info.connected!==true||!Number.isFinite(age)||age< -5000||age>15000)throw dispatchError('INSTANCE_OFFLINE','Executor ou conexão sem confirmação atual. Nada foi enfileirado.',503);
  if(!Array.isArray(info.purposes)||!info.purposes.includes(input.purpose))throw dispatchError('INSTANCE_CAPABILITY_UNAVAILABLE','O driver não suporta esta finalidade. Nenhuma outra instância será usada.',503);
 }
 async function send(raw){
  const input=parseDispatchInput(raw),entry=drivers.get(input.instanceId);
  if(!entry)throw dispatchError('INSTANCE_DRIVER_UNAVAILABLE','Esta instância não tem driver registrado neste executor.',503);
  if(active.has(input.instanceId))throw dispatchError('INSTANCE_BUSY','A instância possui uma operação em andamento. Nada foi enfileirado.');
  active.add(input.instanceId);let execution=null,receipt=null;
  const scope={ownerId,instanceId:input.instanceId,executorId,requestId:input.requestId};
  try{
   const snapshot=parseExecutionSnapshot(await bounded(()=>ports.resolve({ownerId,instanceId:input.instanceId})),scope);checkReady(snapshot,input,entry);
   checkInspection(await bounded(()=>entry.inspect(),'INSTANCE_INSPECTION_TIMEOUT'),input,entry);
   const digest=createHash('sha256').update(JSON.stringify(['ienvia-dispatch-v1',ownerId,input.instanceId,executorId,input.policyRevision,input.assignmentRevision,input.purpose,input.recipient,input.text])).digest('hex');
   receipt=await bounded(()=>ports.reserve({...scope,digest,policyRevision:input.policyRevision,assignmentRevision:input.assignmentRevision,purpose:input.purpose}));
   if(!receipt||Object.entries(scope).some(([k,v])=>receipt[k]!==v)||receipt.digest!==digest||typeof receipt.claimed!=='boolean'||!['reserved','started','accepted','uncertain','not_started'].includes(receipt.state))throw dispatchError('DISPATCH_RECEIPT_UNVERIFIED','Reserva não pôde ser confirmada. Nenhum envio foi solicitado.',503);
   if(!receipt.claimed)return response(input,receipt.state,true);
   if(receipt.state!=='reserved')throw dispatchError('DISPATCH_RECEIPT_UNVERIFIED','Reserva incompatível. Nenhum envio foi solicitado.',503);
   const ticket=requireUuid(receipt.ticket),finishScope={...scope,ticket};
   try{
    // O repositório revalida política/vínculo na transação de início. Inspeção local não é autorização permanente.
    const started=await bounded(()=>ports.start(finishScope));
    if(started?.started!==true)throw dispatchError('DISPATCH_START_UNCONFIRMED','Início não confirmado.',503);
   }catch(error){
    // Se a resposta do início se perdeu, não chamamos o driver nem reutilizamos a reserva.
    try{await bounded(()=>ports.finish({...finishScope,state:'uncertain',providerMessageId:null}));}catch{}
    throw dispatchError('DISPATCH_START_UNCONFIRMED','Início não confirmado. Nenhum envio foi solicitado por este processo; não repetir automaticamente.',503);
   }
   const finish=async(state,providerMessageId=null)=>{
    try{const saved=await bounded(()=>ports.finish({...finishScope,state,providerMessageId}));if(!['accepted','uncertain'].includes(saved?.state))throw Error('Recibo inválido');return response(input,saved.state);}catch{return response(input,'uncertain');}
   };
   // Este trabalho continua sob bloqueio após timeout; jamais iniciamos outra chamada para o mesmo pedido.
   execution=Promise.resolve().then(()=>entry.sendText({recipient:input.recipient,text:input.text,requestId:input.requestId,purpose:input.purpose})).then(async result=>{
    if(result?.accepted!==true||typeof result.providerMessageId!=='string'||!result.providerMessageId||result.providerMessageId.length>128||/[\u0000-\u001f]/.test(result.providerMessageId))return finish('uncertain');
    return finish('accepted',result.providerMessageId);
   },()=>finish('uncertain')).finally(()=>active.delete(input.instanceId));
   let timer;
   try{return await Promise.race([execution,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]).then(result=>result||finish('uncertain'));}
   finally{clearTimeout(timer);}
  }finally{if(!execution)active.delete(input.instanceId);}
 }
 return {attach,detach,list:()=>[...drivers.values()].map(entry=>({...entry.identity})),send};
}

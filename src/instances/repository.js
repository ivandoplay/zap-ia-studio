import {dispatchError,requireUuid} from './contracts.js';
// Cliente privilegiado deve ser fornecido pelo worker/backend autenticado. Nunca lê .env ou cria cliente sozinho.
export function createInstanceDispatchRepository({client,ownerId,executorId}={}){
 ownerId=requireUuid(ownerId);executorId=requireUuid(executorId);
 if(typeof client?.rpc!=='function')throw new TypeError('Cliente RPC explícito obrigatório.');
 function scope(args){
  if(args?.ownerId!==ownerId||args.executorId!==undefined&&args.executorId!==executorId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Repositório pertence a outra conta ou executor.',403);
  return {p_owner:ownerId,p_instance:requireUuid(args.instanceId)};
 }
 async function rpc(name,args){
  let result;
  try{result=await client.rpc(name,args).abortSignal(AbortSignal.timeout(3000));}catch{throw dispatchError('DISPATCH_REPOSITORY_UNAVAILABLE','Não foi possível confirmar a etapa persistente. Não repetimos a operação.',503);}
  if(!result||typeof result!=='object')throw dispatchError('DISPATCH_REPOSITORY_UNAVAILABLE','Resposta persistente inválida. Não repetimos a operação.',503);
  if(result.error){const code=result.error.code;
   if(['PGRST202','42P01','42883'].includes(code))throw dispatchError('INSTANCE_EXECUTION_SETUP_REQUIRED','Execução de instâncias aguarda a migração aprovada.',503);
   if(['40001','23505'].includes(code))throw dispatchError('DISPATCH_CONFLICT','Pedido ou configuração mudou. Não repetimos a operação.');
   if(code==='0A000')throw dispatchError('AUTOMATION_INTEGRATION_PENDING','Automação aguarda integração transacional. Nada foi enviado.',503);
   if(code==='55000')throw dispatchError('INSTANCE_BUSY','Instância indisponível, ocupada ou em quarentena. Nada foi enfileirado.');
   if(code==='P0002')throw dispatchError('INSTANCE_NOT_FOUND','Instância ou reserva não encontrada nesta conta.',404);
   if(code==='42501')throw dispatchError('INSTANCE_OPERATION_FORBIDDEN','Operação não autorizada.',403);
   throw dispatchError('DISPATCH_REPOSITORY_UNAVAILABLE','Não foi possível confirmar a etapa persistente. Não repetimos a operação.',503);
  }
  return result.data;
 }
 return {
  claimSession(args){return rpc('ienvia_claim_instance_session',{...scope(args),p_executor:executorId,p_assignment_revision:args.assignmentRevision,p_claim:requireUuid(args.claimId),p_self_jid:args.selfJid});},
  checkSession(args){return rpc('ienvia_check_instance_session',{...scope(args),p_executor:executorId,p_lease:requireUuid(args.leaseId)});},
  renewSession(args){return rpc('ienvia_renew_instance_session',{...scope(args),p_executor:executorId,p_lease:requireUuid(args.leaseId)});},
  releaseSession(args){return rpc('ienvia_release_instance_session',{...scope(args),p_executor:executorId,p_lease:requireUuid(args.leaseId)});},
  prepareMessage(args){return rpc('ienvia_prepare_instance_message',{...scope(args),p_executor:executorId,p_lease:requireUuid(args.leaseId),p_request:requireUuid(args.requestId),p_peer:args.recipient,p_text:args.text,p_provider_id:args.providerMessageId});},
  ingestEvent(args){return rpc('ienvia_ingest_instance_event',{...scope(args),p_executor:executorId,p_lease:requireUuid(args.leaseId),p_event_id:requireUuid(args.eventId),p_observed_at:args.observedAt,p_event:args.event});},
  resolve:args=>rpc('ienvia_executor_snapshot',scope(args)),
  resolveEvolutionBinding:args=>rpc('ienvia_executor_evolution_binding',{...scope(args),p_executor:executorId}),
  reserve(args){return rpc('ienvia_reserve_instance_dispatch',{...scope(args),p_executor:executorId,p_request:requireUuid(args.requestId),p_digest:args.digest,p_policy_revision:args.policyRevision,p_assignment_revision:args.assignmentRevision,p_purpose:args.purpose});},
  start(args){return rpc('ienvia_start_instance_dispatch',{...scope(args),p_executor:executorId,p_request:requireUuid(args.requestId),p_ticket:requireUuid(args.ticket)});},
  finish(args){return rpc('ienvia_finish_instance_dispatch',{...scope(args),p_executor:executorId,p_request:requireUuid(args.requestId),p_ticket:requireUuid(args.ticket),p_state:args.state,p_provider_message_id:args.providerMessageId??null});}
 };
}

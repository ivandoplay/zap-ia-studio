import {dispatchError,requireUuid,parseManualDriverInput} from './contracts.js';
// Porta de sessão UUID já adquirida pelo processo autenticado. Não cria sockets/diretórios/timers.
export function createLocalSessionDriver({ownerId,instanceId,executorId,session,getWorkerIdentity,now=Date.now}={}){
 const identity=Object.freeze({ownerId:requireUuid(ownerId),instanceId:requireUuid(instanceId),executorId:requireUuid(executorId),transport:'local_worker',protocolVersion:1});
 if(typeof session?.inspect!=='function'||typeof session?.sendManualText!=='function'||typeof getWorkerIdentity!=='function')throw new TypeError('Sessão local explícita e identidade atual obrigatórias.');
 const leaseId=requireUuid(session.identity?.leaseId),inspectSession=session.inspect.bind(session),send=session.sendManualText.bind(session);
 function owned(){const actor=getWorkerIdentity(),actual=session.identity;if(actor?.ownerId!==identity.ownerId||actor?.executorId!==identity.executorId||Object.entries(identity).some(([k,v])=>actual?.[k]!==v)||actual.leaseId!==leaseId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Conta, instância ou lease da sessão mudou.',403);}
 owned();
 async function inspect(){owned();const info=await inspectSession();owned();if(Object.entries(identity).some(([k,v])=>info?.[k]!==v)||info.leaseId!==leaseId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','A sessão não confirmou sua identidade.',503);const age=now()-Date.parse(info.observedAt);return {...identity,observedAt:info.observedAt,connected:info.connected===true&&Number.isFinite(age)&&age>=-5000&&age<=15000,purposes:['manual']};}
 return Object.freeze({identity,inspect,async sendText(raw){const input=parseManualDriverInput(raw),info=await inspect();if(!info.connected)throw dispatchError('INSTANCE_OFFLINE','Sessão offline ou sem observação atual. Nada foi enfileirado.',503);owned();return send({...input,requireConnectedNow:true,returnDispatchReceipt:true});}});
}

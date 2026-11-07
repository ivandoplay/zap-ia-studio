import {isChannelId,parseChannelInput} from '../shared/contracts/channel-policy.js';
export const dispatchError=(code,message,status=409)=>Object.assign(new Error(message),{code,status,statusCode:status});
export function requireUuid(value){
 if(!isChannelId(value))throw dispatchError('INVALID_INSTANCE_ID','Identidade UUID obrigatória; nenhum chip padrão será escolhido.',400);
 return value.toLowerCase();
}
export function parseExecutionSnapshot(value,{ownerId,instanceId}){
 ownerId=requireUuid(ownerId);instanceId=requireUuid(instanceId);
 const fail=()=>{throw dispatchError('INSTANCE_SCOPE_MISMATCH','Não foi possível validar conta, instância ou executor.',503);};
 const c=value?.instance;
 if(value?.ownerId!==ownerId||c?.id!==instanceId||!Number.isSafeInteger(c?.revision)||c.revision<1||typeof c.createdAt!=='string'||!Number.isFinite(Date.parse(c.createdAt))||typeof c.updatedAt!=='string'||!Number.isFinite(Date.parse(c.updatedAt)))fail();
 let config;try{config=parseChannelInput({name:c.name,transport:c.transport,crmVisible:c.crmVisible,aiEnabled:c.aiEnabled,campaignsEnabled:c.campaignsEnabled,tags:c.tags});}catch{fail();}
 const a=value.assignment;
 if(a!==null&&(!a||a.ownerId!==ownerId||a.instanceId!==instanceId||a.executorOwnerId!==ownerId||!isChannelId(a.executorId)||a.executorId!==a.executorId.toLowerCase()||a.executorTransport!==config.transport||a.protocolVersion!==1||!Number.isSafeInteger(a.revision)||a.revision<1||typeof a.enabled!=='boolean'||typeof a.executorEnabled!=='boolean'))fail();
 return Object.freeze({ownerId,instance:Object.freeze({id:instanceId,...config,tags:Object.freeze(config.tags),revision:c.revision,createdAt:c.createdAt,updatedAt:c.updatedAt}),assignment:a===null?null:Object.freeze({ownerId,instanceId,executorOwnerId:ownerId,executorId:a.executorId,executorTransport:a.executorTransport,revision:a.revision,enabled:a.enabled,executorEnabled:a.executorEnabled,protocolVersion:1})});
}
export function parseDispatchInput(value){
 const allowed=['instanceId','requestId','policyRevision','assignmentRevision','purpose','recipient','text'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw dispatchError('INVALID_DISPATCH','Pedido de execução inválido.',400);
 const instanceId=requireUuid(value.instanceId),requestId=requireUuid(value.requestId);
 if(!Number.isSafeInteger(value.policyRevision)||value.policyRevision<1||!Number.isSafeInteger(value.assignmentRevision)||value.assignmentRevision<1||!['manual','ai','campaign'].includes(value.purpose)||typeof value.recipient!=='string'||!(/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/).test(value.recipient)||typeof value.text!=='string'||!value.text.trim()||value.text.length>4096||value.text.includes('\0'))throw dispatchError('INVALID_DISPATCH','Revisão, finalidade, destinatário ou texto inválido.',400);
 return Object.freeze({...value,instanceId,requestId});
}

// Fronteira de drivers manuais; não substitui autorização, revisões nem ledger do runtime.
export function parseManualDriverInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw dispatchError('INVALID_DISPATCH','Pedido manual inválido.',400);
 if(value?.purpose!=='manual')throw dispatchError('INSTANCE_CAPABILITY_UNAVAILABLE','Este adaptador não executa IA ou campanhas.',503);
 if(!value||Object.keys(value).some(k=>!['recipient','text','requestId','purpose'].includes(k))||typeof value.recipient!=='string'||!(/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/).test(value.recipient)||typeof value.text!=='string'||!value.text.trim()||value.text.length>4096||value.text.includes('\0'))throw dispatchError('INVALID_DISPATCH','Destinatário ou texto inválido.',400);
 return {recipient:value.recipient,text:value.text,requestId:requireUuid(value.requestId),purpose:'manual'};
}

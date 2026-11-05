import {dispatchError,requireUuid,parseManualDriverInput} from './contracts.js';
import {assertEvolutionApiAccepted,requireEvolutionMessageId} from '../evolutionApiResponse.js';
export function parseEvolutionBinding(raw,{ownerId,instanceId,executorId}){
 if(!raw||raw.ownerId!==ownerId||raw.instanceId!==instanceId||raw.executorId!==executorId||raw.transport!=='evolution_api'||!Number.isSafeInteger(raw.assignmentRevision)||raw.assignmentRevision<1||!Number.isSafeInteger(raw.bindingRevision)||raw.bindingRevision<1||typeof raw.providerName!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$/).test(raw.providerName)||typeof raw.providerId!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/).test(raw.providerId))throw dispatchError('INSTANCE_SCOPE_MISMATCH','Vínculo Evolution não confirmado.',503);
 return Object.freeze({ownerId,instanceId,executorId,transport:'evolution_api',assignmentRevision:raw.assignmentRevision,bindingRevision:raw.bindingRevision,providerNamespaceId:requireUuid(raw.providerNamespaceId),providerName:raw.providerName,providerId:raw.providerId});
}
// Perfil do serviço e mapa protegido são explícitos. Não lê .env, slots ou nomes de usuário.
export function createEvolutionInstanceDriver({ownerId,instanceId,executorId,binding,profile,getBinding,getWorkerIdentity,now=Date.now}={}){
 const identity=Object.freeze({ownerId:requireUuid(ownerId),instanceId:requireUuid(instanceId),executorId:requireUuid(executorId),transport:'evolution_api',protocolVersion:1}),pinned=parseEvolutionBinding(binding,identity);
 if(typeof getBinding!=='function'||typeof getWorkerIdentity!=='function'||typeof profile?.fetcher!=='function'||typeof profile.apiKey!=='string'||!profile.apiKey||profile.apiKey.length>4096||/[\r\n]/.test(profile.apiKey)||requireUuid(profile.namespaceId)!==pinned.providerNamespaceId)throw new TypeError('Perfil e mapa protegidos Evolution obrigatórios.');
 let url;try{url=new URL(profile.baseUrl);}catch{throw new TypeError('Origem HTTPS Evolution inválida.');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new TypeError('Perfil Evolution exige origem HTTPS sem caminho ou credenciais na URL.');
 const origin=url.origin,apiKey=profile.apiKey,fetcher=profile.fetcher;
 function owned(){const actor=getWorkerIdentity();if(actor?.ownerId!==identity.ownerId||actor?.executorId!==identity.executorId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','A conta ativa do executor mudou.',403);}
 async function current(){owned();const b=parseEvolutionBinding(await getBinding(),identity);owned();if(Object.entries(pinned).some(([k,v])=>b[k]!==v))throw dispatchError('INSTANCE_SCOPE_MISMATCH','O vínculo Evolution mudou; recadastre explicitamente a referência.',409);}
 async function request(path,method='GET',body){
  owned();const signal=AbortSignal.timeout(method==='GET'?3000:7000);try{
   const response=await fetcher(origin+path,{method,headers:{apikey:apiKey,'Content-Type':'application/json'},redirect:'error',signal,...(body?{body:JSON.stringify(body)}:{})});
   if(!response.ok)throw Error('Resposta não aceita');signal.throwIfAborted();
   if(Number(response.headers?.get('content-length'))>1048576||!response.body)throw Error('Resposta inválida/excessiva');
   const reader=response.body.getReader(),chunks=[];let size=0;
   const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>1048576)throw Error('Resposta excessiva');chunks.push(part.value);}}
   catch(error){abort();throw error;}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   return assertEvolutionApiAccepted(JSON.parse(new TextDecoder().decode(bytes)));
  }catch{throw dispatchError(method==='GET'?'INSTANCE_PROVIDER_READ_FAILED':'DISPATCH_PROVIDER_UNCERTAIN',method==='GET'?'Não foi possível verificar a instância no provedor.':'Resultado do envio não confirmado. Não repetir automaticamente.',503);}
 }
 async function inspect(){
  await current();const data=await request('/instance/fetchInstances?instanceName='+encodeURIComponent(pinned.providerName)),rows=Array.isArray(data)?data:data?.instances||data?.data||data?.response;
  if(!Array.isArray(rows))throw dispatchError('INSTANCE_SCOPE_MISMATCH','Lista do provedor não confirmada.',503);
  const candidates=rows.map(row=>row?.instance?{...row,...row.instance}:row).filter(row=>(row?.name||row?.instanceName)===pinned.providerName);
  if(candidates.length!==1||(candidates[0].id||candidates[0].instanceId)!==pinned.providerId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','ID remoto divergente ou nome ambíguo. Nenhuma outra instância será usada.',503);
  const status=await request('/instance/connectionState/'+encodeURIComponent(pinned.providerName)),state=status?.instance||status?.data?.instance||status?.data||status;
  if((state?.instanceName||state?.name)!==pinned.providerName||(state.id||state.instanceId)&&((state.id||state.instanceId)!==pinned.providerId))throw dispatchError('INSTANCE_SCOPE_MISMATCH','Estado pertence a outra instância.',503);
  await current();return {...identity,observedAt:new Date(now()).toISOString(),connected:['open','connected'].includes(state.state||state.connectionStatus),purposes:['manual']};
 }
 owned();
 return Object.freeze({identity,inspect,async sendText(raw){
  const input=parseManualDriverInput(raw),info=await inspect();if(!info.connected)throw dispatchError('INSTANCE_OFFLINE','Instância offline. Nada foi enfileirado ou reconectado.',503);owned();
  const result=await request('/message/sendText/'+encodeURIComponent(pinned.providerName),'POST',{number:input.recipient.slice(0,-'@s.whatsapp.net'.length),text:input.text});
  try{requireEvolutionMessageId(result);const id=result?.key?.id||result?.data?.key?.id||result?.data?.id||result?.id;if(typeof id!=='string'||id.length>128||/[\u0000-\u001f]/.test(id))throw Error('ID inválido');return {accepted:true,providerMessageId:id};}catch{throw dispatchError('DISPATCH_PROVIDER_UNCERTAIN','O provedor não confirmou um identificador válido. Não repetir automaticamente.',503);}
 }});
}

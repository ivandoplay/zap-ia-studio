import {isChannelId} from './channel-policy.js';
import {parseHistoryQuery,parseInstanceThreads,parseInstanceMessages} from './history-contract.js';
const invalid=()=>{throw Object.assign(Error('Não foi possível validar a consulta. Nenhum histórico alternativo foi carregado.'),{status:503});};
export function createHistoryReader({request}={}){
 if(typeof request!=='function')throw TypeError('Consulta autenticada explícita obrigatória.');
 let identity=null,context=null;const known=new Set();
 function scope(instanceId){if(!context||!isChannelId(instanceId)||!known.has(instanceId))throw Object.assign(Error('Selecione uma instância desta conta antes de consultar.'),{status:400});return {ownerId:context.tenant.id,instanceId};}
 const get=(path,signal)=>request(path,{method:'GET',signal});
 const query=({visibility='visible',after=null}={})=>{const p=parseHistoryQuery({visibility,after,limit:'20'}),q=new URLSearchParams({visibility:p.visibility,limit:'20'});if(p.after)q.set('after',p.after);return q;};
 return {
  async instances({after=null,q='',signal}={}){
   if(after!==null&&!isChannelId(after)||typeof q!=='string'||q.length>80)throw Object.assign(Error('Filtro de instâncias inválido.'),{status:400});
   const params=new URLSearchParams({limit:'20',visibility:'all',q});if(after)params.set('after',after);
   const v=await get('/api/channels?'+params,signal);if(v?.ok!==true||!isChannelId(v.viewer?.id)||!isChannelId(v.tenant?.id)||typeof v.viewer.role!=='string'||v.viewer.id!==v.tenant.id&&v.viewer.role!=='master'||!Array.isArray(v.items)||v.items.length>20||typeof v.hasMore!=='boolean'||v.hasMore&&(!isChannelId(v.nextCursor)||v.nextCursor!==v.items.at(-1)?.id)||!v.hasMore&&v.nextCursor!==null)invalid();
   const next=JSON.stringify([v.viewer.id,v.tenant.id]);if(identity&&identity!==next)throw Object.assign(Error('A conta mudou. Reabra a página; os dados anteriores foram removidos.'),{status:409,detail:{scopeChanged:true}});
   const items=v.items.map(c=>{if(!isChannelId(c?.id)||c.id!==c.id.toLowerCase()||typeof c.name!=='string'||!c.name.trim()||c.name.length>64||!['evolution_api','local_worker'].includes(c.transport)||typeof c.crmVisible!=='boolean')invalid();return {id:c.id,name:c.name,transport:c.transport,crmVisible:c.crmVisible};});if(new Set(items.map(c=>c.id)).size!==items.length)invalid();
   identity=next;context={viewer:{id:v.viewer.id,role:v.viewer.role,displayName:typeof v.viewer.displayName==='string'?v.viewer.displayName:'Operador'},tenant:{id:v.tenant.id,displayName:typeof v.tenant.displayName==='string'?v.tenant.displayName:'Minha conta'}};for(const c of items)known.add(c.id);return {...structuredClone(context),items,hasMore:v.hasMore,nextCursor:v.nextCursor};
  },
  async threads({instanceId,visibility='visible',after=null,signal}={}){const s=scope(instanceId),q=query({visibility,after}),v=await get(`/api/channels/${instanceId}/threads?${q}`,signal);if(v?.ok!==true||v.historyView!=='instance_threads')invalid();return parseInstanceThreads(v.history,s,20);},
  async messages({instanceId,threadId,visibility='visible',after=null,signal}={}){const s=scope(instanceId);if(!isChannelId(threadId))throw Object.assign(Error('Conversa UUID obrigatória.'),{status:400});const q=query({visibility,after}),v=await get(`/api/channels/${instanceId}/threads/${threadId}/messages?${q}`,signal);if(v?.ok!==true||v.historyView!=='canonical_thread')invalid();return parseInstanceMessages(v.history,{...s,threadId},20);}
 };
}

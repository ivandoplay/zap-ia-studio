// SDK isolado de cadastro/ficha. Nenhuma rota de mensagem, IA ou conexão.
import {crmUuid,parseContactsQuery,parseContactsPage,parseContactResult,parseThreadProfileResult,parseContactCreate,parseProfileMutation} from './crm-metadata-contract.js';
const invalid=()=>{throw Object.assign(Error('Não foi possível validar o cadastro. Nenhum dado alternativo foi utilizado.'),{status:503,code:'CRM_INVALID_RESPONSE'});};
export function createCrmMetadataClient({request,context}={}){
 if(typeof request!=='function')throw TypeError('Consulta autenticada obrigatória.');
 const ownerId=crmUuid(context?.tenant?.id),viewerId=crmUuid(context?.viewer?.id);
 if(ownerId!==viewerId&&context?.viewer?.role!=='master')throw Object.assign(Error('Conta não autorizada.'),{status:403});
 let mayWrite=false;
 function envelope(v,writesEnabled){
  if(v?.ok!==true||typeof v.permissions?.canEditContacts!=='boolean'||v.capabilities?.canSend!==false||v.capabilities?.canPair!==false||v.capabilities?.canAutomate!==false)invalid();
  if(v.permissions.canEditContacts&&(viewerId!==ownerId||writesEnabled!==true))invalid();
  mayWrite=v.permissions.canEditContacts===true&&viewerId===ownerId;
  return {canEditContacts:mayWrite};
 }
 const get=(path,signal)=>{mayWrite=false;return request(path,{method:'GET',signal});};
 async function mutation(path,method,body,signal,parse){
  if(!mayWrite)throw Object.assign(Error('Alterações de cadastro não estão liberadas para este acesso.'),{status:403});
  try{const v=await request(path,{method,body,signal}),result=parse(v);return {...result,...envelope(v,result.writesEnabled)};}
  catch(e){if(e?.status===503||e?.name==='AbortError'){mayWrite=false;throw Object.assign(Error('Resultado do cadastro não confirmado. Consulte novamente antes de decidir; não repetimos a alteração.'),{status:503,detail:{...e.detail,uncertain:true},code:'CRM_OUTCOME_UNKNOWN'});}throw e;}
 }
 return {
  async list({instanceId=null,visibility='visible',saved='all',q='',after=null,limit=20,signal}={}){
   const query=parseContactsQuery({limit:String(limit),visibility,saved,q,...instanceId?{instanceId}:{},...after?{after}:{}}),params=new URLSearchParams({limit:String(query.limit),visibility:query.visibility,saved,q:query.q});
   if(query.instanceId)params.set('instanceId',query.instanceId);if(query.after)params.set('after',query.after);
   const v=await get('/api/crm-v2/contacts?'+params,signal);if(v?.projection!=='saved_records_only')invalid();
   const page=parseContactsPage(v.page,{ownerId,...query});return {...page,projection:'saved_records_only',...envelope(v,page.writesEnabled)};
  },
  async contact({contactId,signal}={}){const id=crmUuid(contactId),v=await get(`/api/crm-v2/contacts/${id}`,signal),r=parseContactResult(v,{ownerId,contactId:id});return {...r,...envelope(v,r.writesEnabled)};},
  async profile({threadId,identity,signal}={}){
   const id=crmUuid(threadId),v=await get(`/api/crm-v2/threads/${id}/profile`,signal),r=parseThreadProfileResult(v,{ownerId,threadId:id});
   if(identity&&['selfJid','peerJid','identityKind'].some(k=>r.identity[k]!==identity[k]))invalid();
   return {...r,...envelope(v,r.writesEnabled)};
  },
  async create({requestId,contact,signal}={}){const body=parseContactCreate({requestId,contact});return mutation('/api/crm-v2/contacts','POST',body,signal,v=>parseContactResult(v,{ownerId,requestId:body.requestId}));},
  async updateContact({contactId,expectedRevision,patch,signal}={}){const id=crmUuid(contactId),body=parseProfileMutation({expectedRevision,patch});return mutation(`/api/crm-v2/contacts/${id}`,'PATCH',body,signal,v=>parseContactResult(v,{ownerId,contactId:id,revision:expectedRevision+1}));},
  async updateProfile({threadId,expectedRevision,patch,signal}={}){const id=crmUuid(threadId),body=parseProfileMutation({expectedRevision,patch});return mutation(`/api/crm-v2/threads/${id}/profile`,'PATCH',body,signal,v=>parseContactResult(v,{ownerId,threadId:id,revision:expectedRevision+1}));}
 };
}

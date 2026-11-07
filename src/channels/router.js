import {Router} from 'express';
import {parseExecutionSnapshot} from '../instances/contracts.js';
import {parseHistoryQuery,parseInstanceThreads,parseInstanceMessages} from '../instances/history.js';
import {parseDispatchDiagnosis,parseDispatchReview,parseReviewInput} from '../instances/reconciliation.js';
import {parseLegacyLinkSnapshot} from './legacyBridge.js';
import {isChannelId,parseChannelInput} from '../../public/v2/assets/channel-policy.js';
function dto(value,connection=null){
 if(!value||!isChannelId(value.id)||!Number.isInteger(value.revision)||value.revision<1||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(value.updatedAt)))throw Error('Invalid channel DTO');
 const config=parseChannelInput({name:value.name,transport:value.transport,crmVisible:value.crmVisible,aiEnabled:value.aiEnabled,campaignsEnabled:value.campaignsEnabled,tags:value.tags});
 return {id:value.id,...config,revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt,connection:connection||{status:'not_verified',checkedAt:null},capabilities:{canPair:false,reason:'CHANNEL_DRIVER_MIGRATION_PENDING'}};
}
// ── Status real da conexão ────────────────────────────────────────────────────
// O cadastro de canais nasceu sem driver e respondia sempre "não verificada".
// Aqui lemos o runtime de WhatsApp da própria conta (o mesmo que o painel antigo
// usa) e casamos chip ↔ slot pelo vínculo legado. Nada é conectado nem alterado:
// é leitura, com degradação explícita para "unknown" se a leitura falhar.
async function readSlotStatus(ctx){
 const client=ctx.dataClient||ctx.viewerClient;if(!client?.from)return null;
 try{
  const [rt,slots]=await Promise.all([
   client.from('zapia_wa_runtime').select('status,worker_online,worker_heartbeat_at').eq('user_id',ctx.tenant.id).maybeSingle().abortSignal(AbortSignal.timeout(2500)),
   client.from('zapia_wa_slots').select('slot_id,status,worker_online,device_id,updated_at').eq('user_id',ctx.tenant.id).limit(3).abortSignal(AbortSignal.timeout(2500))
  ]);
  if(rt?.error||slots?.error)return null;
  const bySlot=new Map();for(const row of slots?.data||[])bySlot.set(row.slot_id,{status:row.status,workerOnline:row.worker_online===true,deviceId:row.device_id||null,checkedAt:row.updated_at||null});
  return {mode:ctx.mode||null,workerOnline:rt?.data?.worker_online===true,slots:bySlot};
 }catch{return null;}
}
// Liga o canal ao slot antigo (quando há vínculo) e resume a conexão observada.
function connectionFor(channelId,link,snapshot){
 if(!snapshot)return {status:'unknown',checkedAt:null,reason:'STATUS_UNAVAILABLE'};
 const slotId=link?.legacySlotId||null;
 if(!slotId)return {status:'unlinked',checkedAt:null,legacySlotId:null};
 const row=snapshot.slots.get(slotId);
 if(!row)return {status:'disconnected',checkedAt:null,legacySlotId:slotId};
 const status=['connected','connected'].includes(row.status)?'connected':row.status;
 return {status,checkedAt:row.checkedAt,legacySlotId:slotId,workerOnline:row.workerOnline,deviceId:row.deviceId};
}
function dbError(error){
 const code=error?.code;return Object.assign(new Error(['PGRST202','42P01','42883'].includes(code)?'O cadastro de canais ainda precisa da migração aprovada. Nenhuma conexão foi criada.':code==='40001'?'Este canal mudou em outra tela. Recarregue antes de salvar.':code==='P0002'?'Canal não encontrado nesta conta.':code==='42501'?'Acesso não autorizado.':code==='22023'?'Configuração de canal inválida.':'Não foi possível confirmar o cadastro. Recarregue antes de decidir; não repetimos a operação.'),{status:code==='40001'?409:code==='P0002'?404:code==='42501'?403:code==='22023'?400:503,code:['PGRST202','42P01','42883'].includes(code)?'CHANNELS_SETUP_REQUIRED':code==='40001'?'CHANNEL_CONFLICT':'CHANNELS_UNAVAILABLE'});
}
export function createChannelsRouter({getLocalContext,allowCrmProjection=false}={}){
 const router=Router();router.use((_q,res,next)=>{res.setHeader('Cache-Control','no-store, private');next();});
 async function context(req,write=false){const ctx=req.dashboardContext||await getLocalContext?.(req);if(!ctx)throw Object.assign(Error('Entre pelo painel existente.'),{status:401});if(write&&ctx.viewer.id!==ctx.tenant.id)throw Object.assign(Error('Suporte permanece somente leitura.'),{status:403});if(!ctx.viewer.id||!ctx.viewerClient)throw Object.assign(Error('O cadastro novo exige uma conta autenticada na nuvem. Não há fallback para outra conta ou para os três chips legados.'),{status:503,code:'CHANNELS_ACCOUNT_REQUIRED'});return ctx;}
 const sendError=(res,error)=>res.status(error.status||503).json({ok:false,code:error.code||'CHANNELS_UNAVAILABLE',...error.code==='CHANNELS_CONTEXT_CHANGED'?{scopeChanged:true}:{},error:error.status?error.message:'Não foi possível validar os dados de canais. Nenhum estado de conexão foi presumido.'});
 // Resolve o vínculo legado de cada canal e o status observado do slot.
 async function decorate(ctx,items){
  const snapshot=await readSlotStatus(ctx);
  return Promise.all(items.map(async value=>{
   let link=null;
   try{
    const r=await ctx.viewerClient.rpc('ienvia_get_channel_legacy_link',{p_owner:ctx.tenant.id,p_channel:value.id}).abortSignal(AbortSignal.timeout(2500));
    if(!r.error&&r.data)link=parseLegacyLinkSnapshot(r.data,{ownerId:ctx.tenant.id,channelId:value.id});
   }catch{}
   return dto(value,connectionFor(value.id,link,snapshot));
  }));
 }
 router.get('/',async(req,res)=>{try{
  const ctx=await context(req),raw=req.query.limit??'20',after=req.query.after??null,visibility=req.query.visibility??'all',q=req.query.q??'';
  if(typeof raw!=='string'||!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50||after!==null&&!isChannelId(after)||!['all','visible','hidden'].includes(visibility)||typeof q!=='string'||q.length>80)throw Object.assign(Error('Filtros de canais inválidos.'),{status:400});
  const {data,error}=await ctx.viewerClient.rpc('ienvia_list_channels',{p_owner:ctx.tenant.id,p_limit:Number(raw),p_after:after,p_visibility:visibility,p_search:q}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  if(!data||!Array.isArray(data.items)||data.items.length>Number(raw)||typeof data.hasMore!=='boolean'||data.hasMore&&!isChannelId(data.nextCursor)||!Number.isInteger(data.total)||data.total<0||!data.summary||['total','crmVisible','crmHidden','aiEnabled','campaignsEnabled'].some(k=>!Number.isInteger(data.summary[k])||data.summary[k]<0))throw Error('Invalid channel list');
  return res.json({ok:true,schemaVersion:1,viewer:ctx.viewer,tenant:ctx.tenant,permissions:{canEdit:ctx.viewer.id===ctx.tenant.id},features:{crmProfilesRead:allowCrmProjection===true},items:await decorate(ctx,data.items),total:data.total,hasMore:data.hasMore,nextCursor:data.hasMore?data.nextCursor:null,summary:data.summary,operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.get('/:id/threads',async(req,res)=>{try{
  const ctx=await context(req);if(!isChannelId(req.params.id))throw Object.assign(Error('Instância UUID obrigatória.'),{status:400});if(req.query.crm!==undefined&&(req.query.crm!=='profiles'||Object.keys(req.query).some(k=>!['limit','after','visibility','crm'].includes(k))))throw Object.assign(Error('Filtros de histórico inválidos.'),{status:400});const projected=req.query.crm==='profiles';if(projected&&allowCrmProjection!==true)throw Object.assign(Error('Projeção de fichas ainda não liberada. O histórico anterior foi preservado.'),{status:503,code:'CRM_PROJECTION_DISABLED'});const scope={ownerId:ctx.tenant.id,instanceId:req.params.id.toLowerCase()},viewerId=ctx.viewer.id,viewerRole=ctx.viewer.role,q=parseHistoryQuery(req.query);
  const {data,error}=await ctx.viewerClient.rpc(projected?'ienvia_list_instance_threads_crm':'ienvia_list_instance_threads',{p_owner:scope.ownerId,p_instance:scope.instanceId,p_after:q.after,p_limit:q.limit,p_visibility:q.visibility}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  if(ctx.tenant.id!==scope.ownerId||ctx.viewer.id!==viewerId||ctx.viewer.role!==viewerRole||req.dashboardContext&&(req.dashboardContext.tenant.id!==scope.ownerId||req.dashboardContext.viewer.id!==viewerId||req.dashboardContext.viewer.role!==viewerRole))throw Object.assign(Error('O contexto mudou. Reabra a consulta.'),{status:409,code:'CHANNELS_CONTEXT_CHANGED'});const history=parseInstanceThreads(data,scope,q.limit);if(projected!==(history.crmProjection==='saved_profiles_by_thread_v1'))throw Error('Invalid CRM projection');
  return res.json({ok:true,history,historyView:'instance_threads',capabilities:{canSend:false,canDelete:false},operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.get('/:id/threads/:threadId/messages',async(req,res)=>{try{
  const ctx=await context(req);if(!isChannelId(req.params.id)||!isChannelId(req.params.threadId))throw Object.assign(Error('Instância e conversa UUID obrigatórias.'),{status:400});const scope={ownerId:ctx.tenant.id,instanceId:req.params.id.toLowerCase(),threadId:req.params.threadId.toLowerCase()},q=parseHistoryQuery(req.query);
  const {data,error}=await ctx.viewerClient.rpc('ienvia_read_instance_channel_thread',{p_owner:scope.ownerId,p_instance:scope.instanceId,p_thread:scope.threadId,p_after:q.after,p_limit:q.limit,p_visibility:q.visibility}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  return res.json({ok:true,history:parseInstanceMessages(data,scope,q.limit),historyView:'canonical_thread',capabilities:{canSend:false,canDelete:false},operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.get('/:id/dispatches/:requestId',async(req,res)=>{try{
  const ctx=await context(req);if(!isChannelId(req.params.id)||!isChannelId(req.params.requestId))throw Object.assign(Error('Instância e pedido UUID obrigatórios.'),{status:400});
  const scope={ownerId:ctx.tenant.id,instanceId:req.params.id.toLowerCase(),requestId:req.params.requestId.toLowerCase()};
  const {data,error}=await ctx.viewerClient.rpc('ienvia_get_instance_dispatch',{p_owner:scope.ownerId,p_instance:scope.instanceId,p_request:scope.requestId}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  return res.json({ok:true,dispatch:parseDispatchDiagnosis(data,scope),permissions:{canReview:ctx.viewer.id===ctx.tenant.id},capabilities:{canSend:false,canResend:false},operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.post('/:id/dispatches/:requestId/review',async(req,res)=>{try{
  const ctx=await context(req,true);if(!isChannelId(req.params.id)||!isChannelId(req.params.requestId))throw Object.assign(Error('Instância e pedido UUID obrigatórios.'),{status:400});
  const input=parseReviewInput(req.body),scope={ownerId:ctx.tenant.id,instanceId:req.params.id.toLowerCase(),requestId:req.params.requestId.toLowerCase()};
  const {data,error}=await ctx.viewerClient.rpc('ienvia_review_instance_dispatch',{p_instance:scope.instanceId,p_request:scope.requestId,p_expected_state:input.expectedState,p_review:input.reviewId}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  const review=parseDispatchReview(data,scope);if(review.reviewId!==input.reviewId||review.beforeState!==input.expectedState)throw Error('Revisão incompatível');
  return res.json({ok:true,review,requiresFreshDiagnosis:true,capabilities:{canSend:false,canResend:false}});
 }catch(error){return sendError(res,error);}});
 router.get('/:id/execution',async(req,res)=>{try{
  const ctx=await context(req);if(!isChannelId(req.params.id))throw Object.assign(Error('Instância UUID inválida.'),{status:400});
  const instanceId=req.params.id.toLowerCase(),{data,error}=await ctx.viewerClient.rpc('ienvia_get_instance_execution',{p_owner:ctx.tenant.id,p_instance:instanceId}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  const execution=parseExecutionSnapshot(data,{ownerId:ctx.tenant.id,instanceId});return res.json({ok:true,execution,state:!execution.assignment?'unassigned':execution.assignment.enabled&&execution.assignment.executorEnabled?'configured_not_verified':'disabled',capabilities:{canDispatch:false,canPair:false},connection:{status:'not_verified'},operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 // ── Amarrar o chip a um executor ─────────────────────────────────────────────
 // `ienvia_register_instance_executor` cria/atualiza o executor e
 // `ienvia_assign_instance_executor` liga o chip a ele com revisão (CAS). Sem isso a
 // campanha não tem por onde enviar; com isso a tela deixa de ser só leitura.
 router.post('/:id/executor',async(req,res)=>{try{
  const ctx=await context(req,true);if(!isChannelId(req.params.id))throw Object.assign(Error('Instância UUID inválida.'),{status:400});
  if(ctx.viewer.id!==ctx.tenant.id)throw Object.assign(Error('Suporte permanece somente leitura.'),{status:403});
  const b=req.body||{};
  if(Object.keys(b).some(k=>!['executorId','enabled','revision','transport','confirmo'].includes(k)))throw Object.assign(Error('Campos inválidos.'),{status:400});
  if(b.confirmo!==true)throw Object.assign(Error('Confirmação explícita obrigatória para amarrar o chip.'),{status:400});
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!UUID.test(String(b.executorId||'')))throw Object.assign(Error('Executor inválido.'),{status:400});
  if(typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.revision)||b.revision<0)throw Object.assign(Error('Estado ou revisão inválidos.'),{status:400});
  const transport=['evolution_api','local_worker'].includes(b.transport)?b.transport:'evolution_api';
  const instanceId=req.params.id.toLowerCase();
  const reg=await ctx.viewerClient.rpc('ienvia_register_instance_executor',{p_owner:ctx.tenant.id,p_executor:b.executorId,p_transport:transport,p_enabled:b.enabled}).abortSignal(AbortSignal.timeout(5000));
  if(reg.error)throw dbError(reg.error);
  const asg=await ctx.viewerClient.rpc('ienvia_assign_instance_executor',{p_instance:instanceId,p_executor:b.executorId,p_revision:b.revision,p_enabled:b.enabled}).abortSignal(AbortSignal.timeout(5000));
  if(asg.error)throw dbError(asg.error);
  const after=await ctx.viewerClient.rpc('ienvia_get_instance_execution',{p_owner:ctx.tenant.id,p_instance:instanceId}).abortSignal(AbortSignal.timeout(4000));
  if(after.error)throw dbError(after.error);
  const execution=parseExecutionSnapshot(after.data,{ownerId:ctx.tenant.id,instanceId});
  return res.json({ok:true,execution,state:!execution.assignment?'unassigned':execution.assignment.enabled&&execution.assignment.executorEnabled?'configured_not_verified':'disabled'});
 }catch(error){return sendError(res,error);}});
 router.get('/:id/legacy-link',async(req,res)=>{try{
  const ctx=await context(req);if(!isChannelId(req.params.id))throw Object.assign(Error('Canal UUID inválido.'),{status:400});
  const channelId=req.params.id.toLowerCase(),{data,error}=await ctx.viewerClient.rpc('ienvia_get_channel_legacy_link',{p_owner:ctx.tenant.id,p_channel:channelId}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  const link=parseLegacyLinkSnapshot(data,{ownerId:ctx.tenant.id,channelId});const snapshot=await readSlotStatus(ctx);return res.json({ok:true,link,connection:connectionFor(channelId,link,snapshot),operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.post('/',async(req,res)=>{try{const ctx=await context(req,true),config=parseChannelInput(req.body);const {data,error}=await ctx.viewerClient.rpc('ienvia_create_channel',{p_config:config}).abortSignal(AbortSignal.timeout(5000));if(error)throw dbError(error);return res.status(201).json({ok:true,channel:dto(data)});}catch(error){return sendError(res,error);}});
 router.patch('/:id',async(req,res)=>{try{const ctx=await context(req,true);if(!isChannelId(req.params.id)||!req.body||!Number.isInteger(req.body.expectedRevision)||req.body.expectedRevision<1||Object.keys(req.body).some(k=>!['expectedRevision','patch'].includes(k)))throw Object.assign(Error('Canal ou revisão inválidos.'),{status:400});const patch=parseChannelInput(req.body.patch,{partial:true});const {data,error}=await ctx.viewerClient.rpc('ienvia_update_channel',{p_id:req.params.id,p_revision:req.body.expectedRevision,p_patch:patch}).abortSignal(AbortSignal.timeout(5000));if(error)throw dbError(error);return res.json({ok:true,channel:dto(data)});}catch(error){return sendError(res,error);}});
 return router;
}

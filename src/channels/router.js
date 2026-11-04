import {Router} from 'express';
import {isChannelId,parseChannelInput} from '../../public/v2/assets/channel-policy.js';
function dto(value){
 if(!value||!isChannelId(value.id)||!Number.isInteger(value.revision)||value.revision<1||!Number.isFinite(Date.parse(value.createdAt))||!Number.isFinite(Date.parse(value.updatedAt)))throw Error('Invalid channel DTO');
 const config=parseChannelInput({name:value.name,transport:value.transport,crmVisible:value.crmVisible,aiEnabled:value.aiEnabled,campaignsEnabled:value.campaignsEnabled,tags:value.tags});
 return {id:value.id,...config,revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt,connection:{status:'not_verified',checkedAt:null},capabilities:{canPair:false,reason:'CHANNEL_DRIVER_MIGRATION_PENDING'}};
}
function dbError(error){
 const code=error?.code;return Object.assign(new Error(['PGRST202','42P01','42883'].includes(code)?'O cadastro de canais ainda precisa da migração aprovada. Nenhuma conexão foi criada.':code==='40001'?'Este canal mudou em outra tela. Recarregue antes de salvar.':code==='P0002'?'Canal não encontrado nesta conta.':code==='42501'?'Acesso não autorizado.':code==='22023'?'Configuração de canal inválida.':'Não foi possível confirmar o cadastro. Recarregue antes de decidir; não repetimos a operação.'),{status:code==='40001'?409:code==='P0002'?404:code==='42501'?403:code==='22023'?400:503,code:['PGRST202','42P01','42883'].includes(code)?'CHANNELS_SETUP_REQUIRED':code==='40001'?'CHANNEL_CONFLICT':'CHANNELS_UNAVAILABLE'});
}
export function createChannelsRouter({getLocalContext}={}){
 const router=Router();router.use((_q,res,next)=>{res.setHeader('Cache-Control','no-store, private');next();});
 async function context(req,write=false){const ctx=req.dashboardContext||await getLocalContext?.(req);if(!ctx)throw Object.assign(Error('Entre pelo painel existente.'),{status:401});if(write&&ctx.viewer.id!==ctx.tenant.id)throw Object.assign(Error('Suporte permanece somente leitura.'),{status:403});if(!ctx.viewer.id||!ctx.viewerClient)throw Object.assign(Error('O cadastro novo exige uma conta autenticada na nuvem. Não há fallback para outra conta ou para os três chips legados.'),{status:503,code:'CHANNELS_ACCOUNT_REQUIRED'});return ctx;}
 const sendError=(res,error)=>res.status(error.status||503).json({ok:false,code:error.code||'CHANNELS_UNAVAILABLE',error:error.status?error.message:'Não foi possível validar os dados de canais. Nenhum estado de conexão foi presumido.'});
 router.get('/',async(req,res)=>{try{
  const ctx=await context(req),raw=req.query.limit??'20',after=req.query.after??null,visibility=req.query.visibility??'all',q=req.query.q??'';
  if(typeof raw!=='string'||!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50||after!==null&&!isChannelId(after)||!['all','visible','hidden'].includes(visibility)||typeof q!=='string'||q.length>80)throw Object.assign(Error('Filtros de canais inválidos.'),{status:400});
  const {data,error}=await ctx.viewerClient.rpc('ienvia_list_channels',{p_owner:ctx.tenant.id,p_limit:Number(raw),p_after:after,p_visibility:visibility,p_search:q}).abortSignal(AbortSignal.timeout(4000));if(error)throw dbError(error);
  if(!data||!Array.isArray(data.items)||data.items.length>Number(raw)||typeof data.hasMore!=='boolean'||data.hasMore&&!isChannelId(data.nextCursor)||!Number.isInteger(data.total)||data.total<0||!data.summary||['total','crmVisible','crmHidden','aiEnabled','campaignsEnabled'].some(k=>!Number.isInteger(data.summary[k])||data.summary[k]<0))throw Error('Invalid channel list');
  return res.json({ok:true,schemaVersion:1,viewer:ctx.viewer,tenant:ctx.tenant,permissions:{canEdit:ctx.viewer.id===ctx.tenant.id},items:data.items.map(dto),total:data.total,hasMore:data.hasMore,nextCursor:data.hasMore?data.nextCursor:null,summary:data.summary,operationalMigrationPending:true});
 }catch(error){return sendError(res,error);}});
 router.post('/',async(req,res)=>{try{const ctx=await context(req,true),config=parseChannelInput(req.body);const {data,error}=await ctx.viewerClient.rpc('ienvia_create_channel',{p_config:config}).abortSignal(AbortSignal.timeout(5000));if(error)throw dbError(error);return res.status(201).json({ok:true,channel:dto(data)});}catch(error){return sendError(res,error);}});
 router.patch('/:id',async(req,res)=>{try{const ctx=await context(req,true);if(!isChannelId(req.params.id)||!req.body||!Number.isInteger(req.body.expectedRevision)||req.body.expectedRevision<1||Object.keys(req.body).some(k=>!['expectedRevision','patch'].includes(k)))throw Object.assign(Error('Canal ou revisão inválidos.'),{status:400});const patch=parseChannelInput(req.body.patch,{partial:true});const {data,error}=await ctx.viewerClient.rpc('ienvia_update_channel',{p_id:req.params.id,p_revision:req.body.expectedRevision,p_patch:patch}).abortSignal(AbortSignal.timeout(5000));if(error)throw dbError(error);return res.json({ok:true,channel:dto(data)});}catch(error){return sendError(res,error);}});
 return router;
}

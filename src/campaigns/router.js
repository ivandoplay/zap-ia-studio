// Rascunhos UUID isolados do motor legado. Nenhum dispatcher, scheduler ou envio é importado.
import {Router,json} from 'express';
import crypto from 'node:crypto';
import {createCampaignExecutionRouter} from './executionRouter.js';
import multer from 'multer';
import {isCampaignId,validateCampaignDraft,validateCampaignPlan,validateCampaignOptions} from '../shared/contracts/campaigns-contract.js';
import {createCampaignReadAdapter} from '../shared/contracts/campaigns-reader.js';
import {importarDestinatarios} from '../campanhaImportacao.js';
import {importarXlsx} from '../campanhaXlsx.js';
import {gerarVariacoesCampanha} from '../campanhaIA.js';
const fail=(status,code,message)=>Object.assign(Error(message),{status,code});
const invalid=()=>fail(400,'CAMPAIGNS_INPUT_INVALID','Confira os campos e os limites da campanha.');
const bad=()=>fail(503,'CAMPAIGNS_INVALID_RESULT','Resposta de campanhas inválida. Não presumimos uma lista vazia.');
const id=v=>{if(!isCampaignId(v))throw invalid();return v;};
const keys=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw invalid();};
function databaseError(e,write=false){const c=e?.code;if(['PGRST202','42P01','42883'].includes(c))return fail(503,'CAMPAIGNS_SETUP_REQUIRED','Os rascunhos UUID precisam da migração aprovada. O legado não foi convertido.');if(c==='55000')return fail(503,'CAMPAIGNS_WRITES_DISABLED','As alterações não foram homologadas para esta conta.');if(c==='40001')return fail(409,'CAMPAIGNS_CONFLICT','O rascunho ou este pedido mudou. Consulte novamente; não repetimos a operação.');if(c==='P0002')return fail(404,'CAMPAIGNS_NOT_FOUND','Rascunho não encontrado nesta conta.');if(c==='42501')return fail(403,'CAMPAIGNS_FORBIDDEN','Acesso não autorizado.');if(['22023','22007','22008','22003','22P02'].includes(c))return invalid();return fail(503,write?'CAMPAIGNS_OUTCOME_UNKNOWN':'CAMPAIGNS_UNAVAILABLE',write?'Não foi possível confirmar a alteração. Consulte o rascunho antes de decidir; não repita automaticamente.':'Não foi possível consultar campanhas. Nenhum dado foi inventado.');}
export function createCampaignRouter({getLocalContext,allowWrites=false,allowAccountWrites=null,allowExecution=false,allowAI=false,allowMedia=false,getAIRequester,getMediaService,storageOrigin=null,campaignRunner=null,campaignScheduler=null,cronOwnerId=null,cronSecret=null,vault=null,pinProtector=null}={}){
 let safeStorageOrigin=null;try{const u=new URL(storageOrigin);if(u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash)safeStorageOrigin=u.origin;}catch{}
 const router=Router(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024,files:1,fields:3,fieldSize:4*1024*1024,parts:4}}).single('file');
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store, private');next();});router.use(json({limit:'4mb',strict:true}));
 router.use('/execution',createCampaignExecutionRouter({getLocalContext,allowExecution:allowWrites===true&&allowExecution===true}));
 const sendError=(res,e)=>res.status(e.status||503).json({ok:false,code:e.code||'CAMPAIGNS_UNAVAILABLE',error:e.status?e.message:'Não foi possível confirmar a operação. Consulte antes de decidir; não repetimos automaticamente.'});
 async function context(req,write=false){const ctx=req.dashboardContext||await getLocalContext?.(req);if(!ctx)throw fail(401,'CAMPAIGNS_AUTH_REQUIRED','Entre pelo painel existente.');if(write&&ctx.viewer?.id!==ctx.tenant?.id)throw fail(403,'CAMPAIGNS_SUPPORT_READ_ONLY','Suporte permanece somente leitura.');if(!isCampaignId(ctx.viewer?.id)||!isCampaignId(ctx.tenant?.id)||typeof ctx.viewerClient?.rpc!=='function')throw fail(503,'CAMPAIGNS_ACCOUNT_REQUIRED','Conta autenticada indisponível. Não há fallback para outra conta.');if(write&&!(allowWrites===true&&(typeof allowAccountWrites!=='function'||allowAccountWrites(req)===true)))throw fail(503,'CAMPAIGNS_WRITES_DISABLED','As alterações continuam desativadas até a homologação e autorização da migração.');return {ctx,ownerId:ctx.tenant.id,viewerId:ctx.viewer.id};}
 async function same(req,s){const now=req.dashboardContext||await getLocalContext?.(req);if(now?.tenant?.id!==s.ownerId||now?.viewer?.id!==s.viewerId)throw fail(409,'CAMPAIGNS_CONTEXT_CHANGED','A conta mudou durante a operação. Consulte a conta original; o resultado foi descartado e não será repetido.');}
 async function rpc(req,s,name,args,write=false){let r;try{r=await s.ctx.viewerClient.rpc(name,args).abortSignal(AbortSignal.timeout(5500));}catch{throw databaseError(null,write);}if(r?.error)throw databaseError(r.error,write);await same(req,s);if(!r?.data||r.data.ownerId!==s.ownerId||typeof r.data.writesEnabled!=='boolean')throw bad();return r.data;}
 function reply(res,s,d,status=200){const writable=allowWrites===true&&s.ownerId===s.viewerId&&d.writesEnabled===true;return res.status(status).json({ok:true,...d,permissions:{canEditDrafts:writable},capabilities:{canSend:writable&&allowExecution===true&&!!campaignRunner,canAutomate:writable&&allowExecution===true&&!!campaignRunner,canControl:writable&&allowExecution===true&&!!campaignRunner,canGenerateVariations:writable&&allowAI===true&&typeof getAIRequester==='function',canUploadMedia:writable&&allowMedia===true&&typeof getMediaService==='function'&&safeStorageOrigin!==null,canSchedule:writable&&allowExecution===true&&!!campaignRunner&&typeof campaignScheduler==='function'},source:'uuid_drafts',// A execução nativa (router /execution) não depende do runner de rascunhos: são caminhos distintos.
   executionAvailable:allowExecution===true,storageOrigin:allowMedia===true?safeStorageOrigin:null});}
 const emptyQuery=req=>{if(Object.keys(req.query).length)throw invalid();};
 function jsonBody(req,allowed){emptyQuery(req);if(!req.is('application/json'))throw fail(415,'CAMPAIGNS_JSON_REQUIRED','Envie JSON.');keys(req.body,allowed);if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>4194304)throw fail(413,'CAMPAIGNS_TOO_LARGE','Requisição acima do limite.');return req.body;}
 const canonical=fn=>{try{return fn();}catch{throw invalid();}};
 async function verify(s,path,data){try{const a=createCampaignReadAdapter({ownerId:s.ownerId,request:async()=>data});await a.request(path);a.dispose();}catch{throw bad();}}
 async function writerFeatures(req,s){const d=await rpc(req,s,'ienvia_campaign_features',{p_owner:s.ownerId});if(d.writesEnabled!==true)throw databaseError({code:'55000'});return d;}
 const route=(verb,path,fn)=>router[verb](path,async(req,res)=>{try{await fn(req,res);}catch(e){sendError(res,e);}});
 route('get','/features',async(req,res)=>{emptyQuery(req);const s=await context(req),d=await rpc(req,s,'ienvia_campaign_features',{p_owner:s.ownerId});reply(res,s,d);});
 route('get','/drafts',async(req,res)=>{const s=await context(req);keys(req.query,['limit','after']);const limit=req.query.limit??'50',after=req.query.after??null;if(typeof limit!=='string'||!/^([1-9]|[1-4][0-9]|50)$/.test(limit)||after!==null&&!isCampaignId(after))throw invalid();const d=await rpc(req,s,'ienvia_campaign_list_drafts',{p_owner:s.ownerId,p_limit:Number(limit),p_after:after});if(!Array.isArray(d.items)||d.items.length>Number(limit)||typeof d.hasMore!=='boolean'||(d.hasMore?!isCampaignId(d.nextCursor):d.nextCursor!==null)||new Set(d.items.map(c=>c.campanha_id)).size!==d.items.length||d.items.some((c,i)=>c.status!=='rascunho'||(i>0&&d.items[i-1].campanha_id>=c.campanha_id)||after!==null&&c.campanha_id<=after)||d.hasMore&&d.items.at(-1)?.campanha_id!==d.nextCursor)throw bad();await verify(s,'/api/campaigns',{campanhas:d.items});reply(res,s,d);});
 route('get','/drafts/:id',async(req,res)=>{emptyQuery(req);const s=await context(req),cid=id(req.params.id),d=await rpc(req,s,'ienvia_campaign_get_draft',{p_owner:s.ownerId,p_id:cid});await verify(s,'/api/campaigns/'+cid,d);if(d.campanha.status!=='rascunho')throw bad();reply(res,s,d);});
 route('get','/drafts/:id/recipients',async(req,res)=>{const s=await context(req),cid=id(req.params.id);keys(req.query,['inicio']);const offset=req.query.inicio??'0';if(typeof offset!=='string'||! /^(0|[1-9][0-9]{0,3})$/.test(offset)||Number(offset)>9950)throw invalid();const d=await rpc(req,s,'ienvia_campaign_draft_recipients',{p_owner:s.ownerId,p_id:cid,p_offset:Number(offset)});await verify(s,`/api/campaigns/${cid}/recipients?inicio=${offset}`,d);reply(res,s,d);});
 route('post','/drafts',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['requestId','plano','opcoes','destinatarios']),cid=id(b.requestId),document=canonical(()=>validateCampaignDraft({plano:b.plano,opcoes:b.opcoes,destinatarios:b.destinatarios})),d=await rpc(req,s,'ienvia_campaign_save_draft',{p_id:cid,p_revision:0,p_document:document},true);await verify(s,'/api/campaigns',{campanhas:[d.campanha]});if(d.campanha.campanha_id!==cid||d.campanha.status!=='rascunho'||typeof d.replayed!=='boolean')throw bad();reply(res,s,d,d.replayed?200:201);});
 route('put','/drafts/:id',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['expectedRevision','plano','opcoes']),cid=id(req.params.id);if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1)throw invalid();const document=canonical(()=>({plano:validateCampaignPlan(b.plano),opcoes:validateCampaignOptions(b.opcoes)})),d=await rpc(req,s,'ienvia_campaign_save_draft',{p_id:cid,p_revision:b.expectedRevision,p_document:document},true);await verify(s,'/api/campaigns',{campanhas:[d.campanha]});if(d.campanha.campanha_id!==cid||d.campanha.revisao!==b.expectedRevision+1||d.campanha.status!=='rascunho')throw bad();reply(res,s,d);});
 route('post','/drafts/:id/recipients/:recipientId/remove',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['expectedRevision','confirmo']),cid=id(req.params.id),rid=id(req.params.recipientId);if(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1||b.confirmo!==true)throw invalid();const d=await rpc(req,s,'ienvia_campaign_remove_draft_recipient',{p_id:cid,p_revision:b.expectedRevision,p_recipient:rid,p_confirm:true},true);await verify(s,'/api/campaigns',{campanhas:[d.campanha]});if(d.campanha.campanha_id!==cid||d.campanha.revisao!==b.expectedRevision+1)throw bad();reply(res,s,d);});
 // Prévia explícita: no máximo 4 MB, nenhuma gravação e nenhum envio de mensagem.
 router.post('/import-preview',async(req,res)=>{try{emptyQuery(req);const s=await context(req,true);await writerFeatures(req,s);upload(req,res,async e=>{try{if(e)throw fail(e.code==='LIMIT_FILE_SIZE'?413:400,'CAMPAIGNS_IMPORT_INVALID','Arquivo ou formulário acima do limite.');keys(req.body,['texto','formato','separador']);let d;if(req.file){if(req.body.texto)throw invalid();const ext=req.file.originalname.split('.').at(-1).toLowerCase();if(ext==='xlsx')d=await canonicalAsync(()=>importarXlsx(req.file.buffer));else if(['csv','txt'].includes(ext))d=canonical(()=>importarDestinatarios({texto:new TextDecoder('utf-8',{fatal:true}).decode(req.file.buffer),formato:ext,separador:req.body.separador||','}));else throw invalid();}else d=canonical(()=>importarDestinatarios(req.body));await same(req,s);reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...d});}catch(err){sendError(res,err);}});}catch(e){sendError(res,e);}});
 async function canonicalAsync(fn){try{return await fn();}catch{throw invalid();}}
 route('post','/ai-variations',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['texto','quantidade','prompt']);await writerFeatures(req,s);if(allowAI!==true||typeof getAIRequester!=='function')throw fail(503,'CAMPAIGNS_AI_DISABLED','Geração de IA não homologada neste ambiente.');const caller=await getAIRequester(s,structuredClone(b));await same(req,s);if(typeof caller!=='function')throw fail(503,'CAMPAIGNS_AI_UNAVAILABLE','Configure a IA desta conta. Nenhuma chave global será usada.');const d=await canonicalAsync(()=>gerarVariacoesCampanha({...b,chamar:caller}));await same(req,s);if(d.ok!==true)throw fail(503,'CAMPAIGNS_AI_FAILED','A IA não gerou variações válidas. Tente novamente por decisão própria ou use o original.');reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...d});});
 async function readLibrary(req,s,query){let r;try{r=await query.abortSignal(AbortSignal.timeout(5000));}catch{throw databaseError(null);}if(r?.error)throw databaseError(r.error);await same(req,s);return r.data;}
 route('get','/folders',async(req,res)=>{emptyQuery(req);const s=await context(req),data=await readLibrary(req,s,s.ctx.viewerClient.from('ienvia_campanha_pastas').select('owner_id,pasta_id,nome,tipo,criada_em').eq('owner_id',s.ownerId).order('criada_em',{ascending:false}).limit(2000));await verify(s,'/api/campaigns/folders',{pastas:data});const features=await rpc(req,s,'ienvia_campaign_features',{p_owner:s.ownerId});reply(res,s,{...features,pastas:data});});
 route('get','/folders/:folderId/files',async(req,res)=>{const s=await context(req),folder=id(req.params.folderId);keys(req.query,['inicio']);const offset=req.query.inicio??'0';if(typeof offset!=='string'||! /^(0|[1-9][0-9]{0,3})$/.test(offset)||Number(offset)>9900)throw invalid();const data=await readLibrary(req,s,s.ctx.viewerClient.from('ienvia_campanha_arquivos').select('owner_id,arquivo_id,pasta_id,tipo,mime,tamanho,ordem,nome_original,excluindo').eq('owner_id',s.ownerId).eq('pasta_id',folder).order('ordem',{ascending:true}).range(Number(offset),Number(offset)+99));await verify(s,`/api/campaigns/folders/${folder}/files?inicio=${offset}`,{arquivos:data});const features=await rpc(req,s,'ienvia_campaign_features',{p_owner:s.ownerId});reply(res,s,{...features,arquivos:data});});
 route('post','/folders',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['nome','tipo']);if(typeof b.nome!=='string'||!b.nome.trim()||b.nome.length>120||/[\u0000-\u001f\u007f]/.test(b.nome)||!['audio','imagem'].includes(b.tipo))throw invalid();await writerFeatures(req,s);let r;try{r=await s.ctx.viewerClient.rpc('ienvia_criar_pasta_campanha',{p_nome:b.nome.trim(),p_tipo:b.tipo}).abortSignal(AbortSignal.timeout(5500));}catch{throw databaseError(null,true);}if(r?.error)throw databaseError(r.error,true);await same(req,s);if(!Array.isArray(r?.data)||r.data.length!==1)throw bad();await verify(s,'/api/campaigns/folders',{pastas:r.data});reply(res,s,{ownerId:s.ownerId,writesEnabled:true,pasta:r.data[0]},201);});
 // Adaptador privado reaproveita as verificações de bucket, identidade, assinatura, bytes e SHA do original.
 async function media(req,s){await writerFeatures(req,s);if(allowMedia!==true||typeof getMediaService!=='function')throw fail(503,'CAMPAIGNS_MEDIA_DISABLED','Transferência privada não homologada neste ambiente.');const m=await getMediaService(s);await same(req,s);if(!m||typeof m.iniciar!=='function'||typeof m.finalizar!=='function')throw fail(503,'CAMPAIGNS_MEDIA_UNAVAILABLE','Biblioteca privada indisponível.');return m;}
 route('post','/folders/:folderId/uploads',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['tamanho']),folderId=id(req.params.folderId);if(!Number.isSafeInteger(b.tamanho)||b.tamanho<1||b.tamanho>35*1024*1024)throw invalid();const m=await media(req,s);await same(req,s);const d=await m.iniciar({userId:s.ownerId,pastaId:folderId,tamanho:b.tamanho});await same(req,s);if(!isCampaignId(d?.arquivoId)||typeof d.signedUrl!=='string')throw bad();reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...d});});
 route('post','/folders/:folderId/uploads/:fileId/finish',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['nome']),folderId=id(req.params.folderId),fileId=id(req.params.fileId);if(typeof b.nome!=='string'||b.nome.length>500||/[\u0000-\u001f\u007f]/.test(b.nome))throw invalid();const m=await media(req,s),d=await m.finalizar({userId:s.ownerId,pastaId:folderId,arquivoId:fileId,nome:b.nome});await same(req,s);if(d?.owner_id!==s.ownerId||d.arquivo_id!==fileId||d.pasta_id!==folderId)throw bad();reply(res,s,{ownerId:s.ownerId,writesEnabled:true,arquivo:d});});
 route('post','/files/:fileId/delete',async(req,res)=>{const s=await context(req,true),b=jsonBody(req,['confirmo']),fileId=id(req.params.fileId);if(b.confirmo!==true)throw invalid();const m=await media(req,s);await m.excluir({userId:s.ownerId,arquivoId:fileId});await same(req,s);reply(res,s,{ownerId:s.ownerId,writesEnabled:true});});
 route('post','/files/:fileId/ticket',async(req,res)=>{const s=await context(req,true);jsonBody(req,[]);const fileId=id(req.params.fileId),m=await media(req,s),d=await m.ticket({userId:s.ownerId,arquivoId:fileId});await same(req,s);reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...d});});
 // ── Execução da campanha nova ────────────────────────────────────────────────
 // Fica aqui, e não no worker legado: o envio é HTTP (Evolution), então a própria
 // Vercel executa em lotes. Sem chip escolhido não envia; nada é reenviado sozinho.
 // ── Agendamento contínuo ────────────────────────────────────────────────────────
 // Liga a campanha a um relógio: a cada tick o próximo lote é reservado no banco e
 // enviado. Desligar é uma chamada; nada roda em segundo plano escondido.
 const schedulerFor=req=>{if(typeof campaignScheduler!=='function')return null;try{return campaignScheduler(req);}catch{return null;}};
 route('get','/drafts/:id/schedule',async(req,res)=>{
   const s=await context(req),cid=id(req.params.id),ag=await schedulerFor(req);
   if(!ag)throw fail(503,'CAMPAIGNS_SCHEDULE_DISABLED','Agendamento não habilitado neste ambiente.');
   const d=await ag.estado({ownerId:s.ownerId,campaignId:cid});await same(req,s);
   reply(res,s,{ownerId:s.ownerId,writesEnabled:false,...d});
 });
 route('post','/drafts/:id/schedule',async(req,res)=>{
   const s=await context(req,true),cid=id(req.params.id),b=jsonBody(req,['ativa','slotId','inicioEm']),ag=schedulerFor(req);
   if(!ag)throw fail(503,'CAMPAIGNS_SCHEDULE_DISABLED','Agendamento não habilitado neste ambiente.');
   if(typeof b.ativa!=='boolean')throw invalid();
   if(b.ativa&&(typeof b.slotId!=='string'||!/^slot_[1-9]$/.test(b.slotId)))throw invalid();
   if(b.inicioEm!==undefined&&(typeof b.inicioEm!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(b.inicioEm)||!Number.isFinite(Date.parse(b.inicioEm))))throw invalid();
   await writerFeatures(req,s);
   const d=await ag.ativar({ownerId:s.ownerId,campaignId:cid,ativa:b.ativa,slotId:b.ativa?b.slotId:null,inicioEm:b.inicioEm||null});
   await same(req,s);
   reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...d});
 });
 // Disparo do relógio. Sem segredo configurado a rota nem existe; o segredo nunca é
 // devolvido e a comparação é por tempo constante.
 route('post','/schedule/tick',async(req,res)=>{
   const configured=typeof cronSecret==='string'&&cronSecret.length>=24&&typeof cronOwnerId==='string'&&/^[0-9a-f-]{36}$/i.test(cronOwnerId);
   if(!configured)throw fail(404,'CAMPAIGNS_ROUTE_UNAVAILABLE','Operação indisponível.');
   const sent=String(req.get('x-campaign-cron')||'');
   const a=Buffer.from(sent.padEnd(64,'\0').slice(0,64)),c=Buffer.from(cronSecret.padEnd(64,'\0').slice(0,64));
   if(sent.length!==cronSecret.length||!crypto.timingSafeEqual(a,c))throw fail(401,'CAMPAIGNS_CRON_UNAUTHORIZED','Não autorizado.');
   req.campaignCron=true;
   const ag=schedulerFor(req);if(!ag)throw fail(503,'CAMPAIGNS_SCHEDULE_DISABLED','Agendamento não habilitado neste ambiente.');
   const out=await ag.tick({ownerId:cronOwnerId,limite:5});
   res.setHeader('Cache-Control','no-store');return res.json({ok:true,...out});
 });
 route('post','/drafts/:id/run',async(req,res)=>{
   if(allowExecution!==true||!campaignRunner)throw fail(503,'CAMPAIGNS_EXECUTION_DISABLED','Execução não habilitada neste ambiente.');
   const runner=typeof campaignRunner==='function'?campaignRunner(req):campaignRunner;
   if(!runner)throw fail(503,'CAMPAIGNS_EXECUTION_DISABLED','Execução exige conta autenticada na nuvem.');
   const s=await context(req,true),cid=id(req.params.id),b=jsonBody(req,['slotId','maxPerRun']);
   if(typeof b.slotId!=='string'||!/^slot_[1-9]$/.test(b.slotId))throw invalid();
   const maxPerRun=b.maxPerRun===undefined?5:b.maxPerRun;
   if(!Number.isInteger(maxPerRun)||maxPerRun<1||maxPerRun>25)throw invalid();
   const out=await runner.run({ownerId:s.ownerId,campaignId:cid,slotId:b.slotId,maxPerRun});
   await same(req,s);
   reply(res,s,{ownerId:s.ownerId,writesEnabled:true,...out});
 });
 route('get','/drafts/:id/progress',async(req,res)=>{
   const s=await context(req),cid=id(req.params.id),d=await rpc(req,s,'ienvia_campaign_get_draft',{p_owner:s.ownerId,p_id:cid});
   const doc=d.document||{};
   reply(res,s,{ownerId:s.ownerId,writesEnabled:false,status:doc.status||'rascunho',enviados:Number(doc.enviados)||0,falhas:Number(doc.falhas)||0,pendentes:Number(doc.pendentes)||0,proxima_acao_em:doc.proxima_acao_em||null,ultima_execucao:doc.ultima_execucao||null});
 });
 // Não aceita comandos de execução nem os encaminha ao legado.
 router.use((_req,res)=>res.status(404).json({ok:false,code:'CAMPAIGNS_ROUTE_UNAVAILABLE',error:'Operação indisponível. Este serviço prepara rascunhos; não executa campanhas.'}));
 router.use((e,_req,res,_next)=>sendError(res,fail(e.type==='entity.too.large'?413:400,'CAMPAIGNS_INPUT_INVALID','JSON inválido ou requisição acima do limite.')));
 return router;
}

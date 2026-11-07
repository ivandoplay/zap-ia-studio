import {randomUUID} from 'node:crypto';import {Router,json} from 'express';import {trainingUuid} from '../../public/v2/assets/training-domain.js';import {createSecuritySettings,validateSecuritySettings,validatePinUpdate,securityPreview} from '../../public/v2/assets/security-settings-domain.js';import {securitySettingsFingerprint} from './repository.js';
const fail=status=>Object.assign(Error('Operação não confirmada.'),{status}),messages={400:'Dados inválidos. Confira os campos; nada foi aplicado.',401:'Entre pelo painel existente.',403:'Conta não autorizada ou suporte somente leitura.',409:'A conta, origem ou rascunho mudou. Consulte antes de decidir; não repetimos automaticamente.',413:'Dados acima do limite.',503:'Operação não habilitada ou origem indisponível. Não houve confirmação; consulte antes de decidir.'};
export function createSecuritySettingsRouter({getLocalContext,repository,pinProtector,allowWrites=false,allowPinWrites=false,allowOwnerAlert=false,sendOwnerAlert=null,allowQueue=false,sendQueueItem=null,readApprovedMessages=()=>[],readSource=c=>{if(!c.data?.settings)throw fail(503);return {settings:c.data.settings,legacyQueueCount:Array.isArray(c.data.proactiveQueue)?c.data.proactiveQueue.length:null};}}={}){const router=Router(),inFlight=new Set();router.use((_q,r,n)=>{r.set('Cache-Control','no-store, private');n();});router.use(json({limit:'1mb',strict:true}));const keys=(v,k)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(x=>!k.includes(x)))throw fail(400);};async function scope(q,write=false){const c=q.dashboardContext||await getLocalContext?.(q);if(!c)throw fail(401);if(!trainingUuid(c.viewer?.id)||!trainingUuid(c.tenant?.id))throw fail(503);if(c.viewer.id!==c.tenant.id&&c.viewer.role!=='master')throw fail(403);if(write&&c.viewer.id!==c.tenant.id)throw fail(403);if(write&&(allowWrites!==true||!repository))throw fail(503);return {ctx:c,ownerId:c.tenant.id,viewerId:c.viewer.id,viewerRole:c.viewer.role,mode:c.mode};}async function same(q,s){const c=q.dashboardContext||await getLocalContext?.(q);if(c?.tenant?.id!==s.ownerId||c?.viewer?.id!==s.viewerId||c.mode!==s.mode||c.viewer?.role!==s.viewerRole)throw fail(409);}
 async function source(q,s){const x=await readSource(s.ctx);await same(q,s);if(!x?.settings||typeof x.settings!=='object'||Array.isArray(x.settings))throw fail(503);let settings;try{settings=createSecuritySettings(x.settings);}catch{throw fail(503);}const pinConfigured=typeof x.settings.securityPin==='string'&&!!x.settings.securityPin,legacyQueueCount=Number.isSafeInteger(x.legacyQueueCount)&&x.legacyQueueCount>=0?x.legacyQueueCount:null;return {settings,pinConfigured,legacyQueueCount,fingerprint:securitySettingsFingerprint({settings,pinConfigured})};}
 async function choices(q,s){const raw=await readApprovedMessages(s.ctx);await same(q,s);if(!Array.isArray(raw))throw fail(503);return {rows:raw.slice(0,100).map(x=>{if(typeof x.id!=='string'||x.id.length>100||typeof x.title!=='string'||x.title.length>300||typeof x.text!=='string'||x.text.length>8000)throw fail(503);return {id:x.id,title:x.title,text:x.text};}),total:raw.length};}
 function dto(s,x,r,approved){const own=s.viewerId===s.ownerId,writable=own&&(s.mode==='local_worker'||s.mode==='vercel_cloud')&&allowWrites===true&&!!repository,pin=r?.document.pin||{action:'inherit'};return {ok:true,source:'local_security_settings',ownerId:s.ownerId,revision:r?.revision||0,settings:r?.document.settings||x.settings,pin:{action:pin.action,configured:pin.action==='set'||pin.action==='inherit'&&x.pinConfigured,originalConfigured:x.pinConfigured},sourceChanged:!!r&&r.sourceFingerprint!==x.fingerprint,legacyQueue:{storedRows:x.legacyQueueCount,executionConsulted:false},approvedMessages:approved.rows,active:r?.document?.active===true,approvedTotal:approved.total,capabilities:{writable,canWritePin:writable&&allowPinWrites===true&&!!pinProtector, canActivate:writable,
 canOperateQueue:own&&allowQueue===true&&typeof sendQueueItem==='function',canSendOwnerAlert:own&&allowOwnerAlert===true&&typeof sendOwnerAlert==='function'},updatedAt:r?.updatedAt||null};}
 function command(b){if(!trainingUuid(b.requestId)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw fail(400);}const digest=(s,v)=>pinProtector?pinProtector.intentDigest(v,s.ownerId):securitySettingsFingerprint(v);async function locked(s,fn){if(inFlight.has(s.ownerId))throw fail(409);inFlight.add(s.ownerId);try{return await fn();}finally{inFlight.delete(s.ownerId);}}
 const route=(method,p,fn)=>router[method](p,async(q,r)=>{try{keys(q.query,[]);await fn(q,r);}catch(e){const status=[400,401,403,409,413,503].includes(e.status)?e.status:400;r.status(status).json({ok:false,error:messages[status]});}});
 route('get','/',async(q,r)=>{const s=await scope(q),x=await source(q,s),record=await repository?.read(s.ownerId),approved=await choices(q,s);await same(q,s);r.json(dto(s,x,record,approved));});
 route('put','/draft',async(q,r)=>{const s=await scope(q,true);await locked(s,async()=>{keys(q.body,['expectedRevision','requestId','settings','pin']);const b=q.body;command(b);const settings=validateSecuritySettings(b.settings),pinUpdate=validatePinUpdate(b.pin);if(pinUpdate.action!=='keep'&&(allowPinWrites!==true||!pinProtector))throw fail(503);const x=await source(q,s),intentDigest=digest(s,{kind:'save',expectedRevision:b.expectedRevision,settings,pin:pinUpdate}),current=await repository.read(s.ownerId),approved=await choices(q,s);if(current?.lastRequestId===b.requestId){if(current.lastDigest!==intentDigest)throw fail(409);return r.json(dto(s,x,current,approved));}if((current?.revision||0)!==b.expectedRevision||current&&current.sourceFingerprint!==x.fingerprint)throw fail(409);let pin=current?.document.pin||{action:'inherit'};if(['clear','inherit'].includes(pinUpdate.action))pin={action:pinUpdate.action};else if(pinUpdate.action==='set')pin={action:'set',verifier:await pinProtector.seal(pinUpdate.value,s.ownerId)};await same(q,s);const now=await source(q,s);if(now.fingerprint!==x.fingerprint)throw fail(409);const record=await repository.save({ownerId:s.ownerId,expectedRevision:b.expectedRevision,requestId:b.requestId,sourceFingerprint:x.fingerprint,intentDigest,document:{schema:'ienvia-security-settings-draft-v1',settings,pin}});await same(q,s);r.json(dto(s,await source(q,s),record,approved));});});
 // Ativar/desativar: grava a versão APROVADA como ativa. Quem consome é o atendimento
 // (webhook da nuvem aplica por cima das settings vivas). Sem `confirmo`, nada muda.
 route('post','/activate',async(q,r)=>{const s=await scope(q,true);keys(q.body,['active','confirmo','expectedRevision']);const b=q.body;if(b.confirmo!==true)throw Object.assign(Error('Confirmação explícita obrigatória.'),{status:400});if(typeof b.active!=='boolean')throw Object.assign(Error('Informe ativo ou inativo.'),{status:400});await locked(s,async()=>{const x=await source(q,s),current=await repository.read(s.ownerId),approved=await choices(q,s);if(!current||typeof current.document!=='object')throw Object.assign(Error('Salve o rascunho antes de ativar.'),{status:409});if(Number.isSafeInteger(b.expectedRevision)&&b.expectedRevision!==current.revision)throw fail(409);await same(q,s);const record=await repository.save({ownerId:s.ownerId,expectedRevision:current.revision,requestId:randomUUID(),sourceFingerprint:x.fingerprint,intentDigest:digest(s,{kind:'activate',active:b.active,revision:current.revision}),document:{...current.document,active:b.active,activatedAt:b.active?new Date().toISOString():current.document.activatedAt||null}});await same(q,s);r.json(dto(s,await source(q,s),record,approved));});});
 route('post','/reset',async(q,r)=>{const s=await scope(q,true);await locked(s,async()=>{keys(q.body,['expectedRevision','requestId']);const b=q.body;command(b);const x=await source(q,s),approved=await choices(q,s),document={schema:'ienvia-security-settings-draft-v1',settings:x.settings,pin:{action:'inherit'}};await same(q,s);const record=await repository.save({ownerId:s.ownerId,expectedRevision:b.expectedRevision,requestId:b.requestId,sourceFingerprint:x.fingerprint,intentDigest:digest(s,{kind:'reset',expectedRevision:b.expectedRevision}),document});await same(q,s);r.json(dto(s,await source(q,s),record,approved));});});
 route('post','/validate',async(q,r)=>{const s=await scope(q);keys(q.body,['settings','leads','text']);await source(q,s);const preview=securityPreview(q.body.settings,{leads:q.body.leads??'',text:q.body.text??''});await same(q,s);r.json({ok:true,ownerId:s.ownerId,...preview});});
 // Alerta ao dono: MESMO caminho do painel antigo (`POST /api/wa/test-owner-alert`),
 // que envia pelo chip conectado. Aqui exige telefone próprio salvo no rascunho e
 // confirmação explícita — é mensagem real para um número real.
 route('post','/test-owner-alert',async(q,r)=>{
  if(allowOwnerAlert!==true||typeof sendOwnerAlert!=='function')throw fail(503);
  const s=await scope(q);keys(q.body,['phone','confirmo']);
  const doRascunho=String(q.body?.phone||'').replace(/\D/g,'');
  const x=await source(q,s),record=await repository?.read(s.ownerId);
  const salvo=String(((record?.document?.settings||x.settings||{}).humanHandoff||{}).ownerPersonalWhatsapp||'').replace(/\D/g,'');
  const phone=doRascunho||salvo;
  if(!/^[1-9][0-9]{9,14}$/.test(phone))throw Object.assign(Error('Informe o WhatsApp pessoal com DDI e DDD antes do teste.'),{status:400});
  if(q.body?.confirmo!==true)throw Object.assign(Error('O teste envia mensagem real; confirme antes de enviar.'),{status:400});
  await same(q,s);
  let out;
  try{ out=await sendOwnerAlert({ownerId:s.ownerId,phone}); }
  catch(e){ r.status(400).json({ok:false,error:'O envio de teste não foi confirmado pelo provedor.',detail:String(e?.message||'').slice(0,200)}); return; }
  await same(q,s);
  const id=String(out?.messageId||out?.id||'');
  if(!id)throw fail(503);
  r.json({ok:true,ownerId:s.ownerId,kind:'owner_alert_test',sent:true,phone:'+'+phone,providerMessageId:id,at:new Date().toISOString()});
 });
 // ── fila de abordagem ────────────────────────────────────────────────────────────
 // O motor antigo (whatsappManager.enqueueProactiveBatch) era um laço de processo com socket
 // e setTimeout — não existe na Vercel. Aqui a fila é durável no banco e o envio usa o MESMO
 // caminho de campanha (sendEvolutionApiText). Um motor local futuro lê a mesma tabela.
 const rpcQueue = async (s, nome, args) => {
   const { data, error } = await s.ctx.viewerClient.rpc(nome, args).abortSignal(AbortSignal.timeout(8000));
   if (error) {
     const status = error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 503;
     throw Object.assign(Error('Fila não confirmada.'), { status });
   }
   if (!data || data.ownerId !== s.ownerId) throw fail(503);
   return data;
 };
 const filaAtiva = () => allowQueue === true && typeof sendQueueItem === 'function';
 // Toda escrita na fila exige confirmação explícita no corpo — o mesmo padrão do alerta ao dono.
 // Sem "confirmo", nenhuma RPC é chamada e nada muda no banco.
 const confirmado = (q) => { if (q.body?.confirmo !== true) throw Object.assign(Error('Confirmação explícita obrigatória.'), { status: 400 }); };
 route('get','/queue',async(q,r)=>{
   // Sem fila habilitada a rota nem consulta o banco: devolve indisponível e nada é presumido.
   if(!filaAtiva()){r.json({ok:true,kind:'abordagem_queue',available:false,estado:null});return;}
   const s=await scope(q);
   const estado=await rpcQueue(s,'ienvia_abordagem_estado',{p_owner:s.ownerId});
   r.json({ok:true,ownerId:s.ownerId,kind:'abordagem_queue',available:true,estado:{total:estado.total,pendentes:estado.pendentes,reservados:estado.reservados,enviados:estado.enviados,falhas:estado.falhas,pausada:estado.pausada}});
 });
 // Iniciar: enfileira a lista e envia UM item por chamada (o painel repete enquanto houver
 // pendente). Assim nada fica preso se a função da Vercel morrer no meio.
 route('post','/queue/start',async(q,r)=>{
   if(!filaAtiva())throw fail(503);
   const s=await scope(q);keys(q.body,['leads','text','slotId','confirmo']);confirmado(q);
   const leads=Array.isArray(q.body?.leads)?q.body.leads:[];
   const texto=String(q.body?.text||'').trim();
   const slotId=String(q.body?.slotId||'');
   if(!leads.length||!texto)throw Object.assign(Error('Informe a lista e o texto aprovado.'),{status:400});
   if(!/^slot_[1-9]$/.test(slotId))throw Object.assign(Error('Escolha o chip que vai enviar.'),{status:400});
   const telefones=leads.map(x=>String(x?.phone||x||'').replace(/\D/g,'')).filter(Boolean);
   if(!telefones.length)throw Object.assign(Error('Nenhum telefone válido na lista.'),{status:400});
   await same(q,s);
   const add=await rpcQueue(s,'ienvia_abordagem_enfileirar',{p_owner:s.ownerId,p_telefones:telefones,p_texto:texto,p_nome:''});
   await rpcQueue(s,'ienvia_abordagem_pausar',{p_owner:s.ownerId,p_pausada:false});
   // Um item por chamada: reserva → envia pelo mesmo caminho de campanha → conclui.
   let enviados=0,falhas=0,resultados=[];
   for(let i=0;i<3;i++){
     const reserva=await rpcQueue(s,'ienvia_abordagem_reservar',{p_owner:s.ownerId});
     if(!reserva.item)break;
     const item=reserva.item;
     try{
       const envio=await sendQueueItem({ownerId:s.ownerId,slotId,phone:item.telefone,text:item.texto,nome:item.nome});
       const id=String(envio?.messageId||'');
       if(!id)throw Object.assign(Error('sem id'),{code:'QUEUE_UNCONFIRMED'});
       await rpcQueue(s,'ienvia_abordagem_concluir',{p_owner:s.ownerId,p_item:item.itemId,p_ok:true,p_msg:id});
       enviados+=1;resultados.push({phone:item.telefone,status:'sent',providerMessageId:id});
     }catch(e){
       const code=String(e?.code||'send_failed');
       // Falha ANTES de sair (contrato) devolve o item; falha de provedor marca e segue.
       if(code==='QUEUE_UNCONFIRMED'||code==='QUEUE_NOT_CONNECTED'){await rpcQueue(s,'ienvia_abordagem_devolver',{p_owner:s.ownerId,p_item:item.itemId,p_motivo:code}).catch(()=>{});}
       else{await rpcQueue(s,'ienvia_abordagem_concluir',{p_owner:s.ownerId,p_item:item.itemId,p_ok:false,p_motivo:code}).catch(()=>{});}
       falhas+=1;resultados.push({phone:item.telefone,status:'failed',code});
       break;
     }
   }
   const estado=await rpcQueue(s,'ienvia_abordagem_estado',{p_owner:s.ownerId});
   r.json({ok:true,ownerId:s.ownerId,kind:'abordagem_queue',available:true,adicionados:add.adicionados,executados:enviados,falhas,resultados,estado:{total:estado.total,pendentes:estado.pendentes,reservados:estado.reservados,enviados:estado.enviados,falhas:estado.falhas,pausada:estado.pausada}});
 });
 route('post','/queue/pause',async(q,r)=>{
   if(!filaAtiva())throw fail(503);
   const s=await scope(q);keys(q.body,['paused','confirmo']);confirmado(q);
   const d=await rpcQueue(s,'ienvia_abordagem_pausar',{p_owner:s.ownerId,p_pausada:q.body?.paused!==false});
   r.json({ok:true,ownerId:s.ownerId,kind:'abordagem_queue',pausada:d.pausada});
 });
 route('post','/queue/clear',async(q,r)=>{
   if(!filaAtiva())throw fail(503);
   const s=await scope(q);keys(q.body,['confirmo']);confirmado(q);
   const d=await rpcQueue(s,'ienvia_abordagem_limpar',{p_owner:s.ownerId});
   r.json({ok:true,ownerId:s.ownerId,kind:'abordagem_queue',removidos:d.removidos});
 });router.use((e,_q,r,_n)=>r.status(e.type==='entity.too.large'?413:400).json({ok:false,error:messages[e.type==='entity.too.large'?413:400]}));return router;
}

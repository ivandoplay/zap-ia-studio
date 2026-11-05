import {Router} from 'express';
import {composeConnectionState,publicConnectionSummary} from './connections.js';
import {assertSummary,localSummary} from './model.js';
export function createDashboardRouter({readEvolution,buildRuntime,getLocalContext}={}) {
 const router=Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 async function context(req) {return req.dashboardContext||await getLocalContext?.(req);}
 const unavailable=res=>res.status(503).json({ok:false,error:'Não foi possível atualizar. Os dados não foram substituídos por zero.',code:'DASHBOARD_UNAVAILABLE'});
 router.get('/summary',async(req,res)=>{
  try {
   const ctx=await context(req);if(!ctx)return res.status(401).json({ok:false,authRequired:true,error:'Entre na sua conta.'});
   const now=Date.now();let data,runtime,provider={},providerFailed=false,warnings=[];
   if(ctx.mode==='vercel_cloud') {
    const safe=promise=>promise.then(value=>({value})).catch(()=>({failed:true}));
    const client=ctx.dataClient;
    const runtimeTask=safe(Promise.all([
     client.from('zapia_wa_runtime').select('status,worker_online,worker_heartbeat_at,worker_platform').eq('user_id',ctx.tenant.id).maybeSingle().abortSignal(AbortSignal.timeout(3000)),
     client.from('zapia_wa_slots').select('slot_id,status,worker_online,worker_heartbeat_at,device_id').eq('user_id',ctx.tenant.id).limit(3).abortSignal(AbortSignal.timeout(3000)),
     client.from('zapia_worker_devices').select('device_id,platform,version,heartbeat_at,online,active_slots').eq('user_id',ctx.tenant.id).order('heartbeat_at',{ascending:false}).limit(20).abortSignal(AbortSignal.timeout(3000))
    ]).then(([rt,slots,devices])=>{
     if([rt,slots,devices].some(r=>r.error))throw new Error('runtime_unavailable');
     return buildRuntime({rtRow:rt.data,slotRows:slots.data||[],deviceRows:devices.data||[],settings:{botEnabled:false},maxWaSlots:ctx.tenant.maxWaSlots});
    }));
    const providerTask=safe(readEvolution(ctx.tenant.id,{timeoutMs:2500}));
    const [result,rt,ev]=await Promise.all([
     ctx.viewerClient.rpc('ienvia_dashboard_summary_v1',{p_owner:ctx.tenant.id}).abortSignal(AbortSignal.timeout(6000)),runtimeTask,providerTask
    ]);
    if(result.error){if(result.error.code==='42501')return res.status(403).json({ok:false,error:'Conta não autorizada.'});return unavailable(res);}
    data=assertSummary(result.data,ctx.tenant.id);
    runtime=rt.failed?{maxWaSlots:ctx.tenant.maxWaSlots}:rt.value;
    provider=ev.failed?{}:ev.value;providerFailed=ev.failed||rt.failed;
    if(rt.failed)warnings.push('connections_unavailable');if(ev.failed)warnings.push('provider_unavailable');
   } else {
    // Contatos e atividade vêm da memória deste motor. Campanhas, porém, pertencem à conta:
    // com a conta conectada, a contagem é lida da nuvem em vez de aparecer como indisponível.
    data=localSummary(ctx.data,{now,tenantId:ctx.tenant?.id||null});
    if(ctx.tenant?.id&&ctx.viewerClient){
     const task=await ctx.viewerClient.rpc('ienvia_dashboard_summary_v1',{p_owner:ctx.tenant.id})
      .abortSignal(AbortSignal.timeout(6000)).then(r=>({r})).catch(()=>({failed:true}));
     const counts=task.failed?null:task.r?.data?.counts;
     if(counts&&Number.isSafeInteger(counts.campaigns)&&counts.campaigns>=0){
      data.counts.campaigns=counts.campaigns;
      const detail=task.r.data.campaigns;
      if(detail&&typeof detail==='object')data.campaigns=detail;
      warnings.push('local_contacts_with_cloud_campaigns');
     } else warnings.push('campaigns_unavailable');
    } else warnings.push('campaigns_not_loaded_in_local_summary');
    data=assertSummary(data,ctx.tenant?.id||null,{allowLocal:true});
    runtime=ctx.runtime;
   }
   const connections=publicConnectionSummary(composeConnectionState(runtime,provider,{now:Date.now(),providerFailed}));
   return res.json({ok:true,...data,mode:ctx.mode,viewer:ctx.viewer,tenant:ctx.tenant,permissions:ctx.permissions,connections,warnings,preferenceScope:ctx.viewerClient?'account':'browser'});
  }catch{return unavailable(res);}
 });
 router.get('/appearance',async(req,res)=>{
  try{
   const ctx=await context(req);if(!ctx)return res.status(401).json({ok:false,authRequired:true});
   if(!ctx.viewerClient)return res.json({ok:true,theme:null,scope:'browser'});
   const {data,error}=await ctx.viewerClient.from('ienvia_user_appearance').select('theme').eq('user_id',ctx.viewer.id).maybeSingle();
   if(error)return res.status(503).json({ok:false,error:'Não foi possível carregar a aparência da conta.'});
   if(data&& !['dark','light'].includes(data.theme))throw new Error('invalid');
   res.json({ok:true,theme:data?.theme||null,scope:'account'});
  }catch{res.status(503).json({ok:false,error:'Não foi possível carregar a aparência.'});}
 });
 router.put('/appearance',async(req,res)=>{
  if(!['dark','light'].includes(req.body?.theme)||Object.keys(req.body||{}).some(k=>k!=='theme'))return res.status(400).json({ok:false,error:'Informe apenas theme: dark ou light.'});
  try{
   const ctx=await context(req);if(!ctx)return res.status(401).json({ok:false,authRequired:true});
   if(!ctx.viewerClient)return res.status(409).json({ok:false,error:'No modo local sem conta a escolha é salva neste navegador.'});
   const {data,error}=await ctx.viewerClient.rpc('ienvia_set_appearance',{p_theme:req.body.theme});
   if(error)return res.status(error.code==='42501'?403:503).json({ok:false,error:'Não foi possível salvar a aparência na conta.'});
   if(data?.theme!==req.body.theme)throw new Error('invalid');res.json({ok:true,theme:data.theme,scope:'account'});
  }catch{res.status(503).json({ok:false,error:'Não foi possível salvar a aparência na conta.'});}
 });
 return router;
}

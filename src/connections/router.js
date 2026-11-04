import {Router} from 'express';
import {connectionDetails} from './model.js';

export function createConnectionsRouter({readEvolution,buildRuntime,getLocalContext}={}) {
  const router=Router();
  router.get('/summary',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {
      const ctx=req.dashboardContext||await getLocalContext?.(req);
      if(!ctx)return res.status(401).json({ok:false,authRequired:true,error:'Entre pelo painel atual.'});
      let runtime=ctx.runtime,provider={},devices=[],warnings=[];
      if(ctx.mode==='vercel_cloud') {
        const client=ctx.dataClient;
        const safe=promise=>promise.then(value=>({value})).catch(()=>({failed:true}));
        const [rt,slots,workerRows,ev]=await Promise.all([
          safe(client.from('zapia_wa_runtime').select('status,worker_online,worker_heartbeat_at,worker_platform').eq('user_id',ctx.tenant.id).maybeSingle().abortSignal(AbortSignal.timeout(3000))),
          safe(client.from('zapia_wa_slots').select('slot_id,status,worker_online,worker_heartbeat_at,device_id').eq('user_id',ctx.tenant.id).limit(3).abortSignal(AbortSignal.timeout(3000))),
          safe(client.from('zapia_worker_devices').select('device_id,device_label,platform,version,online,heartbeat_at,active_slots').eq('user_id',ctx.tenant.id).order('heartbeat_at',{ascending:false}).limit(20).abortSignal(AbortSignal.timeout(3000))),
          safe(readEvolution(ctx.tenant.id,{timeoutMs:2500}))
        ]);
        const runtimeFailed=[rt,slots,workerRows].some(r=>r.failed||r.value?.error);
        if(runtimeFailed){warnings.push('runtime_unavailable');runtime={maxWaSlots:ctx.tenant.maxWaSlots};}
        else {
          devices=workerRows.value.data||[];
          runtime=buildRuntime({rtRow:rt.value.data,slotRows:slots.value.data||[],deviceRows:devices,settings:{botEnabled:false},maxWaSlots:ctx.tenant.maxWaSlots});
        }
        if(ev.failed)warnings.push('provider_unavailable');else provider=ev.value;
      }
      const now=Date.now();
      return res.json({ok:true,schemaVersion:1,generatedAt:new Date(now).toISOString(),mode:ctx.mode,viewer:ctx.viewer,tenant:ctx.tenant,permissions:ctx.permissions,
        ...connectionDetails({runtime,provider,devices,warnings,now}),
        capabilities:{readOnly:true,pairingInLegacy:true,canOperate:false},preferenceScope:'browser'});
    }catch{
      return res.status(503).json({ok:false,code:'CONNECTIONS_UNAVAILABLE',error:'Não foi possível consultar as conexões. Nenhuma sessão foi alterada.'});
    }
  });
  return router;
}

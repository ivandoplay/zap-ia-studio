import {Router} from 'express';
import {connectionDetails} from './model.js';
import {privatePairing} from './controls.js';

export function createConnectionsRouter({readEvolution,buildRuntime,getLocalContext}={}) {
  const router=Router();
  const own=async(req,res)=>{res.setHeader('Cache-Control','no-store, private');const ctx=req.dashboardContext||await getLocalContext?.(req);if(!ctx){res.status(401).json({ok:false,authRequired:true,error:'Entre pelo painel atual.'});return null;}if(ctx.viewer.id!==ctx.tenant.id){res.status(403).json({ok:false,error:'Pareamento e configurações não são exibidos em suporte.'});return null;}return ctx;};
  router.get('/configuration',async(req,res)=>{try{
    const ctx=await own(req,res);if(!ctx)return;let values=ctx.data?.settings?.waSlots||{};
    if(ctx.mode==='vercel_cloud'){const r=await ctx.viewerClient.from('zapia_workspaces').select('wa_slots:settings->waSlots').eq('user_id',ctx.tenant.id).maybeSingle().abortSignal(AbortSignal.timeout(3000));if(r.error)throw Error();values=r.data?.wa_slots||{};}
    const slots=Array.from({length:ctx.tenant.maxWaSlots},(_,i)=>{const slotId=`slot_${i+1}`,v=values[slotId]||{};return {slotId,label:typeof v.label==='string'?v.label.slice(0,42):`Chip ${i+1}`,aiEnabled:typeof v.aiEnabled==='boolean'?v.aiEnabled:null};});return res.json({ok:true,slots});
  }catch{return res.status(503).json({ok:false,error:'Não foi possível consultar a configuração. Nada foi alterado.'});}});
  router.get('/pairing',async(req,res)=>{try{
    const ctx=await own(req,res);if(!ctx)return;const {slotId,commandId}=req.query;
    if(typeof slotId!=='string'||!/^slot_[1-3]$/.test(slotId)||Number(slotId.slice(-1))>ctx.tenant.maxWaSlots||typeof commandId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commandId)))return res.status(400).json({ok:false,error:'Chip ou comando inválido.'});
    if(ctx.mode!=='vercel_cloud')return res.status(400).json({ok:false,error:'Esta consulta se aplica somente a comandos do motor na nuvem.'});
    const r=await ctx.viewerClient.from('zapia_commands').select('id,action,status,slot_id,result,created_at,target_device_id').eq('user_id',ctx.tenant.id).eq('id',commandId).maybeSingle().abortSignal(AbortSignal.timeout(3000));if(r.error)throw Error();const cmd=r.data;
    if(!cmd||cmd.action!=='wa_connect'||cmd.slot_id!==slotId)return res.status(404).json({ok:false,error:'Comando de pareamento não encontrado para este chip.'});
    let value=cmd.status==='done'?(cmd.result?.slotState||cmd.result?.waState?.slots?.[slotId]||{}):{};
    if(cmd.status==='done'&&['connecting','qr_ready'].includes(value.status)){
      let query=ctx.viewerClient.from('zapia_wa_slots').select('status,qr_data_url,pairing_code,updated_at,device_id').eq('user_id',ctx.tenant.id).eq('slot_id',slotId);if(cmd.target_device_id)query=query.eq('device_id',cmd.target_device_id);
      const current=await query.maybeSingle().abortSignal(AbortSignal.timeout(3000));if(current.error)throw Error();if(current.data&&Date.parse(current.data.updated_at)>=Date.parse(cmd.created_at))value={status:current.data.status,qrDataUrl:current.data.qr_data_url,pairingCode:current.data.pairing_code};
    }
    return res.json({ok:true,slotId,commandStatus:['pending','processing','done','error'].includes(cmd.status)?cmd.status:'unknown',...privatePairing({...value,generatedAt:cmd.created_at})});
  }catch{return res.status(503).json({ok:false,error:'Sem confirmação do comando. Nenhum novo comando foi criado.'});}});
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
        capabilities:{readOnly:true,pairingInLegacy:false,canOperate:ctx.viewer.id===ctx.tenant.id},preferenceScope:'browser'});
    }catch{
      return res.status(503).json({ok:false,code:'CONNECTIONS_UNAVAILABLE',error:'Não foi possível consultar as conexões. Nenhuma sessão foi alterada.'});
    }
  });
  return router;
}

import {dispatchError,requireUuid} from './contracts.js';
const nativeScheduler={schedule(fn,delay){const h=setTimeout(fn,delay);h.unref?.();return h;},cancel:clearTimeout};
// Supervisão opt-in de porta JÁ adquirida. Não cria socket/auth, não registra executor e não libera lease.
export function createAcquiredSessionSupervisor({ownerId,instanceId,executorId,session,getWorkerIdentity,scheduler=nativeScheduler,intervalMs=10000,stepTimeoutMs=4000,now=Date.now,onFault=()=>{}}={}){
 const identity=Object.freeze({ownerId:requireUuid(ownerId),instanceId:requireUuid(instanceId),executorId:requireUuid(executorId),transport:'local_worker',protocolVersion:1});
 if(typeof getWorkerIdentity!=='function'||typeof now!=='function'||typeof onFault!=='function'||typeof scheduler?.schedule!=='function'||typeof scheduler?.cancel!=='function'||!Number.isInteger(intervalMs)||intervalMs<5000||intervalMs>15000||!Number.isInteger(stepTimeoutMs)||stepTimeoutMs<5||stepTimeoutMs>5000||['inspect','renew','flush','sendManualText'].some(k=>typeof session?.[k]!=='function'))throw new TypeError('Porta adquirida, contexto e agendamento limitado obrigatórios.');
 const leaseId=requireUuid(session.identity?.leaseId),ports=Object.fromEntries(['inspect','renew','flush','sendManualText'].map(k=>[k,session[k].bind(session)])),schedule=scheduler.schedule.bind(scheduler),cancel=scheduler.cancel.bind(scheduler);
 let state='idle',timer=null,maintenance=null,generation=0,gateVersion=0,inFlight=0,renewals=0,lastFault=null;
 const error=(code='INSTANCE_WORKER_BLOCKED')=>dispatchError(code,'Worker não está autorizado para novas operações. Nenhum reconnect, resend ou takeover foi iniciado.',503);
 function owned(){const actor=getWorkerIdentity(),actual=session.identity;if(actor?.ownerId!==identity.ownerId||actor?.executorId!==identity.executorId||Object.entries(identity).some(([k,v])=>actual?.[k]!==v)||actual.leaseId!==leaseId){if(state!=='stopped')block('INSTANCE_SCOPE_MISMATCH');throw error('INSTANCE_SCOPE_MISMATCH');}}
 owned();
 function clearTimer(){if(timer!==null){const h=timer;timer=null;cancel(h);}}
 function block(code){const duplicate=state==='blocked'&&lastFault===code;clearTimer();state='blocked';gateVersion++;lastFault=code;if(!duplicate)try{Promise.resolve(onFault({code,state,renewals})).catch(()=>{});}catch{}}
 function active(){owned();if(state!=='running')throw error();}
 function status(){owned();return {...identity,state,renewals,inFlight,drainRequired:inFlight>0||maintenance!==null,connectedNotAsserted:true,lastFault};}
 async function bounded(operation){let h;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{h=setTimeout(()=>reject(error('INSTANCE_WORKER_STEP_TIMEOUT')),stepTimeoutMs);})]);}finally{clearTimeout(h);}}
 function verify(info){const age=now()-Date.parse(info?.observedAt);if(Object.entries(identity).some(([k,v])=>info?.[k]!==v)||info.leaseId!==leaseId||info.connected!==true||!Number.isFinite(age)||age< -5000||age>15000)throw error('INSTANCE_WORKER_SESSION_UNVERIFIED');return info;}
 function arm(){if(state!=='running')return;clearTimer();const v=gateVersion;const handle=schedule(async()=>{if(timer!==handle||state!=='running'||v!==gateVersion)return;timer=null;try{await pulse();}catch{}},intervalMs);if(handle===null||handle===undefined)throw error('INSTANCE_WORKER_SCHEDULER_INVALID');timer=handle;}
 async function maintain(recover=false){
  if(maintenance)return maintenance;const n=++generation;
  const valid=()=>{owned();if(n!==generation||state==='stopped')throw error('INSTANCE_WORKER_STOPPED');};
  const work=(async()=>{try{
   valid();if(recover){const flushed=await bounded(()=>ports.flush());valid();if(!flushed||!Number.isSafeInteger(flushed.persisted)||flushed.persisted<0||flushed.pending!==0)throw error('INSTANCE_WORKER_INGRESS_PENDING');}
   const info=await bounded(()=>ports.inspect());valid();verify(info);
   const renewed=await bounded(()=>ports.renew());valid();if(renewed?.renewed!==true||typeof renewed.expiresAt!=='string'||!Number.isFinite(Date.parse(renewed.expiresAt)))throw error('INSTANCE_WORKER_LEASE_UNVERIFIED');
   renewals++;state='running';lastFault=null;arm();return {...identity,state,renewals,connectedNotAsserted:true};
  }catch(e){if(n===generation&&state!=='stopped')block(e?.code==='INSTANCE_SCOPE_MISMATCH'?'INSTANCE_SCOPE_MISMATCH':e?.code==='INSTANCE_WORKER_STEP_TIMEOUT'?'INSTANCE_WORKER_STEP_TIMEOUT':'INSTANCE_WORKER_MAINTENANCE_FAILED');throw error(lastFault||'INSTANCE_WORKER_STOPPED');}})();
  maintenance=work;try{return await work;}finally{if(maintenance===work)maintenance=null;}
 }
 function pulse(){if(state!=='running')return Promise.reject(error());clearTimer();return maintain();}
 const port=Object.freeze({identity:Object.freeze({...identity,leaseId}),async inspect(){active();const v=gateVersion;const info=await bounded(()=>ports.inspect());active();if(v!==gateVersion)throw error();return verify(info);},async sendManualText(raw){active();inFlight++;try{
  // Resultado tardio da operação já iniciada deve alcançar o ledger ORIGINAL. Stop não fabrica falha/ACK.
  return await ports.sendManualText(raw);
 }finally{inFlight--;}}});
 return Object.freeze({port,status,
  async start(){owned();if(state!=='idle')throw error();state='starting';gateVersion++;return maintain();},
  pulse,
  async recover(){owned();if(state!=='blocked'||maintenance)throw error();state='recovering';gateVersion++;return maintain(true);},
  stop(){generation++;gateVersion++;clearTimer();state='stopped';return {stopped:true,inFlight,drainRequired:inFlight>0||maintenance!==null,leaseReleased:false,socketClosed:false};}
 });
}

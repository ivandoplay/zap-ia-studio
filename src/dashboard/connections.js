// Composição somente de leitura. Nenhum estado de conexão é permissão para enviar.
export function freshTimestamp(value, now=Date.now(), ttl=95000) {
  const time=Date.parse(value || '');return Number.isFinite(time)&&now-time>=-5000&&now-time<=ttl;
}
export function composeConnectionState(runtime={}, evolution={}, {now=Date.now(),checkedAt=new Date(now).toISOString(),providerFailed=false}={}) {
  const max=runtime.maxWaSlots===2||runtime.maxWaSlots===3?runtime.maxWaSlots:1;
  const out={...runtime,slots:{},connectionCheckedAt:checkedAt,providerReadStatus:providerFailed?'unavailable':'updated'};
  for(let i=1;i<=max;i++) {
    const id=`slot_${i}`,local=runtime.slots?.[id]||{},remote=evolution?.[id];
    const localLive=local.workerOnline===true&&freshTimestamp(local.workerHeartbeatAt,now);
    const localConnected=localLive&&local.status==='connected';
    const remoteFresh=remote&&freshTimestamp(remote.checkedAt||checkedAt,now,15000);
    const remoteStatus=remoteFresh&&['connected','connecting','disconnected','qr_ready'].includes(remote.status)?remote.status:'unknown';
    let status='disconnected',transport='none';
    if(localConnected&&remoteStatus==='connected'){status='conflict';transport='conflict';}
    else if(localConnected){status='connected';transport='local';}
    else if(remote){status=remoteStatus;transport='evolution_api';}
    else if(localLive){status=['connecting','qr_ready'].includes(local.status)?local.status:'disconnected';transport='local';}
    else if(providerFailed||local.status==='connected'||local.rawStatus==='connected'){status='unknown';transport='unknown';}
    const slot={...local,slotId:id,status,rawStatus:status,transport,workerOnline:localLive,providerCheckedAt:remote?.checkedAt||checkedAt,providerReadStatus:remote?.readStatus||(providerFailed?'unavailable':remote?'updated':'not_configured')};
    if(transport==='evolution_api') {
      slot.phone=remote.phone||null;slot.connectedUser=status==='connected'&&remote.phone?{phone:remote.phone,name:null}:null;
      slot.qrDataUrl=status==='connecting'||status==='qr_ready'?remote.qrDataUrl||null:null;
      slot.pairingCode=status==='connecting'||status==='qr_ready'?remote.pairingCode||null:null;
    }
    if(status!=='connected')slot.connectedUser=null;
    if(status==='unknown'||status==='conflict'){slot.qrDataUrl=null;slot.pairingCode=null;}
    out.slots[id]=slot;
  }
  const values=Object.values(out.slots);
  out.workerOnline=values.some(s=>s.workerOnline)||(runtime.workerOnline===true&&freshTimestamp(runtime.workerHeartbeatAt,now))||(runtime.devices||[]).some(d=>d.online===true&&freshTimestamp(d.heartbeatAt,now));
  const primary=values.find(s=>s.status==='connected')||values[0];
  for(const key of ['connectedUser','qrDataUrl','pairingCode'])out[key]=primary?.[key]||null;
  out.connectedCount=values.filter(s=>s.status==='connected').length;
  out.status=out.connectedCount?'connected':values.some(s=>s.status==='conflict')?'conflict':values.some(s=>s.status==='connecting'||s.status==='qr_ready')?'connecting':values.some(s=>s.status==='unknown')?'unknown':'disconnected';
  out.rawStatus=out.status;
  return out;
}
export function publicConnectionSummary(state={}) {
  const slots=Object.values(state.slots||{}).map(s=>({slotId:s.slotId,status:s.status,transport:s.transport,workerOnline:s.workerOnline===true,checkedAt:s.providerCheckedAt,readStatus:s.providerReadStatus}));
  return {status:state.status||'unknown',connected:slots.filter(s=>s.status==='connected').length,total:slots.length,workerOnline:state.workerOnline===true,providerReadStatus:state.providerReadStatus,checkedAt:state.connectionCheckedAt,slots};
}

import {composeConnectionState, publicConnectionSummary, freshTimestamp} from '../dashboard/connections.js';
const text=(value,max=60)=>typeof value==='string'?value.slice(0,max):null;

// Este DTO é apenas diagnóstico. Não concede permissão para enviar nem seleciona executor.
export function connectionDetails({runtime={},provider={},devices=[],warnings=[],now=Date.now()}={}) {
  const state=composeConnectionState(runtime,provider,{now,providerFailed:warnings.includes('provider_unavailable')||warnings.includes('runtime_unavailable')});
  const connections=publicConnectionSummary(state);
  const allowed=new Set(connections.slots.map(slot=>slot.slotId));
  return {
    connections,
    devices:devices.slice(0,20).map(device=>({
      id:text(device.device_id,128),label:text(device.device_label)||'Motor sem nome',
      platform:text(device.platform,40),version:text(device.version,40),
      online:device.online===true&&freshTimestamp(device.heartbeat_at,now),
      heartbeatAt:Number.isFinite(Date.parse(device.heartbeat_at||''))?new Date(device.heartbeat_at).toISOString():null,
      activeSlots:Array.isArray(device.active_slots)?[...new Set(device.active_slots.filter(id=>allowed.has(id)))]:[]
    })),
    deviceReadStatus:warnings.includes('runtime_unavailable')?'unavailable':'updated',
    warnings:[...new Set(warnings)],
    // Uma restrição exige evidência própria: não inferir banimento de disconnected/401.
    restrictionStatus:'not_verified',executionReadiness:'not_verified'
  };
}

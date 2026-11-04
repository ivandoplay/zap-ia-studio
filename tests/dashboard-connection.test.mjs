import test from 'node:test';
import assert from 'node:assert/strict';
import { composeConnectionState } from '../src/dashboard/connections.js';
test('Evolution desconectada substitui snapshot antigo e não altera o original',()=>{
 const runtime={status:'connected',maxWaSlots:1,slots:{slot_1:{status:'connected',workerOnline:false}}};
 const output=composeConnectionState(runtime,{slot_1:{status:'disconnected'}},{checkedAt:'2026-11-03T12:00:00Z',now:Date.parse('2026-11-03T12:00:00Z')});
 assert.equal(output.status,'disconnected'); assert.equal(runtime.status,'connected');assert.equal(output.slots.slot_1.workerOnline,false);
});
const now=Date.parse('2026-11-03T12:00:00Z'),iso=new Date(now).toISOString();
const base=(extra={})=>({maxWaSlots:1,slots:{slot_1:{status:'connected',workerOnline:false,...extra}}});
test('provider conectado não inventa motor online; erro/atraso não mantém connected',()=>{
 assert.equal(composeConnectionState(base(),{slot_1:{status:'connected'}},{now,checkedAt:iso}).workerOnline,false);
 assert.equal(composeConnectionState(base(),{},{now,providerFailed:true}).status,'unknown');
 assert.equal(composeConnectionState(base(),{slot_1:{status:'connected',checkedAt:new Date(now-16000).toISOString()}},{now}).status,'unknown');
});
test('motor fresco funciona sem Evolution e conflito é explícito, nunca escolhido automaticamente',()=>{
 const runtime=base({workerOnline:true,workerHeartbeatAt:iso});assert.equal(composeConnectionState(runtime,{},{now}).slots.slot_1.transport,'local');
 const conflict=composeConnectionState(runtime,{slot_1:{status:'connected'}},{now,checkedAt:iso});assert.equal(conflict.status,'conflict');assert.equal(conflict.connectedCount,0);
 const old=base({workerOnline:true,workerHeartbeatAt:new Date(now-96000).toISOString()});assert.equal(composeConnectionState(old,{},{now}).status,'unknown');
});
test('propriedades: 300 combinações sem mutação, limites de chip, connected exige prova fresca',()=>{
 const statuses=['connected','disconnected','connecting','unknown','qr_ready'];
 for(let i=0;i<300;i++){
  const fresh=i%2===0,worker=i%3===0,status=statuses[i%statuses.length],provider=statuses[Math.floor(i/5)%statuses.length];
  const runtime={maxWaSlots:1+i%3,slots:{slot_1:{status,workerOnline:worker,workerHeartbeatAt:new Date(now-(fresh?1000:100000)).toISOString()}}};
  const before=JSON.stringify(runtime),out=composeConnectionState(runtime,{slot_1:{status:provider}},{now,checkedAt:iso});
  assert.equal(JSON.stringify(runtime),before);assert.equal(Object.keys(out.slots).length,runtime.maxWaSlots);
  assert.equal(out.slots.slot_1.workerOnline,worker&&fresh);
  if(out.slots.slot_1.status==='connected')assert.ok(provider==='connected'||(status==='connected'&&worker&&fresh));
 }
});

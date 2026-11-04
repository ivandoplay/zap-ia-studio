// Apenas adaptadores sintéticos. Não inicia worker, socket, scheduler ou banco.
import test from 'node:test';import assert from 'node:assert/strict';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');
const {dispatchCommandToWorker,cloudWorker}=await import('../src/supabaseCloud.js');
const A='11111111-1111-4111-8111-111111111111';
function fakeClient({owner='motor-a',devices=['motor-a'],error=false}={}){let writes=0;return {get writes(){return writes;},from(table){const row=table==='zapia_users'?{role:'user',max_wa_slots:1}:table==='zapia_wa_runtime'?{worker_online:false}:table==='zapia_wa_slots'?[{slot_id:'slot_1',device_id:owner,status:'connected'}]:devices.map(device_id=>({device_id,online:true,heartbeat_at:new Date().toISOString()}));const q={select(){return q;},eq(){return q;},maybeSingle(){return Promise.resolve({data:row,error:error?{}:null});},then(resolve,reject){return Promise.resolve({data:row,error:error?{}:null}).then(resolve,reject);},insert(){writes++;throw Error('Nenhuma inserção esperada');}};return q;}};}
test('fila: rejeita destino de outra conta/offline, dono diferente e erro de leitura sem inserir comando',async()=>{
 for(const [client,payload,status]of [[fakeClient(),{slotId:'slot_1',clearSession:false,targetDeviceId:'estranho'},409],[fakeClient({devices:['motor-a','motor-b']}),{slotId:'slot_1',clearSession:false,targetDeviceId:'motor-b'},409],[fakeClient({error:true}),{slotId:'slot_1',clearSession:false},503],[fakeClient(),{slotId:'slot_9',clearSession:false},400]]){
  await assert.rejects(dispatchCommandToWorker(client,A,'wa_disconnect',payload,1,{slotId:payload.slotId,targetDeviceId:payload.targetDeviceId}),e=>e.statusCode===status);assert.equal(client.writes,0);
 }
});
test('worker: comandos malformados não operam Chip 1; false mantém sessão e não vira limpeza',async()=>{
 const saved={client:cloudWorker.client,user:cloudWorker.user,whatsappManager:cloudWorker.whatsappManager,pushRuntimeHeartbeat:cloudWorker.pushRuntimeHeartbeat};const operations=[],updates=[];
 cloudWorker.user={id:A,role:'user',maxWaSlots:1};cloudWorker.whatsappManager={disconnect:async(clear,slot)=>{operations.push({clear,slot});return {slots:{slot_1:{status:'disconnected'}}};},getSlot:()=>null};cloudWorker.pushRuntimeHeartbeat=async()=>{};
 cloudWorker.client={rpc:async()=>({data:[{id:'claimed'}]}),from:()=>({update:body=>({eq:async()=>{updates.push(body);return {};}})})};
 try{for(const [slot,payload,userId]of [['slot_9',{slotId:'slot_9',clearSession:false},A],['slot_1',{slotId:'slot_1',clearSession:'false'},A],['slot_1',{slotId:'slot_1',clearSession:false},'outra-conta']])await cloudWorker.executeCommandRow({id:crypto.randomUUID(),action:'wa_disconnect',slot_id:slot,payload,user_id:userId,target_device_id:cloudWorker.deviceIdentity.deviceId});
  assert.equal(operations.length,0);assert.equal(updates.every(u=>u.status==='error'),true);
  await cloudWorker.executeCommandRow({id:crypto.randomUUID(),action:'wa_disconnect',slot_id:'slot_1',payload:{slotId:'slot_1',clearSession:false},user_id:A,target_device_id:cloudWorker.deviceIdentity.deviceId});assert.deepEqual(operations,[{clear:false,slot:'slot_1'}]);assert.equal(updates.at(-1).status,'done');
 }finally{Object.assign(cloudWorker,saved);}
});

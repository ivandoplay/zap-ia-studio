import assert from 'node:assert/strict';
import { test } from 'node:test';
const { cloudWorker }=await import('../src/supabaseCloud.js');

test('publica chip desconectado com identificador vazio exigido pelo banco',async()=>{
 const saved=[];
 const deviceId=cloudWorker.deviceIdentity.deviceId;
 const manager={
  getPublicState:()=>({status:'disconnected',slots:{slot_1:{status:'disconnected'}}}),
  getActiveLocalSlotIds:()=>[],hasSavedSession:()=>false,setCloudPeerSlotPhones:()=>{}
 };
 const client={from(table){return {
  upsert(values){if(table==='zapia_wa_slots')saved.push(...(Array.isArray(values)?values:[values]));return Promise.resolve({error:null})},
  select(){return {eq(){return Promise.resolve({data:[{slot_id:'slot_1',device_id:deviceId,status:'connecting',worker_online:true,worker_heartbeat_at:new Date().toISOString()}]})}}}
 }}};
 cloudWorker.client=client;cloudWorker.user={id:'teste'};cloudWorker.whatsappManager=manager;
 await cloudWorker.pushRuntimeHeartbeat();
 assert.equal(saved.length,1,'deve publicar estado do chip após desconectar');
 assert.equal(saved[0].status,'disconnected');
 assert.equal(saved[0].device_id,'','device_id possui NOT NULL e usa string vazia ao liberar');
});

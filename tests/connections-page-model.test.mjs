import test from 'node:test';import assert from 'node:assert/strict';
import {connectionDetails} from '../src/connections/model.js';
const now=Date.parse('2026-11-03T12:00:00Z');
test('diagnóstico separa worker de Evolution, respeita plano e remove dados de pareamento',()=>{
 const result=connectionDetails({runtime:{maxWaSlots:1,slots:{slot_1:{status:'connected',workerOnline:false,qrDataUrl:'privado',connectedUser:{phone:'privado'}}}},provider:{slot_1:{status:'disconnected',checkedAt:new Date(now).toISOString()}},devices:[{device_id:'device-a',device_label:'Meu PC',online:true,heartbeat_at:new Date(now-100000).toISOString(),active_slots:['slot_1','slot_3']}],now});
 assert.equal(result.connections.status,'disconnected');assert.equal(result.devices[0].online,false);assert.deepEqual(result.devices[0].activeSlots,['slot_1']);assert.equal(JSON.stringify(result).includes('privado'),false);assert.equal(result.devices.length,1);
});
test('falha de runtime distingue dispositivos indisponíveis de lista vazia e não inventa prontidão',()=>{
 const data=connectionDetails({runtime:{maxWaSlots:3},warnings:['runtime_unavailable','provider_unavailable'],now});
 assert.equal(data.deviceReadStatus,'unavailable');assert.equal(data.connections.slots.length,3);assert.equal(data.connections.status,'unknown');assert.equal(data.executionReadiness,'not_verified');assert.equal(data.restrictionStatus,'not_verified');
});
test('20 dispositivos no máximo; strings são limitadas, heartbeat futuro não confirma online',()=>{
 const devices=Array.from({length:30},(_,i)=>({device_id:`d-${i}`,device_label:'x'.repeat(100),online:true,heartbeat_at:new Date(now+100000).toISOString(),active_slots:['slot_1','slot_1','slot_4']}));
 const data=connectionDetails({runtime:{maxWaSlots:1},devices,now});assert.equal(data.devices.length,20);assert.equal(data.devices[0].label.length,60);assert.equal(data.devices[0].online,false);assert.deepEqual(data.devices[0].activeSlots,['slot_1']);
});

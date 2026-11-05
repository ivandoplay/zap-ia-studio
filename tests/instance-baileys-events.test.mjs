import test from 'node:test';import assert from 'node:assert/strict';import {instanceJid,normalizeBaileysIngress} from '../src/instances/baileysEvents.js';
const key={id:'SYNTHETIC',remoteJid:'558600000002@s.whatsapp.net',fromMe:true},observedAt='2026-11-03T12:00:00Z';
test('normalização Baileys: device não vira contato, LID é opaco e heurísticas brasileiras não unem telefones',()=>{
 for(let device=0;device<80;device++)assert.equal(instanceJid(`558600000001:${device}@s.whatsapp.net`),'558600000001@s.whatsapp.net');assert.equal(instanceJid('123456789:2@lid',{allowLid:true}),'123456789@lid');for(const bad of ['slot_1::558600000001@s.whatsapp.net','558600000001@g.us','558600000001@c.us','+558600000001@s.whatsapp.net','558600000001:2:3@s.whatsapp.net','0@s.whatsapp.net','status@broadcast'])assert.throws(()=>instanceJid(bad));assert.throws(()=>instanceJid('12345@lid'));assert.notEqual(instanceJid('558691234567@s.whatsapp.net'),instanceJid('5586991234567@s.whatsapp.net'));
});
test('normalização Baileys: enum instalado distingue aceite, entrega e leitura; updates sem status preservam wire',()=>{
 for(const [status,ack] of [[0,0],[1,0],[2,1],[3,2],[4,3],[5,4]])assert.equal(normalizeBaileysIngress('receipt',{key,update:{status}},{observedAt}).ack,ack);const edit=normalizeBaileysIngress('receipt',{key,update:{message:{conversation:'Edição sintética'}}},{observedAt});assert.equal(edit.kind,'unprojected');assert.equal(edit.wire.record.update.message.conversation,'Edição sintética');
});
test('normalização Baileys: buffers preservados, histórico sem timestamp é identificado e mídia privada não é retida',()=>{
 const normal=normalizeBaileysIngress('history',{key,message:{imageMessage:{caption:'Legenda sintética',mediaKey:Buffer.from([1,2,3])}}},{observedAt});assert.equal(normal.mediaType,'image');assert.equal(normal.timestampSource,'capture');assert.equal(normal.wire.record.message.imageMessage.mediaKey.data,'AQID');
 for(const wrapper of ['viewOnceMessage','viewOnceMessageV2','ephemeralMessage']){const e=normalizeBaileysIngress('notify',{key,message:{[wrapper]:{message:{imageMessage:{caption:'NAO_RETER_PRIVADO',mediaKey:Buffer.from([1,2,3])}}}}},{observedAt});assert.equal(e.text,null);assert.equal(e.mediaType,'privacy_omitted');assert.equal(JSON.stringify(e).includes('NAO_RETER_PRIVADO'),false);assert.equal(JSON.stringify(e).includes('mediaKey'),false);}
});

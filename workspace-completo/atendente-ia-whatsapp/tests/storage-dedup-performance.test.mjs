import assert from 'node:assert/strict';
import { Storage } from '../src/storage.js';
// Cópia da implementação antiga feita fora do repositório para comparar a semântica.
const OldStorage = process.env.ZAPIA_BASELINE_STORAGE
  ? (await import(process.env.ZAPIA_BASELINE_STORAGE)).Storage
  : null;
let seed=42;function rand(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
for (let round=0;round<70;round++) {
 const contacts={};const ids=[];const total=150+rand(150);
 for(let i=0;i<total;i++){
  const slot=1+rand(3), prefix=slot===1?'':`slot_${slot}::`;const ddd=String(10+rand(89)).padStart(2,'0');const tail=String(10000000+rand(89999999));let phone=`55${ddd}9${tail}`;
  if(rand(3)===0)phone=phone.slice(2);if(rand(7)===0)phone='';if(rand(15)===0)phone='123456789012345@lid';
  const raw=rand(2)?`${100000000000000+i}@lid`:`${phone||'5511999999999'}@s.whatsapp.net`;
  const key=prefix+raw;ids.push(key);
  // Mesmo chatId representado por chaves diferentes e alterações de telefone geram conflitos realistas.
  const chatId=rand(11)===0 && ids.length>3 ? ids[rand(ids.length-1)] : key;
  contacts['raw_'+i]={chatId,slotId:`slot_${slot}`,phone,name:'Pessoa '+i,stage:['novo','concluido','em_atendimento'][rand(3)],tags:['t'+rand(5)],pausedUntil:rand(8)?null:'forever',messages:[{id:'m'+i,waMsgId:'w'+i,text:'simulado',role:'user',timestamp:'2026-01-01T00:00:00Z'}]};
 }
 const now=new Storage({inMemory:true,initialData:{contacts}}).data.contacts;
 if (OldStorage) {
   const old=new OldStorage({inMemory:true,initialData:{contacts}}).data.contacts;
   assert.deepEqual(now,old,`Resultado diferente na rodada ${round}`);
 }
 assert.ok(Object.values(now).every(c=>c.slotId==='slot_1'||c.slotId==='slot_2'||c.slotId==='slot_3'));
}
const contacts={};for(let i=0;i<7500;i++){const slot=i%2?'slot_2::':'';const key=slot+String(100000000000000+i)+'@lid';contacts[key]={chatId:key,slotId:slot?'slot_2':'slot_1',phone:String(5511000000000+i),messages:[]}}
let t=performance.now();const now=new Storage({inMemory:true,initialData:{contacts}}).data.contacts;const newMs=performance.now()-t;
assert.equal(Object.keys(now).length,7500);
if (OldStorage) {
 t=performance.now();const old=new OldStorage({inMemory:true,initialData:{contacts}}).data.contacts;const oldMs=performance.now()-t;assert.deepEqual(now,old);assert.ok(newMs<oldMs);console.log(`Equivalência com versão anterior: ${Math.round(oldMs)}ms contra ${Math.round(newMs)}ms.`);
}
console.log(`OK: 70 cenários e 7.500 fichas (${Math.round(newMs)}ms).`);

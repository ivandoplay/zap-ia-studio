import test from 'node:test';import assert from 'node:assert/strict';import {localSummary,assertSummary,dayKey} from '../src/dashboard/model.js';
const now=Date.parse('2026-11-03T12:00:00Z');
test('local: usa contatos, não mensagens; fronteira do dia é Fortaleza e não altera fonte',()=>{
 const data={contacts:{a:{stage:'aguardando_humano',lastMessageAt:'2026-11-03T02:59:59Z',messages:Array(80).fill('privado')},b:{stage:'novo',lastMessageAt:'2026-11-03T03:00:00Z'},c:{stage:'novo',lastMessageAt:'inválido'},d:{stage:'novo',lastMessageAt:'2026-10-01T12:00:00Z'}}};
 const before=JSON.stringify(data),s=assertSummary(localSummary(data,{now,tenantId:'local'}),'local',{allowLocal:true});
 assert.equal(s.counts.conversations,4);assert.equal(s.counts.pendingHuman,1);assert.equal(s.counts.campaigns,null);assert.equal(s.activity.at(-2).value,1);assert.equal(s.activity.at(-1).value,1);assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(s).includes('privado'),false);assert.equal(dayKey('ruim'),null);
});
test('dados inválidos ou de outro tenant não viram zero',()=>{
 const s=localSummary({contacts:{}},{now,tenantId:'A'});assert.throws(()=>assertSummary(s,'B',{allowLocal:true}));assert.throws(()=>assertSummary({...s,counts:{conversations:-1,pendingHuman:0,campaigns:0}},'A'));assert.throws(()=>assertSummary({...s,activity:[]},'A',{allowLocal:true}));
});

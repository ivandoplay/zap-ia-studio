import test from 'node:test';import assert from 'node:assert/strict';
import {parseHistoryQuery,parseInstanceMessages,parseInstanceThreads} from '../src/instances/history.js';
const ownerId='11111111-1111-4111-8111-111111111111',instanceId='22222222-2222-4222-8222-222222222222',threadId='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',scope={ownerId,instanceId,threadId},T='2026-11-03T12:00:00Z';
const row=()=>({id,threadId,providerMessageId:'SYNTHETIC',fromMe:true,text:'Texto sintético',mediaType:'text',deleted:false,conflicted:false,ack:1,delivered:false,messageAt:T,timestampSource:'capture',dispatchState:'accepted',origins:[{instanceId,name:'Instância sintética',crmVisible:false}],originCount:1,originsTruncated:false});
const page=()=>({...scope,items:[row()],hasMore:false,nextCursor:null});
test('histórico: filtros limitados e cursor UUID, sem coerção de arrays/objetos',()=>{
 assert.deepEqual(parseHistoryQuery(),{limit:30,after:null,visibility:'visible'});for(const query of [{limit:'0'},{limit:'51'},{limit:2},{limit:['2']},{after:'slot_1'},{after:[]},{visibility:['all']},{visibility:'toString'}])assert.throws(()=>parseHistoryQuery(query),e=>e.status===400);
});
test('histórico: DTO de mensagens remove dados extras em todos os níveis e falha fechado por domínio',()=>{
 const p=page();p.wire='SECRET';p.items[0].leaseId='SECRET';p.items[0].origins[0].capability='SECRET';assert.equal(JSON.stringify(parseInstanceMessages(p,scope,30)).includes('SECRET'),false);
 for(const mutation of [p=>p.ownerId=instanceId,p=>p.instanceId=ownerId,p=>p.threadId=ownerId,p=>p.items[0].ack=5,p=>p.items[0].delivered=true,p=>p.items[0].deleted=true,p=>p.items[0].originCount=0,p=>p.items[0].originsTruncated=true,p=>p.items[0].messageAt='invalid',p=>p.items[0].origins.push({...p.items[0].origins[0]}),p=>p.items.push({...p.items[0]}),p=>p.hasMore=true]){const bad=page();mutation(bad);assert.throws(()=>parseInstanceMessages(bad,scope,30),e=>e.status===503);}
 const ack=page();ack.items[0].ack=2;ack.items[0].delivered=true;assert.equal(parseInstanceMessages(ack,scope,30).items[0].delivered,true);
});
test('histórico: PN/LID explicitamente distintos e cursor nunca inventado',()=>{
 const p={ownerId,instanceId,items:[{id:threadId,selfJid:'558600000001@s.whatsapp.net',peerJid:'123456789@lid',identityKind:'provisional_lid',createdAt:T,wire:'SECRET'}],hasMore:true,nextCursor:threadId};assert.equal(JSON.stringify(parseInstanceThreads(p,scope,1)).includes('SECRET'),false);assert.throws(()=>parseInstanceThreads({...p,nextCursor:id},scope,1));p.items[0].identityKind='verified_pn';assert.throws(()=>parseInstanceThreads(p,scope,1));
});

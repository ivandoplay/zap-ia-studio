import test from 'node:test';import assert from 'node:assert/strict';
import {parseProfileMutation,parseContactResult,parseThreadProfileResult,CRM_PROFILE_DEFAULTS} from '../src/crm/contracts.js';
const A='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222';
test('CRM documento: preserva CPF/CNPJ como texto informado, sem validação/consulta externa ou automação',()=>{
 assert.deepEqual(parseProfileMutation({expectedRevision:1,patch:{docNumber:' 000.000.000-00 '}}),{expectedRevision:1,patch:{docNumber:'000.000.000-00'}});
 for(const value of [null,1,'x'.repeat(41),'x\n','x\u0000'])assert.throws(()=>parseProfileMutation({expectedRevision:1,patch:{docNumber:value}}),e=>e.status===400);
});
test('CRM documento: ficha antiga sem campo continua legível, sem inventar CPF ou modificar identidade',()=>{
 const old={...CRM_PROFILE_DEFAULTS,tags:[],tasks:[],name:'Cadastro antigo'};delete old.docNumber;const data={ownerId:A,writesEnabled:false,contact:{ownerId:A,id:C,threadId:null,source:'manual',identityKind:'unverified_contact',selfJid:null,peerJid:null,phone:'+558600000088',revision:1,profile:old,createdAt:'2026-11-04T12:00:00.000Z',updatedAt:'2026-11-04T12:00:00.000Z'}};
 const out=parseContactResult(data,{ownerId:A});assert.equal(Object.hasOwn(out.contact.profile,'docNumber'),false);assert.equal(out.contact.identityKind,'unverified_contact');const source={ownerId:A,threadId:C,identity:{selfJid:'558600000001@s.whatsapp.net',peerJid:'558600000002@s.whatsapp.net',identityKind:'verified_pn'},contact:null,writesEnabled:false};assert.equal(parseThreadProfileResult(source,{ownerId:A,threadId:C}).documentFieldSupported,undefined);for(const flag of [true,false])assert.equal(parseThreadProfileResult({...source,documentFieldSupported:flag},{ownerId:A,threadId:C}).documentFieldSupported,flag);assert.throws(()=>parseThreadProfileResult({...source,documentFieldSupported:'yes'},{ownerId:A,threadId:C}),e=>e.status===503);
});
import {createConversationsDemo} from '../public/v2/assets/conversations-demo.js';import {filterConversations} from '../public/v2/assets/conversations-model.js';
test('CRM documento demo: edição é memória, busca encontra campo e novo cadastro não herda documento anterior',async()=>{
 const d=createConversationsDemo(),first=(await d.list()).items[0];await d.updateContact(first.id,{docNumber:'000.000.000-00'});const rows=(await d.list()).items;assert.equal(filterConversations(rows,{q:'000.000.000-00'})[0].id,first.id);const next=await d.createContact({name:'Outro contato fictício',phone:'+558600000077'});assert.equal(next.docNumber,'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrmMetadataClient} from '../public/v2/assets/crm-metadata-client.js';
import {CRM_PROFILE_DEFAULTS} from '../src/crm/contracts.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',T='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',I='55555555-5555-4555-8555-555555555555';
const context={viewer:{id:A,role:'user'},tenant:{id:A}};
const record=()=>({ownerId:A,id:C,source:'manual',threadId:null,identityKind:'unverified_contact',selfJid:null,peerJid:null,phone:'+558600000088',revision:1,profile:{...CRM_PROFILE_DEFAULTS,name:'Contato sintético',tags:[],tasks:[]},createdAt:'2026-11-04T12:00:00.000Z',updatedAt:'2026-11-04T12:00:00.000Z'});
const envelope=(payload,canEditContacts=false)=>({ok:true,...payload,permissions:{canEditContacts},capabilities:{canSend:false,canPair:false,canAutomate:false}});
test('metadata CRM: agenda valida proprietário, cursor, projeção e capacidades sem propagar extras',async()=>{
 const calls=[],row=record(),client=createCrmMetadataClient({context,request:async(path,options)=>{calls.push({path,...options});return envelope({projection:'saved_records_only',page:{ownerId:A,instanceId:I,visibility:'visible',writesEnabled:false,items:[{...row,privateKey:'NAO_PROPAGAR'}],hasMore:false,nextCursor:null}});}});
 const p=await client.list({instanceId:I,q:'100%_',saved:'saved'});
 assert.equal(p.items[0].profile.name,'Contato sintético');assert.equal(JSON.stringify(p).includes('NAO_PROPAGAR'),false);assert.equal(p.canEditContacts,false);
 const url=new URL(calls[0].path,'http://test');assert.equal(url.pathname,'/api/crm-v2/contacts');assert.equal(url.searchParams.get('instanceId'),I);assert.equal(url.searchParams.get('q'),'100%_');assert.equal(calls[0].method,'GET');
});
test('metadata CRM: ficha ausente não cria cadastro; identidade e dono divergentes são rejeitados',async()=>{
 const identity={selfJid:'558600000001@s.whatsapp.net',peerJid:'558600000002@s.whatsapp.net',identityKind:'verified_pn'};let payload=envelope({ownerId:A,threadId:T,identity,contact:null,writesEnabled:false});const client=createCrmMetadataClient({context,request:async()=>payload});
 assert.equal((await client.profile({threadId:T,identity})).contact,null);
 await assert.rejects(client.profile({threadId:T,identity:{...identity,peerJid:'558600000003@s.whatsapp.net'}}),e=>e.status===503);
 payload={...payload,ownerId:B};await assert.rejects(client.profile({threadId:T}),e=>e.status===503);
});
test('metadata CRM: suporte ou capacidades de envio não autorizam alteração de cadastro',async()=>{
 for(const payload of [envelope({ownerId:A,contact:record(),writesEnabled:true},true),{...envelope({ownerId:A,contact:record(),writesEnabled:true}),capabilities:{canSend:true,canPair:false,canAutomate:false}}]){
 const client=createCrmMetadataClient({context:{viewer:{id:B,role:'master'},tenant:{id:A}},request:async()=>payload});await assert.rejects(client.contact({contactId:C}),e=>e.status===503);
 await assert.rejects(client.updateContact({contactId:C,expectedRevision:1,patch:{note:'Sem permissão'}}),e=>e.status===403);
 }
});
test('metadata CRM: CAS exige revisão confirmada e resultado desconhecido impede replay até consulta explícita',async()=>{
 let unknown=false;const calls=[],client=createCrmMetadataClient({context,request:async(path,o)=>{calls.push({path,...o});if(o.method==='PATCH'){if(unknown)throw Object.assign(Error('Sem resposta'),{status:503});return envelope({ownerId:A,contact:{...record(),revision:2},writesEnabled:true},true);}return envelope({ownerId:A,contact:record(),writesEnabled:true},true);}});
 await assert.rejects(client.updateContact({contactId:C,expectedRevision:1,patch:{saved:true}}),e=>e.status===403);
 await client.contact({contactId:C});const updated=await client.updateContact({contactId:C,expectedRevision:1,patch:{saved:true}});assert.equal(updated.contact.revision,2);assert.deepEqual(calls[1].body,{expectedRevision:1,patch:{saved:true}});
 unknown=true;await assert.rejects(client.updateContact({contactId:C,expectedRevision:2,patch:{saved:false}}),e=>e.detail?.uncertain===true);const count=calls.length;await assert.rejects(client.updateContact({contactId:C,expectedRevision:2,patch:{saved:false}}),e=>e.status===403);assert.equal(calls.length,count);
});
test('metadata CRM: UTF8 do contrato compartilhado e dinheiro não dependem de Buffer no navegador',async()=>{
 const {parseProfileMutation}=await import('../public/v2/assets/crm-metadata-contract.js');const {parseCrmMoney}=await import('../public/v2/assets/crm-metadata-view.js');assert.equal(parseProfileMutation({expectedRevision:0,patch:{note:'Olá 🌿'}}).patch.note,'Olá 🌿');assert.equal(parseCrmMoney('148,05'),14805);assert.equal(parseCrmMoney('0.01'),1);assert.equal(parseCrmMoney('1000000000.00'),100000000000);for(const value of ['1.005','1e3','-1','NaN','1.000,00'])assert.throws(()=>parseCrmMoney(value));
});

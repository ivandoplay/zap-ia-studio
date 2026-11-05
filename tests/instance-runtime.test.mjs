import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstanceRuntime} from '../src/instances/runtime.js';
const A='11111111-1111-4111-8111-111111111111',E='22222222-2222-4222-8222-222222222222';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const repository={resolve(){},reserve(){},start(){},finish(){}};
const driver=(instanceId,ownerId=A)=>({identity:{ownerId,instanceId,executorId:E,transport:'local_worker',protocolVersion:1},inspect:async()=>{},sendText:async()=>{throw Error('Não deve enviar');}});
test('catálogo dinâmico: 48 instâncias por executor sem criar sessões nem escolher chip padrão',()=>{
 const runtime=createInstanceRuntime({ownerId:A,executorId:E,repository});
 for(let n=1;n<=48;n++)runtime.attach(driver(id(n)));
 assert.equal(runtime.list().length,48);assert.equal(new Set(runtime.list().map(d=>d.instanceId)).size,48);
 assert.throws(()=>runtime.attach(driver(id(1))),e=>e.code==='INSTANCE_ALREADY_ATTACHED');
 assert.throws(()=>runtime.attach(driver(id(49),'33333333-3333-4333-8333-333333333333')),e=>e.code==='INSTANCE_SCOPE_MISMATCH');
 assert.throws(()=>runtime.attach(driver('slot_1')),e=>e.code==='INVALID_INSTANCE_ID');
 runtime.detach(id(48));assert.equal(runtime.list().length,47);
});

const {fixture,command,snapshot,C}=await import('./helpers/instance-runtime-fixture.mjs');
test('dispatcher: envio explícito, política atual e recibo não significam entrega; repetição não reenvia',async()=>{
 const f=fixture(),r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository});r.attach(f.driver);const input=command();const result=await r.send(input);assert.equal(result.status,'accepted');assert.equal(result.delivered,false);assert.equal(result.queued,false);assert.equal(f.count(),1);assert.equal((await r.send(input)).duplicate,true);assert.equal(f.count(),1);await assert.rejects(r.send({...input,text:'Outro conteúdo'}),e=>e.code==='DISPATCH_CONFLICT');
 const changed=snapshot();changed.instance.aiEnabled=false;f.setSnapshot(changed);await assert.rejects(r.send({...command(),purpose:'ai'}),e=>e.code==='INSTANCE_AI_DISABLED');await assert.rejects(r.send({...command(),purpose:'campaign'}),e=>e.code==='INSTANCE_CAMPAIGNS_DISABLED');assert.equal(f.count(),1);
});
test('dispatcher: offline, conta/executor incorretos e revisão antiga bloqueiam sem fallback, fila ou envio',async()=>{
 const f=fixture(),r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository});r.attach(f.driver);f.setOnline(false);await assert.rejects(r.send(command()),e=>e.code==='INSTANCE_OFFLINE');f.setOnline(true);
 for(const input of [{...command(),ownerId:A},{...command(),instanceId:'slot_1'},{...command(),policyRevision:9}])await assert.rejects(r.send(input));const value=snapshot();value.assignment.executorOwnerId='33333333-3333-4333-8333-333333333333';f.setSnapshot(value);await assert.rejects(r.send(command()),e=>e.code==='INSTANCE_SCOPE_MISMATCH');assert.equal(f.count(),0);assert.equal(f.receipts.size,0);
});
test('dispatcher: timeout mantém instância ocupada; confirmação tardia reconcilia sem repetir',async()=>{
 const f=fixture(),r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository,timeoutMs:10});r.attach(f.driver);let settle;f.setBehavior(()=>new Promise(resolve=>settle=resolve));const input=command(),result=await r.send(input);assert.equal(result.status,'uncertain');assert.equal(result.canRetryAutomatically,false);assert.throws(()=>r.detach(C),e=>e.code==='INSTANCE_BUSY');await assert.rejects(r.send(command()),e=>e.code==='INSTANCE_BUSY');assert.equal(f.count(),1);settle({accepted:true,providerMessageId:'LATE_SYNTHETIC_ACK'});await new Promise(setImmediate);assert.equal((await r.send(input)).status,'accepted');assert.equal(f.count(),1);r.detach(C);
});
test('dispatcher: falha após começar fica incerta; confirmação perdida não é convertida em sucesso',async()=>{
 const f=fixture(),r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository});r.attach(f.driver);f.setBehavior(async()=>{throw Error('ERRO_PRIVADO_NAO_EXIBIR');});const result=await r.send(command());assert.equal(result.status,'uncertain');assert.equal(JSON.stringify(result).includes('ERRO_PRIVADO'),false);await assert.rejects(r.send(command()),e=>e.code==='INSTANCE_BUSY');assert.equal(f.count(),1);
});

test('dispatcher: inspeção que não responde expira sem reservar, reconectar ou enviar',async()=>{
 const f=fixture();let inspect;f.driver.inspect=()=>new Promise(resolve=>inspect=resolve);const r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository,timeoutMs:10});r.attach(f.driver);
 const result=await Promise.race([r.send(command()).then(()=>null,e=>e.code),new Promise(resolve=>setTimeout(()=>resolve('TEST_DEADLINE_EXCEEDED'),150))]);assert.equal(result,'INSTANCE_INSPECTION_TIMEOUT');assert.equal(f.count(),0);assert.equal(f.receipts.size,0);assert.equal(r.detach(C),true);inspect(null);
});

test('dispatcher: automação habilitada continua bloqueada até coordenador transacional; driver sem finalidade não é substituído',async()=>{
 const f=fixture(),value=snapshot();value.instance.aiEnabled=true;value.instance.campaignsEnabled=true;f.setSnapshot(value);const r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository});r.attach(f.driver);for(const purpose of ['ai','campaign'])await assert.rejects(r.send({...command(),purpose}),e=>e.code==='AUTOMATION_INTEGRATION_PENDING');assert.equal(f.count(),0);assert.equal(f.receipts.size,0);
 const other=fixture();other.driver.inspect=async()=>({...other.driver.identity,connected:true,observedAt:new Date().toISOString(),purposes:['ai']});const scoped=createInstanceRuntime({ownerId:A,executorId:E,repository:other.repository});scoped.attach(other.driver);await assert.rejects(scoped.send(command()),e=>e.code==='INSTANCE_CAPABILITY_UNAVAILABLE');assert.equal(other.count(),0);
});
test('dispatcher: prazo das portas e início perdido não acionam driver; erro privado do banco não é retornado',async()=>{
 const f=fixture();f.repository.start=()=>new Promise(()=>{});const r=createInstanceRuntime({ownerId:A,executorId:E,repository:f.repository,timeoutMs:10});r.attach(f.driver);await assert.rejects(r.send(command()),e=>e.code==='DISPATCH_START_UNCONFIRMED'&&!e.message.includes('PRIVADO'));assert.equal(f.count(),0);assert.equal([...f.receipts.values()][0].state,'uncertain');
 const other=fixture();other.repository.resolve=()=>new Promise(()=>{});const limited=createInstanceRuntime({ownerId:A,executorId:E,repository:other.repository,timeoutMs:10});limited.attach(other.driver);await assert.rejects(limited.send(command()),e=>e.code==='DISPATCH_REPOSITORY_TIMEOUT');assert.equal(other.count(),0);assert.equal(other.receipts.size,0);
});

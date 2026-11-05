import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createIngressJournal} from '../src/instances/ingressJournal.js';import {A,B,C} from './helpers/instance-runtime-fixture.mjs';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');const root=path.join(process.cwd(),'data','instance-journals');
const event=()=>({eventId:randomUUID(),leaseId:randomUUID(),executorId:randomUUID(),observedAt:new Date().toISOString(),event:{kind:'unprojected',wire:{synthetic:'DADO_PRIVADO_SINTETICO'}}});
test('journal: persiste antes do banco, reinicia sem perder, ack idempotente e nenhum arquivo de outra conta',()=>{
 let j=createIngressJournal({root,ownerId:A,instanceId:C});const e=event();j.append(e);assert.equal(j.stats().pending,1);assert.equal(JSON.stringify(j.stats()).includes('DADO_PRIVADO'),false);assert.throws(()=>createIngressJournal({root,ownerId:A,instanceId:C}),e=>e.code==='INGRESS_JOURNAL_LOCKED');j.close();j=createIngressJournal({root,ownerId:A,instanceId:C});assert.deepEqual(j.read()[0],e);const other=createIngressJournal({root,ownerId:B,instanceId:C});assert.deepEqual(other.read(),[]);other.close();j.ack(e.eventId);j.ack(e.eventId);assert.equal(j.stats().pending,0);j.close();
});
test('journal: limite de disco não apaga pendências, capabilities/ID inválidos e symlink são recusados',()=>{
 const j=createIngressJournal({root,ownerId:A,instanceId:randomUUID(),maxPendingBytes:2048});j.append(event());const e=event();e.event.wire.synthetic='x'.repeat(3000);assert.throws(()=>j.append(e),e=>e.code==='INGRESS_JOURNAL_FULL');assert.equal(j.stats().pending,1);assert.throws(()=>j.ack('../qualquer'));j.close();
 const target=path.join(process.cwd(),'data','synthetic-target');fs.mkdirSync(target,{mode:0o700});const link=path.join(process.cwd(),'data','journal-link');fs.symlinkSync(target,link);assert.throws(()=>createIngressJournal({root:link,ownerId:A,instanceId:C}));assert.throws(()=>createIngressJournal({root,ownerId:'slot_1',instanceId:C}));
});
test('journal: registros corrompidos nunca são apagados ou pulados silenciosamente',()=>{
 const id=randomUUID(),j=createIngressJournal({root,ownerId:A,instanceId:id}),e=event();j.append(e);j.close();const file=path.join(root,A,id,e.eventId+'.json');fs.writeFileSync(file,'{INCOMPLETO');const reopened=createIngressJournal({root,ownerId:A,instanceId:id});assert.throws(()=>reopened.read(),e=>e.code==='INGRESS_JOURNAL_CORRUPT');assert.equal(fs.existsSync(file),true);reopened.close();
});

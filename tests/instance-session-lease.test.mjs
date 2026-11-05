import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createInstanceSqlFixture,A,B,E} from './helpers/instance-sql-fixture.mjs';
const f=await createInstanceSqlFixture();test.after(()=>f.close());const c=await f.createLocal();const SELF='558600000001@s.whatsapp.net';let lease;
const claim=(id=randomUUID(),instance=c.id)=>f.call('ienvia_claim_instance_session',[A,instance,E,1,id,SELF]);
test('lease SQL: aquisição exclusiva, resposta repetida sem capability e ausência de teto de três',async()=>{
 await f.as('', 'service_role');const id=randomUUID();lease=await claim(id);assert.equal(lease.claimed,true);assert.ok(lease.leaseId);const duplicate=await claim(id);assert.equal(duplicate.claimed,false);assert.equal(duplicate.leaseId,null);await assert.rejects(claim(),e=>e.code==='55000');
 for(let i=0;i<8;i++){const next=await f.createLocal();await f.as('', 'service_role');assert.equal((await claim(randomUUID(),next.id)).claimed,true);}
});
test('lease SQL: token/conta incorretos, browser e executor incompatível não renovam nem consultam sessão',async()=>{
 await f.as('', 'service_role');await assert.rejects(f.call('ienvia_check_instance_session',[B,c.id,E,lease.leaseId]),e=>e.code==='42501');await assert.rejects(f.call('ienvia_check_instance_session',[A,c.id,E,randomUUID()]),e=>e.code==='42501');await f.as(A);await assert.rejects(claim(),e=>e.code==='42501');await assert.rejects(f.db.query('SELECT * FROM public.ienvia_instance_session_leases'),e=>e.code==='42501');
});
test('lease SQL: vencimento não permite takeover enquanto há despacho incerto; revisão de assignment também cerca o processo antigo',async()=>{
 await f.as('', 'service_role');const r=await f.call('ienvia_reserve_instance_dispatch',[A,c.id,E,randomUUID(),'a'.repeat(64),1,1,'manual']);await f.call('ienvia_start_instance_dispatch',[A,c.id,E,r.requestId,r.ticket]);await f.call('ienvia_finish_instance_dispatch',[A,c.id,E,r.requestId,r.ticket,'uncertain',null]);await f.db.exec('RESET ROLE');await f.db.query("UPDATE public.ienvia_instance_session_leases SET expires_at=now()-interval '1 second' WHERE lease_id=$1",[lease.leaseId]);await f.as('', 'service_role');await assert.rejects(claim(),e=>e.code==='55000');await assert.rejects(f.call('ienvia_renew_instance_session',[A,c.id,E,lease.leaseId]),e=>e.code==='42501');await assert.rejects(f.call('ienvia_release_instance_session',[A,c.id,E,lease.leaseId]),e=>e.code==='55000');
 await f.call('ienvia_finish_instance_dispatch',[A,c.id,E,r.requestId,r.ticket,'accepted','SYNTHETIC_ACK']);const replacement=await claim();assert.notEqual(replacement.leaseId,lease.leaseId);await assert.rejects(f.call('ienvia_check_instance_session',[A,c.id,E,lease.leaseId]),e=>e.code==='42501');assert.equal((await f.call('ienvia_release_instance_session',[A,c.id,E,replacement.leaseId])).released,true);
});

test('lease SQL: renovar/reconfigurar não reutiliza capability anterior; claim repetido com self diferente conflita',async()=>{
 const x=await f.createLocal();await f.as('', 'service_role');const id=randomUUID(),l=await claim(id,x.id);assert.equal((await f.call('ienvia_renew_instance_session',[A,x.id,E,l.leaseId])).leaseId,l.leaseId);await assert.rejects(f.call('ienvia_claim_instance_session',[A,x.id,E,1,id,'558600000009@s.whatsapp.net']),e=>e.code==='40001');await f.as(A);await f.call('ienvia_assign_instance_executor',[x.id,E,1,true]);await f.as('', 'service_role');await assert.rejects(f.call('ienvia_check_instance_session',[A,x.id,E,l.leaseId]),e=>e.code==='42501');
});

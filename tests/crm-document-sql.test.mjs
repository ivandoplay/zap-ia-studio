import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createInstanceSqlFixture,A,B,M} from './helpers/instance-sql-fixture.mjs';
const f=await createInstanceSqlFixture();test.after(()=>f.close());
test('CRM documento SQL: guarda texto da ficha com CAS e busca literal sem ligar automação',async()=>{
 await f.enableCrmWrites(A);await f.as(A);const c=(await f.call('ienvia_crm_create_contact',[randomUUID(),{name:'Pessoa sintética',phone:'+558600000077'}])).contact;
 const updated=await f.call('ienvia_crm_update_contact',[c.id,1,{docNumber:'000.000.000-00'}]);assert.equal(updated.contact.profile.docNumber,'000.000.000-00');assert.equal(updated.contact.revision,2);
 assert.equal((await f.call('ienvia_crm_list_contacts',[A,20,null,'000.000.000-00',null,'all',null])).items[0].id,c.id);
});
test('CRM documento SQL: extensão mantém bloqueios, helpers privados e isolamento de conta',async()=>{
 await f.as(A);const page=await f.call('ienvia_crm_list_contacts',[A,20,null,'000.000.000-00',null,'all',null]),c=page.items[0];
 for(const value of ['x'.repeat(41),'x\n',1,null])await assert.rejects(f.call('ienvia_crm_update_contact',[c.id,2,{docNumber:value}]),e=>e.code==='22023');
 await assert.rejects(f.call('ienvia_crm_profile_patch',[{docNumber:'x'}]),e=>e.code==='42501');
 await f.as(B);await assert.rejects(f.call('ienvia_crm_get_contact',[A,c.id]),e=>e.code==='42501');
 await f.as(M);assert.equal((await f.call('ienvia_crm_get_contact',[A,c.id])).contact.profile.docNumber,'000.000.000-00');await assert.rejects(f.call('ienvia_crm_update_contact',[c.id,2,{docNumber:'NAO_ALTERAR'}]),e=>e.code==='55000'||e.code==='P0002');
 await f.as('','anon');await assert.rejects(f.call('ienvia_crm_get_contact',[A,c.id]),e=>e.code==='42501');
});
test('CRM documento SQL: upgrade não regrava ficha/revisão nem habilita escrita em contas antigas',async()=>{
 const old=await createInstanceSqlFixture({crmDocument:false});try{await old.enableCrmWrites(A);await old.as(A);const c=(await old.call('ienvia_crm_create_contact',[randomUUID(),{name:'Ficha pré-extensão',phone:'+558600000066'}])).contact;assert.equal(Object.hasOwn(c.profile,'docNumber'),false);
 await old.db.exec('RESET ROLE');await old.db.query('UPDATE public.ienvia_crm_write_accounts SET enabled=false');const before=(await old.db.query('SELECT profile::text,revision,updated_at FROM public.ienvia_crm_contacts WHERE id=$1',[c.id])).rows;
 await old.db.exec(readFileSync(new URL('../supabase/migrations/20261104008000_crm_documento_busca.sql',import.meta.url),'utf8'));const after=(await old.db.query('SELECT profile::text,revision,updated_at FROM public.ienvia_crm_contacts WHERE id=$1',[c.id])).rows;assert.deepEqual(after,before);
 await old.as(A);const read=await old.call('ienvia_crm_get_contact',[A,c.id]);assert.equal(read.contact.profile.docNumber,'');assert.equal(read.contact.revision,1);assert.equal(read.writesEnabled,false);await assert.rejects(old.call('ienvia_crm_update_contact',[c.id,1,{docNumber:'000.000.000-00'}]),e=>e.code==='55000');
 }finally{await old.close();}
});
test('CRM busca SQL: e-mail, origem, responsável e anotação são literais e não pesquisam outros tenants',async()=>{
 await f.as(A);const c=(await f.call('ienvia_crm_create_contact',[randomUUID(),{name:'Busca campos ficha',phone:'+558600000055',email:'ficha@exemplo.invalid',leadSource:'Feira exclusiva'}])).contact;
 await f.call('ienvia_crm_update_contact',[c.id,1,{assignee:'Pessoa do balcão',note:'Nota literal 100%_'}]);
 for(const q of ['ficha@exemplo.invalid','Feira exclusiva','Pessoa do balcão','100%_'])assert.equal((await f.call('ienvia_crm_list_contacts',[A,20,null,q,null,'all',null])).items[0].id,c.id);
 assert.equal((await f.call('ienvia_crm_list_contacts',[A,20,null,'100___',null,'all',null])).items.length,0);await f.enableCrmWrites(B);await f.as(B);assert.equal((await f.call('ienvia_crm_list_contacts',[B,20,null,'100%_',null,'all',null])).items.length,0);
});

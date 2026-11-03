import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const campaign='33333333-3333-4333-8333-333333333333',recipient='44444444-4444-4444-8444-444444444444',attempt='55555555-5555-4555-8555-555555555555';
const db=new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.zapia_users(user_id uuid PRIMARY KEY,is_active boolean,max_wa_slots integer,role text);
 CREATE FUNCTION public.zapia_is_user_active(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT is_active FROM public.zapia_users WHERE user_id=p $$;
 CREATE TABLE public.zapia_workspaces(user_id uuid PRIMARY KEY,settings jsonb);
 CREATE TABLE public.zapia_contacts(user_id uuid,chat_id text,data jsonb,last_message_at timestamptz,updated_at timestamptz,PRIMARY KEY(user_id,chat_id));
 CREATE TABLE public.ienvia_campanhas_controle(owner_id uuid,campanha_id uuid,status text);
 CREATE TABLE public.ienvia_campanha_destinatarios(owner_id uuid,campanha_id uuid,destinatario_id uuid,telefone text);
 CREATE TABLE public.ienvia_campanha_checkpoints(owner_id uuid,campanha_id uuid,destinatario_id uuid,etapa integer,tentativa_id uuid,status text,material jsonb);
 INSERT INTO public.zapia_users VALUES('${owner}',true,1,'user'),('${other}',true,3,'user');
 INSERT INTO public.zapia_workspaces VALUES('${owner}','{}');
 INSERT INTO public.ienvia_campanhas_controle VALUES('${owner}','${campaign}','ativa');
 INSERT INTO public.ienvia_campanha_destinatarios VALUES('${owner}','${campaign}','${recipient}','558600000000');
 INSERT INTO public.ienvia_campanha_checkpoints VALUES('${owner}','${campaign}','${recipient}',0,'${attempt}','em_envio','{"slotId":"slot_1","provedor":"evolution_api"}');
`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261103120000_evolution_ingress_send_safety.sql',import.meta.url),'utf8'));
test.after(()=>db.close());
async function merge(chat,messages=[],options={}) {
 const {rows}=await db.query('SELECT public.ienvia_merge_evolution_contact($1,$2,$3,$4,$5,$6,$7,$8) AS result',[owner,chat,JSON.stringify(messages),'',options.event||'',options.ackId||'',options.ack||0,JSON.stringify(options.patch||{})]);
 return rows[0].result;
}
const msg=(id,text='Olá',extra={})=>({id,waMsgId:id,role:'user',text,timestamp:'2026-11-03T12:00:00Z',...extra});
test('SQL: migração compila em PostgreSQL embarcado; trava tentativa e isola tenant',async()=>{
 await db.query("SELECT set_config('test.uid',$1,false)",[other]);
 const claim=()=>db.query('SELECT public.ienvia_claim_evolution_send($1,$2,0,$3,\'slot_1\') AS claimed',[campaign,recipient,attempt]);
 assert.equal((await claim()).rows[0].claimed,false);
 await db.query("SELECT set_config('test.uid',$1,false)",[owner]);
 assert.equal((await claim()).rows[0].claimed,true);
 assert.equal((await claim()).rows[0].claimed,false);
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.ienvia_evolution_send_claims')).rows[0].n,1);
});
test('SQL: ingresso repetido é idempotente e não elimina histórico ou metadados',async()=>{
 const chat='a@s.whatsapp.net';
 await db.query('INSERT INTO public.zapia_contacts(user_id,chat_id,data) VALUES($1,$2,$3)',[owner,chat,JSON.stringify({stage:'venda',notes:'nota sintética',messages:[msg('old')]})]);
 const first=await merge(chat,[msg('new')],{event:'message:new'});
 assert.equal(first.inserted,true);assert.equal(first.contact.stage,'venda');
 const second=await merge(chat,[msg('new')],{event:'message:new'});
 assert.equal(second.inserted,false);assert.equal(second.contact.messages.length,2);assert.equal(second.contact.notes,'nota sintética');
 await merge(chat,[],{patch:{aiIgnored:true,pausedUntil:'forever',role:'master'}});
 const patched=await merge(chat);assert.equal(patched.contact.aiIgnored,true);assert.equal(patched.contact.role,undefined);
});
test('SQL: ACK antes da mensagem não se perde e nunca regride',async()=>{
 const chat='b@s.whatsapp.net';
 await merge(chat,[],{ackId:'s1',ack:3});
 const first=await merge(chat,[msg('s1','Saída',{role:'owner',deliveryStatus:'accepted'})]);
 assert.equal(first.contact.messages[0].ack,3);assert.equal(first.contact.messages[0].deliveryStatus,undefined);
 const second=await merge(chat,[],{ackId:'s1',ack:1});assert.equal(second.contact.messages[0].ack,3);
});
test('SQL: callback de saída e confirmação IA convergem por ID, não por texto',async()=>{
 const chat='c@s.whatsapp.net';
 await merge(chat,[{id:'pending',role:'assistant',text:'igual',timestamp:'2026-11-03T12:00:00Z',deliveryStatus:'uncertain'}]);
 await merge(chat,[msg('provider','igual',{role:'owner'})]);
 const result=await merge(chat,[{id:'pending',waMsgId:'provider',role:'assistant',text:'igual',timestamp:'2026-11-03T12:00:00Z',deliveryStatus:'accepted'}]);
 assert.equal(result.contact.messages.length,1);assert.equal(result.contact.messages[0].role,'assistant');
 const otherSend=await merge(chat,[msg('provider-2','igual',{role:'owner'})]);assert.equal(otherSend.contact.messages.length,2);
});
test('SQL: tombstone não ressuscita mensagens antigas e histórico não é truncado em 120',async()=>{
 const chat='d@s.whatsapp.net';
 await db.query('INSERT INTO public.zapia_contacts(user_id,chat_id,data) VALUES($1,$2,$3)',[owner,chat,JSON.stringify({historyClearedAt:'2026-11-03T11:00:00Z',messages:[]})]);
 const r=await merge(chat,[msg('old','passado',{timestamp:'2026-11-02T12:00:00Z'}),...Array.from({length:150},(_,i)=>msg(`n${i}`))]);
 assert.equal(r.contact.messages.length,150);
});
test('SQL: projeção é exclusiva de service_role e tabelas de controle têm RLS',async()=>{
 const {rows}=await db.query("SELECT has_function_privilege('authenticated','public.ienvia_merge_evolution_contact(uuid,text,jsonb,text,text,text,integer,jsonb)','EXECUTE') AS allowed,has_function_privilege('service_role','public.ienvia_merge_evolution_contact(uuid,text,jsonb,text,text,text,integer,jsonb)','EXECUTE') AS service");
 assert.equal(rows[0].allowed,false);assert.equal(rows[0].service,true);
 const tables=await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('ienvia_evolution_ingress','ienvia_evolution_send_claims')");assert.ok(tables.rows.every(x=>x.relrowsecurity));
});

test('SQL: saída de campanha mantém campaignId e não inventa ACK',async()=>{
 await db.query("SELECT set_config('test.uid',$1,false)",[owner]);
 await db.query("UPDATE public.ienvia_campanha_checkpoints SET material=material || $1::jsonb",[JSON.stringify({bloco:{tipo:'texto',texto:'Campanha sintética'}})]);
 const {rows}=await db.query('SELECT public.ienvia_record_evolution_campaign_send($1,$2,0,$3,$4) AS recorded',[campaign,recipient,attempt,'campaign-out-1']);assert.equal(rows[0].recorded,true);
 const row=(await db.query("SELECT data FROM public.zapia_contacts WHERE user_id=$1 AND chat_id='558600000000@s.whatsapp.net'",[owner])).rows[0];
 assert.equal(row.data.messages[0].campaignId,campaign);assert.equal(row.data.messages[0].deliveryStatus,'accepted');assert.equal(row.data.messages[0].ack,undefined);
});
test('SQL: conta inativa, campanha pausada e opt-out impedem claim novo',async()=>{
 const newAttempt='66666666-6666-4666-8666-666666666666';
 await db.query('UPDATE public.ienvia_campanha_checkpoints SET tentativa_id=$1',[newAttempt]);
 const claim=()=>db.query("SELECT public.ienvia_claim_evolution_send($1,$2,0,$3,'slot_1') AS claimed",[campaign,recipient,newAttempt]);
 await db.query("UPDATE public.ienvia_campanhas_controle SET status='pausada'");assert.equal((await claim()).rows[0].claimed,false);
 await db.query("UPDATE public.ienvia_campanhas_controle SET status='ativa'");
 await db.query('UPDATE public.zapia_users SET is_active=false WHERE user_id=$1',[owner]);assert.equal((await claim()).rows[0].claimed,false);
 await db.query('UPDATE public.zapia_users SET is_active=true WHERE user_id=$1',[owner]);
 await merge('558600000000@s.whatsapp.net',[],{patch:{aiIgnored:true}});assert.equal((await claim()).rows[0].claimed,false);
 await merge('558600000000@s.whatsapp.net',[],{patch:{aiIgnored:false}});assert.equal((await claim()).rows[0].claimed,true);
});

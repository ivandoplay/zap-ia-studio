import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

// Somente PostgreSQL embarcado e fixtures sintéticas. Nenhuma API externa é chamada.
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE public.zapia_users(user_id uuid PRIMARY KEY,is_active boolean);
CREATE FUNCTION public.zapia_is_user_active(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT is_active FROM public.zapia_users WHERE user_id=p $$;
INSERT INTO public.zapia_users VALUES('${owner}',true),('${other}',true);`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261029023945_ienvia_campanhas_migracao_integral.sql',import.meta.url),'utf8'));
const asOwner=()=>db.query("SELECT set_config('test.uid',$1,false)",[owner]);
async function fixture(options={}){
 await asOwner();
 const plan={nome:'Fixture sem envio externo',chips:['slot_1'],modoChips:'fixo',retomada:'manual',blocos:[{id:randomUUID(),tipo:'texto',modo:'fixo',textos:['Mensagem sintética']} ]};
 const created=await db.query('SELECT * FROM public.ienvia_criar_campanha($1,$2,$3)',[JSON.stringify(plan),JSON.stringify({intervalo_min_ms:0,intervalo_max_ms:0,intervalo_etapas_ms:0,pausa_lote_min_ms:0,pausa_lote_max_ms:0,lote_min:1,lote_max:1,fuso:'UTC',...options}),JSON.stringify([{telefone:'558600000000',nome:'Sintético',campos:{}}])]);
 const cid=created.rows[0].campanha_id;
 await db.query("SELECT * FROM public.ienvia_alterar_status_campanha($1,'ativa')",[cid]);
 const c=(await db.query('SELECT * FROM public.ienvia_campanhas_controle WHERE campanha_id=$1',[cid])).rows[0];
 const d=(await db.query('SELECT * FROM public.ienvia_campanha_destinatarios WHERE campanha_id=$1',[cid])).rows[0];
 const worker=randomUUID();await db.query("SELECT public.ienvia_registrar_worker_campanha($1,'fixture-sql')",[worker]);
 return {c,d,worker};
}
const material=provider=>({slotId:'slot_1',...(provider===undefined?{}:{provedor:provider}),bloco:{tipo:'texto',texto:'Mensagem sintética'}});
async function reserve(f,m=material('evolution_api'),revision=f.c.revisao){return db.query('SELECT * FROM public.ienvia_reservar_worker_campanha($1,$2,0,$3,$4,$5,$6)',[f.c.campanha_id,f.d.destinatario_id,randomUUID(),JSON.stringify(m),revision,f.worker]);}
const before=await fixture();
const baseline=(await reserve(before)).rows.length;
await db.exec(readFileSync(new URL('../supabase/migrations/20261103153731_campaign_reservation_provider_compat.sql',import.meta.url),'utf8'));
test.after(()=>db.close());

test('SQL real: reproduz original rejeitando provedor e corrige o mesmo checkpoint',async()=>{
 assert.equal(baseline,0);await asOwner();const result=await reserve(before);assert.equal(result.rows.length,1);assert.equal(result.rows[0].material.provedor,'evolution_api');assert.equal(result.rows[0].status,'em_envio');
});
test('SQL real: Baileys explícito e material legado permanecem compatíveis',async()=>{
 for(const provider of ['baileys',undefined]){const f=await fixture();const r=await reserve(f,material(provider));assert.equal(r.rows.length,1);assert.deepEqual(r.rows[0].material,material(provider));}
});
test('SQL real: rejeita provedor desconhecido, null, vazio ou tipo não string',async()=>{
 const f=await fixture();for(const provider of ['unknown','',null,false,42,{}])assert.equal((await reserve(f,material(provider))).rows.length,0);
 assert.equal((await reserve(f)).rows.length,1);
});
test('SQL real: campo extra e material de chip diferente continuam rejeitados',async()=>{
 const f=await fixture();assert.equal((await reserve(f,{...material('evolution_api'),extra:true})).rows.length,0);assert.equal((await reserve(f,{...material('evolution_api'),slotId:'slot_2'})).rows.length,0);
});
test('SQL real: isola titular, exige conta ativa e revisão atual',async()=>{
 const f=await fixture();await db.query("SELECT set_config('test.uid',$1,false)",[other]);assert.equal((await reserve(f)).rows.length,0);
 await asOwner();assert.equal((await reserve(f,material('evolution_api'),Number(f.c.revisao)-1)).rows.length,0);
 await db.query('UPDATE public.zapia_users SET is_active=false WHERE user_id=$1',[owner]);assert.equal((await reserve(f)).rows.length,0);await db.query('UPDATE public.zapia_users SET is_active=true WHERE user_id=$1',[owner]);assert.equal((await reserve(f)).rows.length,1);
});
test('SQL real: pausa e agendamento futuro continuam bloqueando reserva',async()=>{
 const f=await fixture();await db.query("SELECT * FROM public.ienvia_alterar_status_campanha($1,'pausada')",[f.c.campanha_id]);assert.equal((await reserve(f)).rows.length,0);
 const scheduled=await fixture({inicio_em:new Date(Date.now()+3600000).toISOString()});assert.equal((await reserve(scheduled)).rows.length,0);
});
test('SQL real: janela de horário futura não é contornada pela compatibilidade',async()=>{
 const start=new Date(Date.now()+3600000).toISOString().slice(11,16),end=new Date(Date.now()+7200000).toISOString().slice(11,16);
 const f=await fixture({restricao_horaria:true,dias:[0,1,2,3,4,5,6],inicio:start,fim:end});assert.equal((await reserve(f)).rows.length,0);
});
test('SQL real: preserva material incerto revisado e impede segunda reserva simultânea',async()=>{
 const f=await fixture();const first=(await reserve(f)).rows[0];f.c=(await db.query('SELECT * FROM public.ienvia_campanhas_controle WHERE campanha_id=$1',[f.c.campanha_id])).rows[0];assert.equal((await reserve(f)).rows.length,0);
 await db.query("UPDATE public.ienvia_campanha_checkpoints SET status='pendente',tentativa_id=NULL WHERE campanha_id=$1",[f.c.campanha_id]);
 assert.equal((await reserve(f,{...material('evolution_api'),bloco:{tipo:'texto',texto:'Substituição indevida'}})).rows.length,0);
 const retry=(await reserve(f)).rows[0];assert.deepEqual(retry.material,first.material);
});
test('SQL real: não amplia grants ou desativa RLS',async()=>{
 const q=await db.query("SELECT has_function_privilege('anon','ienvia_private.reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint)','EXECUTE') AS anonymous,has_function_privilege('authenticated','ienvia_private.reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint)','EXECUTE') AS direct_private,has_function_privilege('authenticated','public.ienvia_reservar_worker_campanha(uuid,uuid,integer,uuid,jsonb,bigint,uuid)','EXECUTE') AS worker");
 assert.deepEqual(q.rows[0],{anonymous:false,direct_private:false,worker:true});assert.equal((await db.query("SELECT bool_and(relrowsecurity) AS enabled FROM pg_class WHERE relname IN ('ienvia_campanhas_controle','ienvia_campanha_checkpoints')")).rows[0].enabled,true);
});

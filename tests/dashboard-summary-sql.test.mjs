import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',M='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444';
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
 CREATE TABLE public.zapia_users(user_id uuid PRIMARY KEY,is_active boolean,role text);
 CREATE FUNCTION public.zapia_is_user_active(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT is_active FROM public.zapia_users WHERE user_id=p $$;
 CREATE TABLE public.zapia_contacts(user_id uuid,chat_id text,data jsonb,last_message_at timestamptz);
 CREATE TABLE public.ienvia_campanhas_controle(owner_id uuid,campanha_id uuid,status text);
 INSERT INTO public.zapia_users VALUES('${A}',true,'user'),('${B}',true,'user'),('${M}',true,'master'),('${I}',false,'user');
 INSERT INTO public.zapia_contacts SELECT '${A}','chat-'||n,jsonb_build_object('stage',CASE WHEN n<=7 THEN 'aguardando_humano' ELSE 'novo' END,'messages','["não expor histórico"]'::jsonb),now() FROM generate_series(1,1001)n;
 INSERT INTO public.zapia_contacts VALUES('${B}','private','{"stage":"aguardando_humano"}',now());
 INSERT INTO public.zapia_contacts VALUES('${A}','old','{}',now()-interval '40 days');
 INSERT INTO public.ienvia_campanhas_controle SELECT '${A}',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=1 THEN 'pausada' ELSE 'rascunho' END FROM generate_series(1,137)n;
 INSERT INTO public.ienvia_campanhas_controle VALUES('${B}','00000000-0000-4000-8000-999999999999','ativa');`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261103230000_dashboard_resumo_e_aparencia.sql',import.meta.url),'utf8'));
test.after(()=>db.close());
async function as(id,role='authenticated'){await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[id]);await db.exec(`SET ROLE ${role}`);}
async function summary(id=A){return (await db.query('SELECT public.ienvia_dashboard_summary_v1($1) AS v',[id])).rows[0].v;}
test('SQL: totais exatos >500 contatos e >100 campanhas, 7 dias honestos, sem conteúdo privado',async()=>{
 await as(A);const data=await summary();assert.deepEqual(data.counts,{conversations:1002,pendingHuman:7,campaigns:137});assert.equal(data.activity.length,7);assert.equal(data.activity.reduce((n,d)=>n+d.value,0),1001);assert.equal(data.campaigns.paused,1);assert.equal(data.campaigns.active,0);assert.equal(JSON.stringify(data).includes('não expor'),false);assert.equal(data.tenantId,A);
});
test('SQL: pessoa comum não pode ler outra conta nem executar como anônimo/inativo',async()=>{
 await as(B);await assert.rejects(summary(A),e=>e.code==='42501');await as(I);await assert.rejects(summary(I),e=>e.code==='42501');await as('');await assert.rejects(summary(A),e=>e.code==='42501');await as(A,'anon');await assert.rejects(summary(A),e=>e.code==='42501');
});
test('SQL: master ativo tem resumo do alvo, mas tema continua no operador real',async()=>{
 await as(M);assert.equal((await summary(A)).counts.conversations,1002);
 await db.query("SELECT public.ienvia_set_appearance('light')");const own=await db.query('SELECT user_id,theme FROM public.ienvia_user_appearance');assert.deepEqual(own.rows,[{user_id:M,theme:'light'}]);
 await as(A);assert.deepEqual((await db.query('SELECT * FROM public.ienvia_user_appearance')).rows,[]);await db.query("SELECT public.ienvia_set_appearance('dark')");
 await as(M);assert.deepEqual((await db.query('SELECT user_id,theme FROM public.ienvia_user_appearance')).rows,[{user_id:M,theme:'light'}]);
});
test('SQL: preferência rejeita tema inválido, escrita direta e inativo; resumo não altera registros',async()=>{
 await as(A);await assert.rejects(db.query("SELECT public.ienvia_set_appearance('false')"),e=>e.code==='22023');await assert.rejects(db.query(`UPDATE public.ienvia_user_appearance SET theme='light' WHERE user_id='${M}'`),e=>e.code==='42501');
 const before=await summary();await summary();assert.deepEqual((await summary()).counts,before.counts);
 await as(I);await assert.rejects(db.query("SELECT public.ienvia_set_appearance('light')"),e=>e.code==='42501');await as(M);await assert.rejects(summary(I),e=>e.code==='42501');
});

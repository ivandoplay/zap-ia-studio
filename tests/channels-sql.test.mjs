import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');
const db=new PGlite(),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',M='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;CREATE TABLE public.zapia_users(user_id uuid PRIMARY KEY,is_active boolean,role text);CREATE FUNCTION public.zapia_is_user_active(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT is_active FROM public.zapia_users WHERE user_id=p $$;INSERT INTO public.zapia_users VALUES('${A}',true,'user'),('${B}',true,'user'),('${M}',true,'master'),('${I}',false,'user');`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261103233000_canais_independentes.sql',import.meta.url),'utf8'));
test.after(()=>db.close());
async function as(id,role='authenticated'){await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[id]);await db.exec(`SET ROLE ${role}`);}
const create=async body=>(await db.query('SELECT public.ienvia_create_channel($1::jsonb) v',[JSON.stringify(body)])).rows[0].v;
const list=async(owner=A,limit=20,after=null,visibility='all',q='')=>(await db.query('SELECT public.ienvia_list_channels($1,$2,$3,$4,$5) v',[owner,limit,after,visibility,q])).rows[0].v;
const update=async(c,patch,revision=c.revision)=>(await db.query('SELECT public.ienvia_update_channel($1,$2,$3::jsonb) v',[c.id,revision,JSON.stringify(patch)])).rows[0].v;
test('SQL canais: cadastro acima de três, defaults seguros, filtros e paginação sem perda',async()=>{
 await as(A);for(let n=1;n<=57;n++)await create({name:`Canal ${n}`,transport:'evolution_api',tags:n%2?['Atendimento']:['Campanhas']});
 const ids=new Set();let cursor=null;do{const page=await list(A,11,cursor);assert.equal(page.total,57);assert.ok(page.items.length<=11);for(const item of page.items){assert.equal(ids.has(item.id),false);ids.add(item.id);assert.equal(item.crmVisible,true);assert.equal(item.aiEnabled,false);assert.equal(item.campaignsEnabled,false);}cursor=page.nextCursor;}while(cursor);assert.equal(ids.size,57);assert.equal((await list(A,50,null,'all','atendimento')).total,29);
});
test('SQL canais: ocultar conserva registro; configurações independentes e revisão concorrente',async()=>{
 await as(A);const c=(await list()).items[0],next=await update(c,{crmVisible:false,aiEnabled:true});assert.equal(next.crmVisible,false);assert.equal(next.aiEnabled,true);assert.equal(next.campaignsEnabled,false);assert.equal((await list()).total,57);assert.equal((await list(A,20,null,'hidden')).total,1);
 await assert.rejects(update(c,{name:'Sobrescrever revisão antiga'}),e=>e.code==='40001');
 for(const patch of [{aiEnabled:'false'},{ownerId:B},{transport:'local_worker'},{crmVisible:null},{tags:['x'.repeat(25)]}])await assert.rejects(update(next,patch),e=>e.code==='22023');
});
test('SQL canais: isolamento, master apenas lê alvo, usuário inativo e escrita direta bloqueados',async()=>{
 await as(B);const own=await create({name:'Privado B',transport:'local_worker'});assert.equal((await list(B)).total,1);await assert.rejects(list(A),e=>e.code==='42501');
 await as(M);assert.equal((await list(A)).total,57);assert.deepEqual((await db.query('SELECT * FROM public.ienvia_channels')).rows,[]);await assert.rejects(update(own,{crmVisible:false}),e=>e.code==='P0002');
 await as(A);await assert.rejects(db.query('UPDATE public.ienvia_channels SET crm_visible=false'),e=>e.code==='42501');await assert.rejects(db.query('DELETE FROM public.ienvia_channels'),e=>e.code==='42501');
 await as(I);await assert.rejects(list(I),e=>e.code==='42501');await assert.rejects(create({name:'Inativo',transport:'evolution_api'}),e=>e.code==='42501');await as(A,'anon');await assert.rejects(list(A),e=>e.code==='42501');
});

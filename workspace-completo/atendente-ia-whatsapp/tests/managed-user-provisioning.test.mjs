import assert from 'node:assert/strict';assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';process.env.SUPABASE_SERVICE_ROLE_KEY='chave-administrativa-sintetica';
const uid='11111111-1111-4111-8111-111111111111';let failure='',profileWrites=0,authCreates=0;
globalThis.fetch=async(input,opts={})=>{const url=new URL(typeof input==='string'?input:input.url),method=String(opts.method||'GET').toUpperCase();const res=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});
 if(url.pathname==='/auth/v1/admin/users'&&method==='POST'){authCreates++;return res({id:uid,email:'teste@zapia.local'})}
 if(url.pathname.startsWith('/rest/v1/zapia_')){const tab=url.pathname.split('/').pop();if(method==='GET')return failure==='consulta'?res({message:'erro'},403):res([]);if(tab==='zapia_users')profileWrites++;return tab===failure?res({message:'falha sintética'},403):res(null,201)}
 throw Error('Endpoint inesperado: '+url.pathname);
};
const {createManagedUser}=await import('../src/supabaseCloud.js');const create=()=>createManagedUser({username:'teste',password:'senha-sintetica',displayName:'Teste'});
for(const f of ['consulta','zapia_workspaces','zapia_wa_runtime','zapia_users']){failure=f;profileWrites=0;let before=authCreates;await assert.rejects(create,/conta|cadastro|provision|perfil|consult/i,`falha em ${f} não pode informar sucesso`);if(f==='consulta')assert.equal(authCreates,before,'não criar Auth com consulta inconclusiva');if(f==='zapia_workspaces'||f==='zapia_wa_runtime')assert.equal(profileWrites,0,'não ativar perfil com provisionamento incompleto')}
failure='';profileWrites=0;const result=await create();assert.equal(result.userId,uid);assert.equal(profileWrites,1);console.log('OK: criação é aprovada apenas com provisionamento completo; falhas são sinalizadas.');

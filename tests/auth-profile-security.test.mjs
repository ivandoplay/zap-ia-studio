import assert from 'node:assert/strict';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Usar apenas cópia isolada');
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:19999';process.env.SUPABASE_ANON_KEY='chave-publica-sintetica';
const uid='11111111-1111-4111-8111-111111111111',header=Buffer.from('{}').toString('base64url'),payload=Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),token=`${header}.${payload}.fake`;
const user={id:uid,email:'teste@zapia.local',user_metadata:{username:'teste'}};const session={access_token:token,refresh_token:'refresh-sintetico',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};let scenario='missing',profileWrites=0;
const origFetch=globalThis.fetch;
globalThis.fetch=async(input,opts={})=>{const url=new URL(typeof input==='string'?input:input.url);const method=String(opts.method||'GET').toUpperCase();const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 if(url.pathname==='/auth/v1/user')return response(user);
 if(url.pathname==='/auth/v1/token')return response(session);
 if(url.pathname==='/rest/v1/zapia_users'){
  if(method!=='GET'){profileWrites++;return response({code:'42501',message:'simulado'},403)}
  if(scenario==='error')return response({message:'erro sintético'},403);
  if(scenario==='missing')return response([]);
  return response([{user_id:scenario==='wrong'?'22222222-2222-4222-8222-222222222222':uid,username:'teste',display_name:'Teste',role:'user',is_active:scenario==='active'||scenario==='wrong'}]);
 }
 if(url.pathname==='/rest/v1/zapia_workspaces'||url.pathname==='/rest/v1/zapia_wa_runtime')return response([{user_id:uid}]);
 throw Error('Endpoint de teste inesperado: '+url.pathname);
};
try{
 const {signInWithUsernamePassword,refreshCloudSession,verifyCloudAccessToken}=await import('../src/supabaseCloud.js');
 for(const mode of ['missing','error','blocked','wrong']){
  scenario=mode;await assert.rejects(()=>signInWithUsernamePassword('teste','senha-sintetica'),/conta|perfil|validar|bloquead/i,`login ${mode} deve falhar`);
  await assert.rejects(()=>refreshCloudSession('refresh-sintetico'),/conta|perfil|validar|bloquead/i,`refresh ${mode} deve falhar`);
  await assert.rejects(()=>verifyCloudAccessToken(token),/conta|perfil|validar|bloquead/i,`verificação ${mode} deve falhar`);
 }
 assert.equal(profileWrites,0,'não criar perfil fictício pelo cliente');
 scenario='active';assert.equal((await signInWithUsernamePassword('teste','senha-sintetica')).user.id,uid);assert.equal((await refreshCloudSession('refresh-sintetico')).user.id,uid);assert.equal((await verifyCloudAccessToken(token)).profile.user_id,uid);
 console.log('OK: login, refresh e verificação recusam perfil ausente, bloqueado ou erro; perfil ativo funciona.');
}finally{globalThis.fetch=origFetch}

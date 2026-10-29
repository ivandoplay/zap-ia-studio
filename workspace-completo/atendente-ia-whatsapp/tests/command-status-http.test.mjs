import assert from 'node:assert/strict';
import http from 'node:http';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const command='d7f6575f-e5db-4097-9be4-1f03ff923ac9';
let queries=[];
const fake=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');const token=req.headers.authorization?.replace('Bearer ','');
  const uid=token==='usuario-a'?a:token==='usuario-b'?b:null;
  const respond=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/auth/v1/user')return uid?respond(200,{id:uid,email:'teste@local',user_metadata:{}}):respond(401,{message:'token inválido'});
  if(url.pathname==='/rest/v1/zapia_users')return respond(200,uid?[{user_id:uid,role:'user',is_active:true}]:[]);
  if(url.pathname==='/rest/v1/zapia_commands'){
    queries.push({user:url.searchParams.get('user_id'),id:url.searchParams.get('id')});
    assert.equal(url.searchParams.get('select'),'id,action,status,confirmed:result->sentRealWhatsApp');
    const ok=uid===a && url.searchParams.get('user_id')===`eq.${a}` && url.searchParams.get('id')===`eq.${command}`;
    return respond(200,ok?[{id:command,action:'send_crm_reply',status:'done',confirmed:true}]:[]);
  }
  return respond(500,{message:'endpoint inesperado no teste: '+url.pathname});
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
process.env.VERCEL='1';process.env.SUPABASE_URL=`http://127.0.0.1:${fake.address().port}`;process.env.SUPABASE_ANON_KEY='chave-de-teste';
let server;
try {
 const {app}=await import('../src/server.js');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=(id,token,headers={})=>fetch(`${base}/api/cloud/commands/${id}/status`,{headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...headers}});
 let r=await get(command);assert.equal(r.status,401);
 r=await get(command,'usuario-a');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(await r.json(),{ok:true,id:command,status:'done',confirmed:true});
 assert.deepEqual(queries.at(-1),{user:`eq.${a}`,id:`eq.${command}`});
 r=await get(command,'usuario-b');assert.equal(r.status,404);assert.deepEqual(queries.at(-1),{user:`eq.${b}`,id:`eq.${command}`});
 r=await get(command,'usuario-a',{'x-zapia-act-as':b});assert.equal(r.status,403);
 r=await get('invalido','usuario-a');assert.equal(r.status,400);
 r=await get(command,'token-invalido');assert.equal(r.status,401);
 console.log('OK: HTTP autenticado, não expõe conversa e isola por usuário; suporte indevido bloqueado.');
} finally {await new Promise(r=>server?server.close(r):r());await new Promise(r=>fake.close(r));}

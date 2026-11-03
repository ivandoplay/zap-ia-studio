import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';
process.env.EVOLUTION_API_URL='https://evolution.exemplo.com';process.env.EVOLUTION_API_KEY='chave-ficticia';

const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',did='33333333-3333-4333-8333-333333333333',tid='44444444-4444-4444-8444-444444444444',bid='55555555-5555-4555-8555-555555555555';
process.env.EVOLUTION_DEFAULT_USER_ID=uid;

const token=[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'x'].join('.');
const texto={tipo:'texto',texto:'Olá Bia, tudo bem?'};
let cenario='ok';
let chamadas=[];
const json=v=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});

globalThis.fetch=async(input,opts={})=>{
  const url=new URL(typeof input==='string'?input:input.url),p=url.pathname;
  chamadas.push(p);
  if(p==='/auth/v1/user')return json({id:uid,email:'teste@zapia.local'});
  if(p==='/rest/v1/zapia_users')return json({user_id:uid,username:'teste',role:'user',is_active:true});
  if(p==='/rest/v1/ienvia_campanha_checkpoints')return json({owner_id:uid,campanha_id:cid,destinatario_id:did,etapa:0,status:'em_envio',tentativa_id:cenario==='tentativa-errada'?bid:tid,material:{slotId:cenario==='chip-off'?'slot_3':'slot_2',bloco:texto}});
  if(p==='/rest/v1/ienvia_campanha_destinatarios')return json({owner_id:uid,campanha_id:cid,destinatario_id:did,telefone:'5586981234567'});
  if(p==='/instance/fetchInstances')return json([
    {name:'zap-ia-slot_2',connectionStatus:'open',owner: '5586980000002'},
    {name:'zap-ia-slot_3',connectionStatus:'close'},
  ]);
  if(p.startsWith('/instance/connectionState/'))return json({instance:{state:p.endsWith('slot_2')?'open':'close'}});
  if(p==='/message/sendText/zap-ia-slot_2')return json({key:{id:'evo-msg-1',remoteJid:'5586981234567@s.whatsapp.net',fromMe:true}});
  throw Error('Rede inesperada '+p);
};

const {app}=await import('../src/server.js');
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
function req(path,method='GET',body=null,auth=true){return new Promise((resolve,reject)=>{const b=body?Buffer.from(JSON.stringify(body)):null;const r=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{...(auth?{authorization:'Bearer '+token}:{}),...(b?{'content-type':'application/json','content-length':b.length}:{})}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(s)})}catch(e){reject(e)}})});r.on('error',reject);r.end(b)});}

try{
  await test('a rota de envio exige autenticação',async()=>{
    assert.equal((await req(`/api/campaigns/${cid}/steps/send`,'POST',{destinatarioId:did,etapa:0,tentativaId:tid},false)).status,401);
  });
  await test('envia a etapa reservada pelo chip da Evolution',async()=>{
    cenario='ok';chamadas=[];
    const r=await req(`/api/campaigns/${cid}/steps/send`,'POST',{destinatarioId:did,etapa:0,tentativaId:tid});
    assert.equal(r.status,200);
    assert.equal(r.body.ok,true);
    assert.equal(r.body.messageId,'evo-msg-1');
    assert.equal(r.body.slotId,'slot_2');
    assert.equal(chamadas.includes('/message/sendText/zap-ia-slot_2'),true);
  });
  await test('recusa etapa que não está reservada para esta tentativa',async()=>{
    cenario='tentativa-errada';chamadas=[];
    const r=await req(`/api/campaigns/${cid}/steps/send`,'POST',{destinatarioId:did,etapa:0,tentativaId:tid});
    assert.equal(r.status,400);
    assert.match(r.body.error,/reservada/);
    assert.equal(chamadas.includes('/message/sendText/zap-ia-slot_2'),false);
  });
  await test('chip desconectado na Evolution não aceita o envio',async()=>{
    cenario='chip-off';chamadas=[];
    const r=await req(`/api/campaigns/${cid}/steps/send`,'POST',{destinatarioId:did,etapa:0,tentativaId:tid});
    assert.equal(r.status,409);
    assert.match(r.body.error,/desconectado/);
    assert.equal(chamadas.includes('/message/sendText/zap-ia-slot_3'),false);
  });
  await test('identificadores inválidos são rejeitados antes de qualquer chamada',async()=>{
    chamadas=[];
    const r=await req(`/api/campaigns/${cid}/steps/send`,'POST',{destinatarioId:'x',etapa:0,tentativaId:tid});
    assert.equal(r.status,400);
    assert.equal(chamadas.some(x=>x.startsWith('/message')),false);
  });
}finally{await new Promise(resolve=>server.close(resolve));}

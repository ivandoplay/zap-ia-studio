import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',bid='33333333-3333-4333-8333-333333333333';
const token=[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'x'].join('.');let requests=[];
globalThis.fetch=async(input,opts={})=>{const u=new URL(typeof input==='string'?input:input.url),json=v=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});requests.push([u.pathname,opts.method||'GET']);
 if(u.pathname==='/auth/v1/user')return json({id:uid,email:'teste@zapia.local'});
 if(u.pathname==='/rest/v1/zapia_users')return json({user_id:uid,username:'teste',role:'user',is_active:true,max_wa_slots:2});
 if(u.pathname==='/rest/v1/rpc/ienvia_criar_campanha')return json([{owner_id:uid,campanha_id:cid,nome:'Teste',status:'rascunho'}]);
 if(u.pathname==='/rest/v1/rpc/ienvia_alterar_status_campanha')return json([{owner_id:uid,campanha_id:cid,nome:'Teste',status:'pausada'}]);
 if(u.pathname==='/rest/v1/ienvia_campanhas_controle')return json([{owner_id:uid,campanha_id:cid,nome:'Teste',status:'rascunho'}]);
 throw Error('Requisição inesperada '+u.pathname);
};
const {app}=await import('../src/server.js');const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
function req(path,method='GET',body=null,authenticated=true){return new Promise((resolve,reject)=>{const b=body?Buffer.from(JSON.stringify(body)):null;const r=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{...(authenticated?{authorization:'Bearer '+token}:{}),...(b?{'content-type':'application/json','content-length':b.length}:{})}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(s),headers:res.headers})}catch(e){reject(e)}})});r.on('error',reject);r.end(b)});}
const body={plano:{nome:'Teste',chips:['slot_1','slot_2'],modoChips:'rodizio',retomada:'manual',blocos:[{id:bid,tipo:'texto',modo:'fixo',textos:['Olá']}]},opcoes:{},destinatarios:[{telefone:'86981234567',nome:'Pessoa'}]};
try{
 await test('campanhas exigem login',async()=>{const r=await req('/api/campaigns','POST',body,false);assert.equal(r.status,401)});
 await test('cria rascunho autenticado sem carregar conversas',async()=>{requests=[];const r=await req('/api/campaigns','POST',body);assert.equal(r.status,201);assert.equal(r.body.campanha.status,'rascunho');assert.match(r.headers['cache-control'],/no-store/);assert.equal(requests.some(x=>x[0].includes('zapia_contacts')),false);assert.equal(requests.filter(x=>x[0].includes('/rpc/')).length,1)});
 await test('lista e pausa somente para a conta autenticada',async()=>{const a=await req('/api/campaigns');assert.equal(a.status,200);assert.equal(a.body.campanhas.length,1);const b=await req(`/api/campaigns/${cid}/control`,'POST',{acao:'pausar'});assert.equal(b.status,200);assert.equal(b.body.campanha.status,'pausada')});
 await test('bloqueia chip não autorizado antes da RPC',async()=>{requests=[];const b=structuredClone(body);b.plano.chips.push('slot_3');const r=await req('/api/campaigns','POST',b);assert.equal(r.status,400);assert.equal(requests.some(x=>x[0].includes('/rpc/')),false)});
}finally{await new Promise(resolve=>server.close(resolve));}

import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';process.env.GEMINI_API_KEY='chave-global-sintetica-que-nao-deve-ser-usada';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const tokens=ids.map(id=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'x'].join('.'));let chamadasGemini=0,requests=[];
globalThis.fetch=async(input,opts={})=>{const u=new URL(typeof input==='string'?input:input.url),json=v=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});
 requests.push([u.hostname,u.pathname,opts.method||'GET']);
 if(u.hostname==='generativelanguage.googleapis.com'){chamadasGemini++;return json({candidates:[{content:{role:'model',parts:[{text:'["Oi {{nome}}","Olá {{nome}}"]'}]},finishReason:'STOP'}]});}
 if(u.pathname==='/auth/v1/user'){const token=(new Headers(opts.headers).get('authorization')||'').replace(/^Bearer /,'');const idx=tokens.indexOf(token);return idx<0?new Response('{}',{status:401}):json({id:ids[idx],email:'teste@zapia.local'});}
 if(u.pathname==='/rest/v1/zapia_users'){const id=(u.searchParams.get('user_id')||'').replace(/^eq\./,'');return json({user_id:id,username:'sintetico',role:'user',is_active:true});}
 if(u.pathname==='/rest/v1/zapia_workspaces'){const id=(u.searchParams.get('user_id')||'').replace(/^eq\./,'');return json({settings:{ai:id===ids[0]?{provider:'gemini',geminiApiKey:'chave-ficticia-1234567890'}:{provider:'gemini'}}});}
 throw Error('Requisição inesperada '+u.pathname);
};
const {app}=await import('../src/server.js');const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
function req(token,body){return new Promise((resolve,reject)=>{const b=Buffer.from(JSON.stringify(body));const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/campaigns/ai-variations',method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json','content-length':b.length}},res=>{let s='';res.on('data',x=>s+=x);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(s),headers:res.headers})}catch(e){reject(e)}})});r.on('error',reject);r.end(b)});}
try {
 await test('exige autenticação antes de chamar IA',async()=>{const r=await req(null,{texto:'Olá {{nome}}',quantidade:2});assert.equal(r.status,401);assert.equal(chamadasGemini,0)});
 await test('usa somente chave da conta ativa, sem carregar conversas',async()=>{requests=[];const r=await req(tokens[0],{texto:'Olá {{nome}}',quantidade:2});assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.variacoes.length,2);assert.equal(chamadasGemini,1);assert.match(r.headers['cache-control'],/no-store/);assert.equal(JSON.stringify(r.body).includes('chave-ficticia'),false);assert.equal(requests.some(x=>x[1].includes('zapia_contacts')),false);assert.equal(requests.some(x=>x[2]!=='GET'&&x[0]!=='generativelanguage.googleapis.com'),false)});
 await test('conta sem chave não usa chave de outra conta nem chama provedor',async()=>{const r=await req(tokens[1],{texto:'Olá {{nome}}',quantidade:2});assert.equal(r.status,400);assert.equal(chamadasGemini,1)});
} finally {await new Promise(resolve=>server.close(resolve));}

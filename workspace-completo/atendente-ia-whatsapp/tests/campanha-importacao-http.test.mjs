import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';
const uid='11111111-1111-4111-8111-111111111111';
const token=[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'x'].join('.');
let network=[];
globalThis.fetch=async(input,opts={})=>{const u=new URL(typeof input==='string'?input:input.url);network.push([u.pathname,opts.method||'GET']);
 const json=v=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});
 if(u.pathname==='/auth/v1/user')return json({id:uid,email:'teste@zapia.local'});
 if(u.pathname==='/rest/v1/zapia_users')return json({user_id:uid,username:'teste',display_name:'Teste',role:'user',is_active:true});
 throw Error('Requisição inesperada '+u.pathname);
};
const {app}=await import('../src/server.js');
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
function request({body,contentType,authenticated=true}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/campaigns/import-preview',method:'POST',headers:{...(authenticated?{Authorization:'Bearer '+token}:{}),'content-type':contentType,'content-length':body.length}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(b),headers:res.headers})}catch(e){reject(e)}})});r.on('error',reject);r.end(body);});}
function multipart(name,data){const b='LimiteSinteticoXYZ';return {contentType:`multipart/form-data; boundary=${b}`,body:Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),data,Buffer.from(`\r\n--${b}--\r\n`)])};}
try {
 await test('bloqueia importação anônima',async()=>{const body=Buffer.from(JSON.stringify({formato:'txt',texto:'86981234567'}));const r=await request({body,contentType:'application/json',authenticated:false});assert.equal(r.status,401);});
 await test('aceita texto colado e não grava dados',async()=>{network=[];const body=Buffer.from(JSON.stringify({formato:'txt',texto:'86981234567\n86987654321'}));const r=await request({body,contentType:'application/json'});assert.equal(r.status,200);assert.equal(r.body.destinatarios.length,2);assert.match(r.headers['cache-control'],/no-store/);assert.deepEqual(network.map(x=>x[0]).sort(),['/auth/v1/user','/rest/v1/zapia_users'].sort());});
 await test('aceita planilha real sintética via upload em memória',async()=>{const f=readFileSync(new URL('./fixtures/campanha-sintetico.xlsx',import.meta.url));const r=await request(multipart('contatos.xlsx',f));assert.equal(r.status,200);assert.equal(r.body.destinatarios.length,2);assert.deepEqual(r.body.problemas.map(p=>p.tipo),['duplicado','invalido']);});
 await test('rejeita extensão não suportada e UTF-8 inválido',async()=>{const x=await request(multipart('lista.exe',Buffer.from('86981234567')));assert.equal(x.status,400);const y=await request(multipart('lista.txt',Buffer.from([0xff,0xfe])));assert.equal(y.status,400);});
} finally {await new Promise(resolve=>server.close(resolve));}

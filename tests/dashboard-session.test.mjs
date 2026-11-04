import test from 'node:test';import assert from 'node:assert/strict';import {createSessionClient} from '../public/v2/assets/session-client.js';
function storage(initial={}){const m=new Map(Object.entries(initial));return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const local=()=>storage({zapia_cloud_auth:JSON.stringify({accessToken:'synthetic-old',refreshToken:'synthetic-refresh'})});
test('503 não apaga a sessão nem tenta refresh indiscriminadamente',async()=>{
 const l=local(),before=l.getItem('zapia_cloud_auth');let calls=0;
 const api=createSessionClient({localStore:l,sessionStore:storage(),fetcher:async()=>{calls++;return response({ok:false,error:'indisponível'},503);}});
 await assert.rejects(api.request('/api/dashboard/summary'),e=>e.status===503);assert.equal(calls,1);assert.equal(l.getItem('zapia_cloud_auth'),before);
});
test('401 renova uma única vez pelo contrato existente e usa sessão nova',async()=>{
 const l=local(),seen=[];
 const api=createSessionClient({localStore:l,sessionStore:storage({zapia_act_as:JSON.stringify({userId:'target',displayName:'Conta sintética'}),zapia_pin:'pin'}),fetcher:async(path,options)=>{seen.push([path,options]);if(path==='/api/auth/refresh'){assert.equal(options.headers['x-zapia-act-as'],undefined);return response({ok:true,session:{accessToken:'synthetic-new',refreshToken:'synthetic-rotated'}});}if(options.headers.Authorization==='Bearer synthetic-old')return response({ok:false,authRequired:true},401);return response({ok:true,value:9});}});
 assert.equal((await api.request('/api/dashboard/summary')).value,9);assert.equal(seen.length,3);assert.equal(seen[2][1].headers['x-zapia-act-as'],'target');assert.equal(seen[2][1].headers['x-panel-pin'],'pin');assert.equal(JSON.parse(l.getItem('zapia_cloud_auth')).accessToken,'synthetic-new');
});
test('503 de perfil após rotação guarda retrySession, mas não autoriza consulta',async()=>{
 const l=local();let reads=0;
 const api=createSessionClient({localStore:l,sessionStore:storage(),fetcher:async(path)=>{if(path==='/api/auth/refresh')return response({ok:false,error:'perfil indisponível',retrySession:{accessToken:'synthetic-retry',refreshToken:'synthetic-rotated'}},503);reads++;return response({ok:false,authRequired:true},401);}});
 await assert.rejects(api.request('/api/dashboard/summary'),e=>e.status===503);assert.equal(reads,1);assert.equal(JSON.parse(l.getItem('zapia_cloud_auth')).refreshToken,'synthetic-rotated');
});
test('resposta tardia de conta anterior é descartada antes da renderização',async()=>{
 const l=local();let resolve;const api=createSessionClient({localStore:l,sessionStore:storage(),fetcher:()=>new Promise(r=>resolve=r)});
 const pending=api.request('/api/dashboard/summary');l.setItem('zapia_cloud_auth',JSON.stringify({accessToken:'other-user'}));resolve(response({ok:true,private:'old-user'}));await assert.rejects(pending,e=>e.status===409&&e.detail.scopeChanged);
});
test('PIN e 403 não acionam refresh; rotas fora do resumo nunca são chamadas',async()=>{
 let calls=0;const api=createSessionClient({localStore:local(),sessionStore:storage(),fetcher:async()=>{calls++;return response({ok:false,pinRequired:true},401);}});
 await assert.rejects(api.request('/api/dashboard/summary'),e=>e.status===401);assert.equal(calls,1);await assert.rejects(api.request('/api/chat/send'));assert.equal(calls,1);
});

test('comandos de conexão nunca fazem refresh/replay automático em 401, erro ou falha de rede',async()=>{
 for(const fail of ['auth','network','server']){let calls=0;const api=createSessionClient({localStore:local(),sessionStore:storage(),fetcher:async()=>{calls++;if(fail==='network')throw Error('offline');return response({ok:false,authRequired:true},fail==='auth'?401:503);}});
  await assert.rejects(api.command('/api/wa/disconnect',{slotId:'slot_1',clearSession:false}));assert.equal(calls,1);
 }
});

test('canais POST/PATCH não renovam sessão nem repetem gravação automaticamente',async()=>{
 for(const [path,method]of [['/api/channels','POST'],['/api/channels/11111111-1111-4111-8111-111111111111','PATCH']]){let calls=0;const api=createSessionClient({localStore:local(),sessionStore:storage(),fetcher:async()=>{calls++;return response({ok:false,authRequired:true},401);}});await assert.rejects(api.request(path,{method,body:{name:'Teste'}}),e=>e.status===401);assert.equal(calls,1);}
});

test('sessão: consulta do vínculo UUID usa GET autenticado e rejeita sufixos fora da allowlist',async()=>{
 const path='/api/channels/11111111-1111-4111-8111-111111111111/legacy-link';let calls=0;const api=createSessionClient({localStore:local(),sessionStore:storage(),fetcher:async(url,opts)=>{calls++;assert.equal(url,path);assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,'Bearer synthetic-old');return response({ok:true});}});assert.equal((await api.request(path)).ok,true);await assert.rejects(api.request(path+'/connect'));assert.equal(calls,1);
});

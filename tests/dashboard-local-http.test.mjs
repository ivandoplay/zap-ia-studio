import {validateLegacyApiReferences} from '../src/channels/legacyIdentity.js';
import {validateConnectionControl} from '../src/connections/controls.js';
// Middleware real em VM + router real HTTP; não importa server.js nem inicializa motor/socket.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import crypto from 'node:crypto';import {readFileSync} from 'node:fs';import express from 'express';import {createDashboardRouter} from '../src/dashboard/router.js';
const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const start=source.indexOf("app.use('/api', async",source.indexOf('// Middleware Multi-Tenant'));
const body=source.slice(start,source.indexOf('\n});',start)+4).replace("app.use('/api', ",'').slice(0,-2);
const pinSource=source.slice(source.indexOf('function safeComparePin('),source.indexOf('function extractBearerToken('));
const helpers=source.slice(source.indexOf('const isDashboardRequest ='),source.indexOf('// Middleware Multi-Tenant'));
const storage={data:{settings:{securityPin:'2468'},contacts:{a:{stage:'aguardando_humano',lastMessageAt:new Date().toISOString()}}}};
let reads=0;const worker={configured:false,loggedIn:false,user:null};
const sandbox={validateLegacyApiReferences,validateConnectionControl,IS_VERCEL:false,Buffer,crypto,storage,cloudWorker:{getStatus:()=>worker},extractActAsUserId:req=>req.headers['x-zapia-act-as']||'',UUID_RE:/^[0-9a-f-]{36}$/i,clampMaxWaSlots:v=>v||1,loadTenantContextAsMasterSupport:()=>{throw Error('Bootstrap proibido neste teste');},getAdminClient:()=>{throw Error('Admin inesperado');}};
const middleware=vm.runInNewContext(`${pinSource}\n${helpers}\n(${body})`,sandbox);
const app=express();app.use(express.json());app.use('/api',middleware);app.use('/api/dashboard',createDashboardRouter({getLocalContext:()=>{reads++;return {mode:'local_worker',viewer:{id:null,displayName:'Painel local'},tenant:{id:null,maxWaSlots:1},permissions:{master:true},data:storage.data,runtime:{maxWaSlots:1,slots:{slot_1:{status:'disconnected',workerOnline:true,workerHeartbeatAt:new Date().toISOString()}}}};}}));
const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});test.after(()=>new Promise(r=>server.close(r)));
const url=`http://127.0.0.1:${server.address().port}`;
test('local: middleware real exige x-panel-pin e não aceita header parecido; só então lê resumo',async()=>{
 for(const headers of [{},{'x-panel-pin':'errado'},{'x-zapia-pin':'2468'}]){const r=await fetch(url+'/api/dashboard/summary',{headers});assert.equal(r.status,401);assert.equal((await r.json()).pinRequired,true);}assert.equal(reads,0);
 const r=await fetch(url+'/api/dashboard/summary',{headers:{'x-panel-pin':'2468'}});assert.equal(r.status,200);const d=await r.json();assert.equal(d.mode,'local_worker');assert.equal(d.counts.conversations,1);assert.equal(d.counts.campaigns,null);assert.equal(d.viewer.id,null);assert.equal(d.preferenceScope,'browser');assert.equal(d.connections.workerOnline,true);assert.equal(reads,1);
});
test('local: nuvem configurada sem login e suporte não-master continuam bloqueados',async()=>{
 worker.configured=true;worker.loggedIn=false;let r=await fetch(url+'/api/dashboard/summary',{headers:{'x-panel-pin':'2468'}});assert.equal(r.status,401);assert.equal((await r.json()).authRequired,true);
 worker.loggedIn=true;worker.user={id:'11111111-1111-4111-8111-111111111111',role:'user'};
 r=await fetch(url+'/api/dashboard/summary',{headers:{'x-panel-pin':'2468','x-zapia-act-as':'22222222-2222-4222-8222-222222222222'}});assert.equal(r.status,403);assert.equal(reads,1);
});
test('toggle real em VM: booleanos corretos; strings e ausência não escrevem',()=>{
 const at=source.indexOf("app.post('/api/wa/toggle-bot', "),text=source.slice(at,source.indexOf('\n});',at)+4).replace("app.post('/api/wa/toggle-bot', ",'').slice(0,-2);
 let writes=0,emits=0;const s={data:{settings:{botEnabled:true}},writeNow:()=>writes++,addLog:()=>{}};
 const handler=vm.runInNewContext(`(${text})`,{storage:s,usesCloudBridge:()=>false,whatsappManager:{emitState:()=>emits++}});
 const res={status(n){this.code=n;return this;},json(d){this.body=d;return this;}};
 for(const value of ['false','0',0,null,undefined]){res.code=200;handler({body:value===undefined?{}:{enabled:value}},res);assert.equal(res.code,400);assert.equal(writes,0);}
 for(const enabled of [false,true]){handler({body:{enabled}},res);assert.equal(s.data.settings.botEnabled,enabled);}assert.equal(writes,2);assert.equal(emits,2);
});

test('local: canais UUID não passam ao legado mesmo com PIN e login válidos',async()=>{
 const r=await fetch(url+'/api/crm/new-contact',{method:'POST',headers:{'content-type':'application/json','x-panel-pin':'2468'},body:JSON.stringify({channelId:'33333333-3333-4333-8333-333333333333',phone:'558600000000'})});assert.equal(r.status,409);assert.equal(reads,1);
});

test('local com conta conectada: campanhas vêm da nuvem e falha não vira zero',async()=>{
 const app2=express();app2.use(express.json());
 let mode='ok';
 const rpc=(name)=>({abortSignal:async()=>mode==='ok'
   ?{data:{counts:{conversations:1,pendingHuman:0,campaigns:2},campaigns:{active:0,paused:1,drafts:0,completed:1}},error:null}
   :{data:null,error:{code:'57014',message:'timeout'}}});
 app2.use('/api/dashboard',createDashboardRouter({getLocalContext:()=>({mode:'local_worker',
  viewer:{id:'11111111-1111-4111-8111-111111111111',displayName:'Conta'},tenant:{id:'11111111-1111-4111-8111-111111111111',maxWaSlots:3},permissions:{master:true},
  viewerClient:{rpc},data:storage.data,runtime:{maxWaSlots:3,slots:{slot_1:{status:'disconnected',workerOnline:true,workerHeartbeatAt:new Date().toISOString()}}}})}));
 const s2=await new Promise(r=>{const s=app2.listen(0,'127.0.0.1',()=>r(s));});
 try{
  const u2=`http://127.0.0.1:${s2.address().port}`;
  let d=await (await fetch(u2+'/api/dashboard/summary')).json();
  assert.equal(d.counts.conversations,1,'conversas seguem vindo da memória do motor');
  assert.equal(d.counts.campaigns,2,'campanha da conta não aparece como indisponível');
  assert.equal(d.campaigns?.paused,1);
  assert.ok(d.warnings.includes('local_contacts_with_cloud_campaigns'));
  mode='fail';
  d=await (await fetch(u2+'/api/dashboard/summary')).json();
  assert.equal(d.counts.campaigns,null,'falha de leitura não é apresentada como zero');
  assert.ok(d.warnings.includes('campaigns_unavailable'));
 }finally{await new Promise(r=>s2.close(r));}
});

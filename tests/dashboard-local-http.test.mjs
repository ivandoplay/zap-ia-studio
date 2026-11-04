// Middleware real em VM + router real HTTP; não importa server.js nem inicializa motor/socket.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import crypto from 'node:crypto';import {readFileSync} from 'node:fs';import express from 'express';import {createDashboardRouter} from '../src/dashboard/router.js';
const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const start=source.indexOf("app.use('/api', async",source.indexOf('// Middleware Multi-Tenant'));
const body=source.slice(start,source.indexOf('\n});',start)+4).replace("app.use('/api', ",'').slice(0,-2);
const pinSource=source.slice(source.indexOf('function safeComparePin('),source.indexOf('function extractBearerToken('));
const helpers=source.slice(source.indexOf('const isDashboardRequest ='),source.indexOf('// Middleware Multi-Tenant'));
const storage={data:{settings:{securityPin:'2468'},contacts:{a:{stage:'aguardando_humano',lastMessageAt:new Date().toISOString()}}}};
let reads=0;const worker={configured:false,loggedIn:false,user:null};
const sandbox={IS_VERCEL:false,Buffer,crypto,storage,cloudWorker:{getStatus:()=>worker},extractActAsUserId:req=>req.headers['x-zapia-act-as']||'',UUID_RE:/^[0-9a-f-]{36}$/i,clampMaxWaSlots:v=>v||1,loadTenantContextAsMasterSupport:()=>{throw Error('Bootstrap proibido neste teste');},getAdminClient:()=>{throw Error('Admin inesperado');}};
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

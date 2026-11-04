import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {createChannelsRouter} from '../src/channels/router.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='44444444-4444-4444-8444-444444444444';let fail=null,calls=[],linkReply=null;
const row={id:C,name:'Canal sintético',transport:'evolution_api',crmVisible:false,aiEnabled:true,campaignsEnabled:false,tags:['Loja'],revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),secret:'NUNCA_DEVOLVER'};
const app=express();app.use(express.json());app.use((req,_r,next)=>{if(req.headers['x-test-auth'])req.dashboardContext={viewer:{id:A,displayName:'Operador'},tenant:{id:req.headers['x-test-support']?B:A},viewerClient:{rpc:(name,args)=>{calls.push({name,args});return {abortSignal:async()=>({error:fail,data:name==='ienvia_get_channel_legacy_link'?linkReply:name==='ienvia_list_channels'?{items:[row],total:1,hasMore:false,nextCursor:null,summary:{total:1,crmVisible:0,crmHidden:1,aiEnabled:1,campaignsEnabled:0}}:row})};}}};next();});app.use('/api/channels',createChannelsRouter());const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});test.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
async function request(path='',method='GET',body,headers={'x-test-auth':'1'}){const r=await fetch(base+'/api/channels'+path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),headers:r.headers};}
test('API canais: autenticação, DTO explícito e consulta por dono sem carregar contatos',async()=>{
 assert.equal((await request('','GET',undefined,{})).status,401);calls=[];const r=await request('?visibility=hidden&limit=10');assert.equal(r.status,200);assert.equal(r.data.items[0].capabilities.canPair,false);assert.equal(JSON.stringify(r.data).includes('NUNCA_DEVOLVER'),false);assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(calls,[{name:'ienvia_list_channels',args:{p_owner:A,p_limit:10,p_after:null,p_visibility:'hidden',p_search:''}}]);
 const support=await request('','GET',undefined,{'x-test-auth':'1','x-test-support':'1'});assert.equal(support.data.permissions.canEdit,false);assert.equal(calls.at(-1).args.p_owner,B);
});
test('API canais: suporte e campos inválidos bloqueados antes de escrita; defaults e CAS explícitos',async()=>{
 calls=[];assert.equal((await request('','POST',{name:'Novo',transport:'local_worker'},{'x-test-auth':'1','x-test-support':'1'})).status,403);assert.equal(calls.length,0);
 assert.equal((await request('','POST',{name:'Novo',transport:'local_worker',aiEnabled:'false'})).status,400);assert.equal(calls.length,0);
 assert.equal((await request('','POST',{name:'Novo',transport:'local_worker'})).status,201);assert.equal(calls.at(-1).args.p_config.aiEnabled,false);assert.equal(calls.at(-1).args.p_config.campaignsEnabled,false);
 assert.equal((await request('/slot_4','PATCH',{expectedRevision:1,patch:{crmVisible:false}})).status,400);
 assert.equal((await request('/'+C,'PATCH',{expectedRevision:1,patch:{crmVisible:false}})).status,200);assert.deepEqual(calls.at(-1).args,{p_id:C,p_revision:1,p_patch:{crmVisible:false}});
});
test('API canais: migração ausente não vira zero, conflito não sobrescreve e limites de página são validados',async()=>{
 try{fail={code:'PGRST202'};const absent=await request();assert.equal(absent.status,503);assert.equal(absent.data.code,'CHANNELS_SETUP_REQUIRED');assert.equal(absent.data.items,undefined);
 fail={code:'40001'};assert.equal((await request('/'+C,'PATCH',{expectedRevision:1,patch:{aiEnabled:false}})).status,409);
 }finally{fail=null;}for(const query of ['?limit=51','?after=slot_4','?visibility=qualquer'])assert.equal((await request(query)).status,400);
});

test('API ponte: vínculo é escopado e somente leitura, DTO sem segredos e corrupção falha fechada',async()=>{
 linkReply={ownerId:A,channel:row,binding:{ownerId:A,channelId:C,legacySlotId:'slot_2',transport:row.transport,secret:'NUNCA_DEVOLVER'}};calls=[];let r=await request('/'+C+'/legacy-link');assert.equal(r.status,200);assert.equal(r.data.link.state,'legacy_linked');assert.equal(r.data.link.legacySlotId,'slot_2');assert.equal(r.data.link.canPair,false);assert.equal(r.data.connection.status,'not_verified');assert.equal(JSON.stringify(r.data).includes('NUNCA_DEVOLVER'),false);assert.deepEqual(calls,[{name:'ienvia_get_channel_legacy_link',args:{p_owner:A,p_channel:C}}]);assert.match(r.headers.get('cache-control'),/no-store/);
 linkReply={...linkReply,binding:null};r=await request('/'+C+'/legacy-link');assert.equal(r.data.link.state,'unbound');linkReply={...linkReply,ownerId:B};assert.equal((await request('/'+C+'/legacy-link')).status,503);
 linkReply={...linkReply,ownerId:B};r=await request('/'+C+'/legacy-link','GET',undefined,{'x-test-auth':'1','x-test-support':'1'});assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_owner,B);
 const before=calls.length;assert.equal((await request('/slot_1/legacy-link')).status,400);assert.equal(calls.length,before);try{fail={code:'PGRST202'};r=await request('/'+C+'/legacy-link');assert.equal(r.status,503);assert.equal(r.data.code,'CHANNELS_SETUP_REQUIRED');}finally{fail=null;}
});

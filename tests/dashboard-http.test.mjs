import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Execute pelo isolador npm test');
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='synthetic-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';process.env.EVOLUTION_API_KEY='synthetic-evolution';process.env.EVOLUTION_API_URL='https://pool-evolution-api-067.cloud2.pageup.dev.br';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',M='33333333-3333-4333-8333-333333333333';
const jwt=id=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'synthetic'].join('.');
const profiles=new Map([[A,{user_id:A,username:'conta-a',display_name:'Conta A',role:'user',is_active:true,max_wa_slots:1}],[B,{user_id:B,username:'conta-b',display_name:'Conta B',role:'user',is_active:true,max_wa_slots:2}],[M,{user_id:M,username:'operador',display_name:'Operador',role:'master',is_active:true,max_wa_slots:3}]]);
const calls=[];let rpcUnavailable=false,providerUnavailable=false,lastPreferenceOwner,controlMode=false;
const result=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const actor=headers=>{try{return JSON.parse(Buffer.from(new Headers(headers).get('authorization').split('.')[1],'base64url')).sub;}catch{return null;}};
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url),headers=options.headers||input.headers,uid=actor(headers),method=options.method||'GET';calls.push({path:url.pathname,method,query:url.searchParams,actor:uid});
 if(url.pathname==='/auth/v1/user')return uid?result({id:uid,email:'test@example.invalid'}):result({message:'invalid'},401);
 if(url.pathname==='/rest/v1/zapia_users'){const id=(url.searchParams.get('user_id')||'').replace('eq.','');return result(profiles.has(id)?[profiles.get(id)]:[]);}
 if(url.pathname==='/rest/v1/rpc/ienvia_dashboard_summary_v1'){
  if(rpcUnavailable)return result({code:'PGRST202',message:'RPC ausente'},404);
  const owner=JSON.parse(options.body).p_owner;
  if(uid!==owner&&uid!==M)return result({code:'42501'},403);
  const n=owner===A?1002:9,today=new Date().toISOString().slice(0,10);
  return result({schemaVersion:1,tenantId:owner,generatedAt:new Date().toISOString(),timeZone:'America/Fortaleza',counts:{conversations:n,pendingHuman:2,campaigns:137},campaigns:{paused:1,active:0,drafts:136,completed:0},activityDefinition:'last_contact_activity',activity:Array.from({length:7},(_,i)=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-6+i);return {date:date.toISOString().slice(0,10),value:i===6?3:0};})});
 }
 if(controlMode&&url.pathname==='/rest/v1/zapia_workspaces'){assert.equal(url.searchParams.get('select'),'wa_slots:settings->waSlots');return result([{wa_slots:{slot_1:{label:'Chip de teste',aiEnabled:false}},secret:'NUNCA_PUBLICAR'}]);}
 if(controlMode&&url.pathname==='/rest/v1/zapia_commands')return result([{id:'44444444-4444-4444-8444-444444444444',action:'wa_connect',status:'done',slot_id:'slot_1',created_at:new Date().toISOString(),result:{slotState:{status:'qr_ready',qrDataUrl:'data:image/png;base64,YWJj',pairingCode:'ABCD1234',phone:'NUNCA_PUBLICAR'},secret:'NUNCA_PUBLICAR'}}]);
 if(url.pathname==='/rest/v1/zapia_wa_runtime')return result([{status:'connected',worker_online:false,worker_heartbeat_at:null}]);
 if(url.pathname==='/rest/v1/zapia_wa_slots'||url.pathname==='/rest/v1/zapia_worker_devices')return result([]);
 if(url.pathname==='/rest/v1/ienvia_user_appearance'){lastPreferenceOwner=(url.searchParams.get('user_id')||'').replace('eq.','');return result([{theme:'dark'}]);}
 if(url.pathname==='/rest/v1/rpc/ienvia_set_appearance'){lastPreferenceOwner=uid;assert.deepEqual(Object.keys(JSON.parse(options.body)),['p_theme']);return result({theme:JSON.parse(options.body).p_theme});}
 if(url.origin===process.env.EVOLUTION_API_URL){assert.equal(options.redirect,'error');assert.equal(method,'GET');if(providerUnavailable)return result({message:'indisponível'},503);if(url.pathname==='/instance/fetchInstances')return result([A,B].map(id=>({name:`zap-ia-${id}-slot_1`,connectionStatus:'open'})));if(url.pathname.startsWith('/instance/connectionState/'))return result({instance:{state:'close'}});}
 throw new Error('Endpoint inesperado: '+url.pathname);
};
const {app}=await import('../src/server.js');
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});test.after(()=>new Promise(r=>server.close(r)));
function request(path,{id=A,method='GET',body,actAs}={}){return new Promise((resolve,reject)=>{const headers={'content-type':'application/json'};if(id)headers.Authorization='Bearer '+jwt(id);if(actAs)headers['x-zapia-act-as']=actAs;
 const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});}
test('HTTP: resumo autenticado não carrega workspace, contatos, bootstrap nem faz escrita',async()=>{
 calls.length=0;const r=await request('/api/dashboard/summary');assert.equal(r.status,200);assert.equal(r.body.counts.conversations,1002);assert.equal(r.body.connections.status,'disconnected');assert.equal(r.body.connections.workerOnline,false);assert.equal(r.headers['cache-control'],'no-store');assert.ok(Buffer.byteLength(JSON.stringify(r.body))<4500);
 assert.equal(calls.some(c=>['/rest/v1/zapia_workspaces','/rest/v1/zapia_contacts'].includes(c.path)),false);assert.equal(calls.some(c=>c.method!=='GET'&&!c.path.includes('/rpc/ienvia_dashboard_summary_v1')),false);
 for(const c of calls.filter(c=>['/rest/v1/zapia_wa_slots','/rest/v1/zapia_worker_devices'].includes(c.path))){assert.ok(c.query.get('limit'));assert.equal(c.query.get('user_id'),'eq.'+A);assert.doesNotMatch(c.query.get('select'),/qr|pairing|connected_user|last_error/);}
});
test('HTTP: conta comum não entra em suporte; master lê alvo sem bootstrap e aparência é do operador',async()=>{
 assert.equal((await request('/api/dashboard/summary',{actAs:B})).status,403);
 calls.length=0;const r=await request('/api/dashboard/summary',{id:M,actAs:B});assert.equal(r.status,200);assert.equal(r.body.viewer.id,M);assert.equal(r.body.tenant.id,B);assert.equal(r.body.counts.conversations,9);assert.equal(calls.some(c=>c.path.includes('zapia_contacts')||c.path.includes('zapia_workspaces')),false);
 await request('/api/dashboard/appearance',{id:M,actAs:B});assert.equal(lastPreferenceOwner,M);
 const saved=await request('/api/dashboard/appearance',{id:M,actAs:B,method:'PUT',body:{theme:'light'}});assert.equal(saved.status,200);assert.equal(lastPreferenceOwner,M);
});
test('HTTP: RPC ausente não vira zero; falha Evolution não confirma snapshot antigo',async()=>{
 rpcUnavailable=true;const unavailable=await request('/api/dashboard/summary');assert.equal(unavailable.status,503);assert.equal(unavailable.body.counts,undefined);rpcUnavailable=false;
 providerUnavailable=true;const r=await request('/api/dashboard/summary');assert.equal(r.status,200);assert.equal(r.body.connections.status,'unknown');assert.equal(r.body.connections.workerOnline,false);assert.ok(r.body.warnings.includes('provider_unavailable'));providerUnavailable=false;
});
test('HTTP: contratos inválidos são rejeitados antes de carregar/gravar workspace; sessão continua exigida',async()=>{
 for(const body of [{},{enabled:'false'},{enabled:0},{enabled:null}]){calls.length=0;const r=await request('/api/wa/toggle-bot',{method:'POST',body});assert.equal(r.status,400);assert.equal(calls.some(c=>c.path.includes('zapia_workspaces')),false);}
 for(const body of [{theme:'system'},{theme:'dark',userId:B},{}])assert.equal((await request('/api/dashboard/appearance',{method:'PUT',body})).status,400);
 assert.equal((await request('/api/dashboard/summary',{id:null})).status,401);
 const r=await request('/api/dashboard/summary',{id:M,actAs:'inválido'});assert.equal(r.status,400);
});
test('Conexões HTTP: sem RPC nova, workspace, contatos ou mutação; acesso do suporte continua isolado',async()=>{
 calls.length=0;
 const r=await request('/api/connections/summary');assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.body.connections.status,'disconnected');assert.equal(r.body.capabilities.canOperate,true);assert.equal(r.body.restrictionStatus,'not_verified');assert.equal(r.body.executionReadiness,'not_verified');assert.equal(r.body.preferenceScope,'browser');
 assert.equal(calls.some(c=>c.method!=='GET'||/rpc|zapia_workspaces|zapia_contacts/.test(c.path)),false);
 const denied=await request('/api/connections/summary',{actAs:B});assert.equal(denied.status,403);
 calls.length=0;const support=await request('/api/connections/summary',{id:M,actAs:B});assert.equal(support.status,200);assert.equal(support.body.viewer.id,M);assert.equal(support.body.tenant.id,B);assert.equal(support.body.connections.total,2);assert.equal(calls.some(c=>c.method!=='GET'),false);
 for(const c of calls.filter(c=>/zapia_wa_runtime|zapia_wa_slots|zapia_worker_devices/.test(c.path)))assert.equal(c.query.get('user_id'),'eq.'+B);
});
test('Conexões HTTP: falha do provedor não vira banimento nem habilita operações',async()=>{
 providerUnavailable=true;const r=await request('/api/connections/summary');providerUnavailable=false;
 assert.equal(r.status,200);assert.equal(r.body.connections.status,'unknown');assert.equal(r.body.restrictionStatus,'not_verified');assert.equal(r.body.capabilities.canOperate,true);assert.ok(r.body.warnings.includes('provider_unavailable'));
 assert.equal((await request('/api/connections/summary',{id:null})).status,401);
});

test('Conexões controles HTTP: valida chip, booleanos e suporte antes de qualquer workspace ou provedor',async()=>{
 for(const [path,body,status]of [['/api/wa/connect',{},400],['/api/wa/connect',{slotId:'slot_4'},400],['/api/wa/connect',{slotId:'slot_2'},403],['/api/wa/disconnect',{slotId:'slot_1',clearSession:'false'},400],['/api/wa/disconnect',{slotId:'slot_1'},400],['/api/wa/slot-config',{slotId:'slot_1',aiEnabled:'false'},400],['/api/evolution-cloud/delete',{},400]]){calls.length=0;assert.equal((await request(path,{method:'POST',body})).status,status);assert.equal(calls.some(c=>/zapia_workspaces|zapia_commands|instance/.test(c.path)),false);}
 for(const path of ['/api/wa/connect','/api/wa/disconnect','/api/wa/slot-config','/api/evolution-cloud/connect','/api/evolution-cloud/disconnect','/api/evolution-cloud/delete']){calls.length=0;assert.equal((await request(path,{id:M,actAs:B,method:'POST',body:{slotId:'slot_1',clearSession:false,aiEnabled:false}})).status,403);assert.equal(calls.some(c=>/zapia_workspaces|zapia_commands|instance/.test(c.path)),false);}
});
test('Conexões controles HTTP: configuração mínima e pareamento vinculados à conta/comando, sem suporte',async()=>{
 controlMode=true;try{
  calls.length=0;const config=await request('/api/connections/configuration');assert.equal(config.status,200);assert.deepEqual(config.body.slots,[{slotId:'slot_1',label:'Chip de teste',aiEnabled:false}]);assert.equal(JSON.stringify(config.body).includes('NUNCA_PUBLICAR'),false);assert.equal(calls.some(c=>c.path.includes('contacts')),false);
  assert.equal((await request('/api/connections/configuration',{id:M,actAs:B})).status,403);
  const pair=await request('/api/connections/pairing?slotId=slot_1&commandId=44444444-4444-4444-8444-444444444444');assert.equal(pair.status,200);assert.equal(pair.body.pairingCode,'ABCD1234');assert.equal(JSON.stringify(pair.body).includes('NUNCA_PUBLICAR'),false);assert.match(pair.headers['cache-control'],/no-store/);
  assert.equal((await request('/api/connections/pairing?slotId=slot_2&commandId=44444444-4444-4444-8444-444444444444')).status,400);
  assert.equal((await request('/api/connections/pairing?slotId=slot_1&commandId=44444444-4444-4444-8444-444444444444',{id:M,actAs:B})).status,403);
 }finally{controlMode=false;}
});

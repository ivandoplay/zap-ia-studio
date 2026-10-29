import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');
const {chromium}=createRequire(process.env.ZAPIA_PLAYWRIGHT_REQUIRE)('playwright');
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='sintetico';
const {localStorageInstance:store}=await import('../src/storage.js');
const {app}=await import('../src/server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({headless:true});
const id='11111111-1111-4111-8111-111111111111',user={id,username:'sintetico',role:'user'};
const wa={status:'connected',workerOnline:true,slots:{},devices:[],proactive:{},maxWaSlots:1};
const snap={ok:true,appVersion:'5.8.25',runtimeMode:'vercel_cloud',currentUser:user,waState:wa,proactiveQueueState:{},settings:store.data.settings,business:store.data.business,templates:[],trainingPacks:[],contacts:[],stats:{},logs:[],simulatorHistory:[]};let polls=0,configs=0;
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(user=>localStorage.setItem('zapia_cloud_auth',JSON.stringify({accessToken:'jwt-sintetico',expiresAt:9999999999,user})),user);
 await page.route('**/*',route=>{const u=route.request().url();
  if(u===base+'/inbox-realtime.js')return route.fulfill({contentType:'application/javascript',body:'window.__starts=[];window.__stops=0;window.ienviaInboxRealtime={start:async x=>window.__starts.push(x),stop:async()=>window.__stops++}'});
  if(u===base+'/api/auth/status')return route.fulfill({json:{ok:true,mode:'vercel_cloud',cloudLoginRequired:false,currentUser:user}});
  if(u===base+'/api/bootstrap')return route.fulfill({json:snap});
  if(u===base+'/api/cloud/realtime-config'){configs++;return route.fulfill({json:{ok:true,url:'https://example.supabase.co',key:'public-key',userId:id}})}
  if(u===base+'/api/cloud/poll'){polls++;return route.fulfill({json:snap})}
  if(u.startsWith(base+'/api/'))return route.fulfill({json:{ok:true}});
  if(!u.startsWith(base+'/'))return route.abort();return route.continue();
 });
 await page.goto(base+'/painel');await page.waitForFunction(()=>window.__starts?.length===1);assert.equal(configs,1);assert.equal(await page.evaluate(()=>window.__starts[0].userId),id);
 const before=polls;await page.evaluate(()=>window.dispatchEvent(new Event('ienvia:inbox-changed')));await new Promise((resolve,reject)=>{const started=Date.now();const loop=()=>{if(polls>before)return resolve();if(Date.now()-started>1400)return reject(new Error('Evento não antecipou o poll'));setTimeout(loop,25)};loop()});
 assert(polls>before,'notificação deve chamar poll sem aguardar o temporizador de 3,5 segundos');
 await page.evaluate(()=>saveActAs({userId:'22222222-2222-4222-8222-222222222222'}));await page.waitForFunction(()=>window.__stops>0);
 const beforeStop=polls;await page.evaluate(()=>window.dispatchEvent(new Event('ienvia:inbox-changed')));await page.waitForTimeout(500);assert.equal(polls,beforeStop,'modo suporte não escuta realtime da conta anterior');assert.deepEqual(errors,[]);console.log('OK: navegador antecipa atualização após evento e desliga o canal em modo suporte.');
 await page.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}

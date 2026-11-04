// Somente servidor estático isolado e respostas sintéticas. Nenhum login/sessão/serviço real.
import {contrastIssues} from './helpers/dashboard-contrast.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import express from 'express';import {chromium} from 'playwright';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Execute com npm test');
const app=express();app.get(['/visao-geral','/visao-geral/'],(_q,r)=>r.sendFile(path.resolve('public/v2/index.html')));app.use('/api',(_q,r)=>r.status(501).json({ok:false,error:'Somente fixture de teste'}));app.use(express.static('public'));
const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});test.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',M='33333333-3333-4333-8333-333333333333';
function fixture({empty=false,support=false,role='user',mode='vercel_cloud'}={}) {
 return {ok:true,schemaVersion:1,mode,viewer:{id:support?M:A,displayName:support?'Operador de teste':'Equipe Horizonte',role:support?'master':role},tenant:{id:support?B:A,displayName:support?'Conta em suporte · teste':'Equipe Horizonte',maxWaSlots:3},permissions:{master:support||role==='master'},preferenceScope:'account',generatedAt:new Date().toISOString(),timeZone:'America/Fortaleza',counts:{conversations:empty?0:1234,pendingHuman:empty?0:12,campaigns:empty?0:137},campaigns:{active:0,paused:empty?0:1,drafts:empty?0:136,completed:0},activityDefinition:'last_contact_activity',activity:[13,22,31,10,24,36,18].map((n,i)=>{const d=new Date();d.setUTCDate(d.getUTCDate()-6+i);return {date:d.toISOString().slice(0,10),value:empty?0:n};}),connections:{status:'disconnected',connected:0,total:3,workerOnline:false,providerReadStatus:'updated',checkedAt:new Date().toISOString(),slots:[1,2,3].map(n=>({slotId:`slot_${n}`,status:'disconnected',transport:'evolution_api',workerOnline:false,readStatus:'updated'}))},warnings:[]};
}
async function open(options={}) {
 const context=await browser.newContext({viewport:options.viewport||{width:1440,height:1050},deviceScaleFactor:1});const page=await context.newPage();let current=options.data||fixture(options),failure=options.failure||null,theme=options.theme||null;const calls=[],external=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort();calls.push({path:url.pathname,method:req.method(),headers:req.headers(),body:req.postDataJSON()});
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'cache-control':'no-store'}});
  if(url.pathname==='/api/auth/status')return reply({ok:true,cloudLoginRequired:false,mode:current.mode,currentUser:current.viewer});
  if(url.pathname==='/api/dashboard/appearance'){
   if(req.method()==='PUT'){if(options.failTheme)return reply({ok:false,error:'Falha sintética de preferência'},503);theme=req.postDataJSON().theme;return reply({ok:true,theme,scope:'account'});}return reply({ok:true,theme,scope:'account'});
  }
  if(url.pathname==='/api/dashboard/summary'){if(failure)return reply({ok:false,error:'Falha sintética de consulta',...failure.body},failure.status||503);return reply(current);}
  return reply({ok:false,error:'Rota não permitida no teste'},500);
 });
 if(options.support)await page.addInitScript(({B})=>sessionStorage.setItem('zapia_act_as',JSON.stringify({userId:B,displayName:'Conta em suporte · teste'})),{B});
 await page.goto(base+'/visao-geral/');if(!options.failure){await page.waitForSelector('#count-conversations');await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent==='Resumo atualizado');await page.evaluate(()=>document.fonts.ready);}
 return {page,context,calls,external,errors,getTheme:()=>theme,setFailure:v=>failure=v,setData:v=>current=v,async close(){assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}};
}
async function capture(page,name){
 if(!process.env.PREVIEW_ARTIFACTS)return;
 fs.mkdirSync(process.env.PREVIEW_ARTIFACTS,{recursive:true});
 await page.evaluate(()=>{const label=document.createElement('div');label.id='synthetic-evidence-label';label.textContent='VALIDAÇÃO ISOLADA · DADOS SINTÉTICOS · NÃO É PRODUÇÃO';label.style.cssText='position:relative;z-index:9999;text-align:center;background:#293b31;color:#fff;border-top:1px solid #87ac95;font:10px/24px system-ui;letter-spacing:.5px;pointer-events:none';document.body.append(label);});
 await page.screenshot({path:path.join(process.env.PREVIEW_ARTIFACTS,name+'.png'),fullPage:true});await page.locator('#synthetic-evidence-label').evaluate(el=>el.remove());
}
test('browser desktop: resumo integrado, escuro padrão, sem bootstrap/poll legado; evidência visual',async()=>{
 const f=await open();try{
  assert.equal(await f.page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await f.page.locator('#count-conversations').textContent(),'1.234');assert.equal(await f.page.locator('#count-campaigns').textContent(),'137');
  assert.equal(await f.page.locator('a[href="/painel#contas"]').count(),0);assert.equal(await f.page.locator('#worker-tag').textContent(),'Sem sinal recente');
  await f.page.locator('summary').filter({hasText:'Ver dados do gráfico'}).click();assert.equal(await f.page.locator('#activity-table tr').count(),7);await f.page.locator('summary').filter({hasText:'Ver dados do gráfico'}).click();
  assert.ok(f.calls.every(c=>['/api/auth/status','/api/dashboard/summary','/api/dashboard/appearance'].includes(c.path)));assert.equal(f.calls.filter(c=>c.path==='/api/dashboard/summary').length,1);
  await capture(f.page,'desktop-escuro');console.log('UI_BUDGET',JSON.stringify({summaryBytes:Buffer.byteLength(JSON.stringify(fixture())),apiPaths:f.calls.map(c=>c.path),externalRequests:f.external.length}));
 }finally{await f.close();}
});
test('browser mobile: sem overflow, menu com foco/escape, busca funcional para página legada',async()=>{
 const f=await open({viewport:{width:390,height:844}});try{
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await capture(f.page,'mobile-escuro');
  await f.page.getByRole('button',{name:'Abrir menu',exact:true}).click();assert.equal(await f.page.locator('#open-menu').getAttribute('aria-expanded'),'true');assert.equal(await f.page.locator('#workspace').evaluate(el=>el.inert),true);await capture(f.page,'mobile-menu');
  await f.page.keyboard.press('Escape');assert.equal(await f.page.locator('#open-menu').getAttribute('aria-expanded'),'false');
  await f.page.keyboard.press('Control+k');await f.page.getByRole('searchbox').fill('conexões');assert.equal(await f.page.locator('#search-results a').getAttribute('href'),'/conexoes/');await f.page.keyboard.press('Escape');
  assert.equal(await f.page.getByRole('heading',{level:1}).textContent(),'Visão geral');
 }finally{await f.close();}
});
test('browser: tema salva no operador em suporte e sincroniza sem trocar a conta alvo',async()=>{
 const f=await open({support:true,theme:'dark',viewport:{width:390,height:844}});try{
  assert.equal(await f.page.locator('#support-banner').isVisible(),true);
  await f.page.getByRole('button',{name:'Usar tema claro',exact:true}).click();await f.page.waitForFunction(()=>document.querySelector('#appearance-feedback')?.textContent.includes('salvo na sua conta'));
  assert.equal(f.getTheme(),'light');assert.equal(await f.page.locator('html').getAttribute('data-theme'),'light');
  const saved=await f.page.evaluate(({M,B})=>({operator:localStorage.getItem(`ienvia:appearance:v1:${M}`),target:localStorage.getItem(`ienvia:appearance:v1:${B}`)}),{M,B});assert.deepEqual(saved,{operator:'light',target:null});
  assert.ok(f.calls.filter(c=>c.path==='/api/dashboard/summary'||c.path==='/api/dashboard/appearance').every(c=>c.headers['x-zapia-act-as']===B));
  const put=f.calls.find(c=>c.method==='PUT');assert.deepEqual(put.body,{theme:'light'});await capture(f.page,'mobile-claro-suporte');
 }finally{await f.close();}
});
test('browser: falha de atualização preserva números, mas não mantém conexão/motor confirmados',async()=>{
 const data=fixture();data.connections.status='connected';data.connections.connected=1;data.connections.workerOnline=true;data.connections.slots[0].status='connected';
 const f=await open({data});try{f.setFailure({status:503});await f.page.getByRole('button',{name:'Atualizar',exact:true}).click();await f.page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent==='Dados desatualizados');assert.equal(await f.page.locator('#count-conversations').textContent(),'1.234');assert.equal(await f.page.locator('#wa-tag').textContent(),'Não atualizado');assert.equal(await f.page.locator('#worker-tag').textContent(),'Não atualizado');await capture(f.page,'desktop-dados-desatualizados');}finally{await f.close();}
});
test('browser: primeiro erro não mostra zeros; sessão negada remove os dados antigos',async()=>{
 const initial=await open({failure:{status:503}});try{await initial.page.getByRole('heading',{name:'Resumo indisponível agora'}).waitFor();assert.equal(await initial.page.locator('.metrics-strip').count(),0);await capture(initial.page,'erro-inicial');}finally{await initial.close();}
 const f=await open();try{f.setFailure({status:403});await f.page.getByRole('button',{name:'Atualizar',exact:true}).click();await f.page.getByRole('heading',{name:'Acesso não autorizado'}).waitFor();assert.equal(await f.page.locator('#count-conversations').count(),0);}finally{await f.close();}
});
test('browser: vazio é zero real; falha do tema tem feedback e retry exclusivo da preferência',async()=>{
 const empty=await open({empty:true});try{assert.equal(await empty.page.locator('#count-conversations').textContent(),'0');assert.equal(await empty.page.locator('#activity-empty').isVisible(),true);await capture(empty.page,'desktop-vazio');}finally{await empty.close();}
 const f=await open({failTheme:true});try{await f.page.getByRole('button',{name:'Usar tema claro',exact:true}).click();await f.page.getByRole('button',{name:'Tentar salvar tema'}).waitFor();assert.equal(await f.page.locator('html').getAttribute('data-theme'),'light');assert.equal(f.calls.some(c=>/send|connect|campanhas/.test(c.path)),false);}finally{await f.close();}
});
test('browser: nomes vindos da conta são texto, nunca HTML executável',async()=>{
 const data=fixture({role:'master'});data.viewer.displayName='<img src=x onerror=alert(1)>';data.tenant.displayName='<script>invasao()</script>';
 const f=await open({data});try{assert.equal(await f.page.locator('.workspace-label strong').textContent(),data.viewer.displayName);assert.ok((await f.page.locator('#tenant-description').textContent()).includes(data.tenant.displayName));assert.equal(await f.page.locator('.workspace-label img').count(),0);await f.page.keyboard.press('Control+k');await f.page.getByRole('searchbox').fill('contas');assert.equal(await f.page.locator('#search-results a').getAttribute('href'),'/painel#contas');}finally{await f.close();}
});

test('browser: contraste básico claro/escuro, tela estreita e links para abas que realmente existem',async()=>{
 const legacy=fs.readFileSync('public/painel.html','utf8');
 for(const theme of ['dark','light']){
  const f=await open({theme,viewport:{width:320,height:2600}});
  try{
   await f.page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(await contrastIssues(f.page),[]);
   const links=await f.page.locator('a[href^="/painel#"]').evaluateAll(els=>els.map(e=>e.getAttribute('href').split('#')[1]));
   for(const id of links)assert.ok(legacy.includes(`id="tab-${id}"`),`Aba inexistente: ${id}`);
  }finally{await f.close();}
 }
});

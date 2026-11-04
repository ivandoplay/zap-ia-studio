import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import express from 'express';import {chromium} from 'playwright';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');
test('revisão estática: manifesto íntegro, fontes sincronizadas e nenhum runtime ou segredo publicado',()=>{
 execFileSync(process.execPath,['review-site/verify-static.mjs']);const manifest=JSON.parse(fs.readFileSync('review-site/manifest.json'));
 for(const [file,hash]of Object.entries(manifest.sourceHashes))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Regere o site antes de publicar: '+file);
 for(const file of Object.keys(manifest.publicHashes))assert.doesNotMatch(file,/session-client|connections-app|history-app|(^|\/)api\/|\.env/);
 assert.equal(fs.existsSync('review-site/public/api'),false);
 const config=JSON.parse(fs.readFileSync('review-site/vercel.json'));assert.ok(config.headers[0].headers.some(h=>h.key==='Content-Security-Policy'&&h.value.includes("connect-src 'none'")));
});
test('revisão estática: navega, alterna temas e cenários sem ler sessão real ou chamar APIs',async()=>{
 const app=express(),config=JSON.parse(fs.readFileSync('review-site/vercel.json'));
 app.use((_q,r,next)=>{for(const h of config.headers[0].headers)r.setHeader(h.key,h.value);next();});app.use(express.static('review-site/public'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1440]){
   const ctx=await browser.newContext({viewport:{width,height:1000}}),page=await ctx.newPage(),errors=[],network=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push(r.url()));
   await page.addInitScript(()=>{window.__attempts=[];localStorage.setItem('zapia_cloud_auth','SYNTHETIC_SESSION_DO_NOT_READ');const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(['zapia_cloud_auth','zapia_act_as','zapia_pin'].includes(key))window.__attempts.push('session:'+key);return get.call(this,key);};window.fetch=()=>{window.__attempts.push('fetch');throw Error('Network forbidden');};XMLHttpRequest.prototype.open=function(){window.__attempts.push('xhr');throw Error('Network forbidden');};window.WebSocket=class{constructor(){window.__attempts.push('ws');throw Error('Network forbidden');}};});
   await page.goto(base+'/visao-geral/');await page.waitForSelector('#count-conversations');assert.equal(await page.locator('#count-conversations').textContent(),'1.234');assert.equal(await page.locator('.review-banner strong').textContent(),'Revisão visual · dados de demonstração');
   await page.selectOption('#review-scenario','empty');assert.equal(await page.locator('#count-conversations').textContent(),'0');await page.selectOption('#review-scenario','stale');assert.equal(await page.locator('#sync-status').textContent(),'Dados desatualizados');await page.getByRole('button',{name:'Usar tema claro',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   await page.goto(base+'/conexoes/');await page.waitForSelector('.connection-chip');assert.equal(await page.locator('.connection-chip').count(),3);await page.getByRole('button',{name:'Gerenciar Chip 2',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#control-fields').disabled);await page.selectOption('#control-transport','evolution_api');await page.locator('#control-confirm').check();await page.locator('#control-submit').click();await page.locator('#control-qr').filter({hasText:'QR não gerado na demonstração'}).waitFor();await page.getByRole('button',{name:'Fechar controles'}).click();await page.selectOption('#review-scenario','support');assert.equal(await page.locator('#connections-support').isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(await page.evaluate(()=>window.__attempts),[]);assert.deepEqual(errors,[]);assert.ok(network.every(url=>url.startsWith(base+'/')&&!url.includes('/api/')));
   await page.goto(base+'/em-preparo/?pagina=crm');await page.getByRole('heading',{name:'Esta aba ainda será reformada'}).waitFor();assert.deepEqual(await page.evaluate(()=>window.__attempts),[]);
   await ctx.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

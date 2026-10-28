// Requer Playwright instalado fora do produto: ZAPIA_PLAYWRIGHT_REQUIRE=/caminho/para/package.json node tests/landing-browser.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
if (!process.env.ZAPIA_PLAYWRIGHT_REQUIRE) throw new Error('Defina ZAPIA_PLAYWRIGHT_REQUIRE para o package.json de um ambiente com Playwright.');
const require=createRequire(process.env.ZAPIA_PLAYWRIGHT_REQUIRE);
const {chromium}=require('playwright');
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='dados-sinteticos';
const {app}=await import('../src/server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({headless:true});
try {
 for(const width of [320,375,768,1440]){
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const u=route.request().url();
   if(u.startsWith(base+'/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"authRequired":true,"error":"Teste offline"}'});
   if(!u.startsWith(base))return route.abort();return route.continue();
  });
  await page.goto(base+'/',{waitUntil:'load'});
  for(const selector of ['.hero-copy','.hero-visual','#heroPrimaryWaBtn','.sim-shell']){
   const r=await page.locator(selector).boundingBox();assert(r && r.x>=0 && r.x+r.width<=width+0.5,`${selector} cortado em ${width}px: ${JSON.stringify(r)}`);
  }
  assert.equal(await page.locator('#calcTicket').inputValue(),'450');
  assert.equal(await page.locator('#calcMonthlyMoney').textContent(),'R$ 9.000');
  await page.locator('#calcTicket').fill('500');assert.notEqual(await page.locator('#calcMonthlyMoney').textContent(),'R$ 9.000');
  assert.match(await page.locator('#heroPrimaryWaBtn').getAttribute('href'),/^https:\/\/wa\.me\/\d+\?text=/);
  const play=page.getByRole('button',{name:'Simular reprodução de nota de voz'});
  await play.click();assert.equal(await play.textContent(),'❚❚');await play.click();assert.equal(await play.textContent(),'▶');
  const tabs=page.getByRole('tab');assert.equal(await tabs.count(),4);
  await tabs.nth(0).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true');
  assert.equal(await tabs.nth(1).evaluate(e=>document.activeElement===e),true);
  await page.keyboard.press('End');assert.equal(await tabs.nth(3).getAttribute('aria-selected'),'true');
  assert.match(await page.locator('#simTitle').textContent(),/Distribuidora/);
  await page.keyboard.press('Home');assert.equal(await tabs.nth(0).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Resumo para você'}).click();
  assert.match(await page.locator('#simThreadArea').innerText(),/Dossiê/);
  await page.getByRole('button',{name:'Conversa',exact:true}).click();
  await page.getByText('O motor precisa ficar ligado?').click();
  assert.equal(await page.locator('.faq-item').filter({hasText:'O motor precisa ficar ligado?'}).evaluate(e=>e.open),true);
  assert.equal(await page.locator('#orbitStage').evaluate(e=>e.classList.contains('has-webgl')),false);
  const panelLink=page.getByRole('link',{name:/Já sou cliente/});assert.equal(await panelLink.getAttribute('href'),'/painel');
  await page.goto(base+'/painel',{waitUntil:'load'});await page.locator('#cloudLoginScreen.open').waitFor();
  assert.equal(await page.locator('#cloudLoginTitle').textContent(),'Ienvia');
  await page.evaluate(() => applyBrandingToDom({appName:'ZAP-IA Studio'}));assert.equal(await page.locator('#brandTitleEl').textContent(),'Ienvia');
  await page.evaluate(() => applyBrandingToDom({appName:'Marca do Cliente'}));assert.equal(await page.locator('#brandTitleEl').textContent(),'Marca do Cliente');
  await page.getByLabel('Usuário',{exact:true}).fill('teste');await page.getByLabel('Senha',{exact:true}).fill('senha-ficticia');
  await page.getByRole('button',{name:'Mostrar ou ocultar senha'}).click();assert.equal(await page.locator('#cloudLoginPass').getAttribute('type'),'text');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('OK: vitrine e login em 320, 375, 768 e 1440px; navegação por teclado e calculadora.');
} finally {await browser.close();await new Promise(r=>server.close(r));}

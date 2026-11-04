import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';
import { contrastIssues } from './contrast.mjs';
let server, browser, base;
const artifacts = process.env.PREVIEW_ARTIFACTS || '/home/user/auditoria/arquitetura-v2/previews/escuro-padrao';
before(async () => { await fs.mkdir(artifacts,{recursive:true}); server=createPreviewServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`; browser=await chromium.launch(); });
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function pageFor(width=390, theme) {
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();
  if(theme) await page.addInitScript(value=>{localStorage.setItem('ienvia:appearance:v1:preview-demo',value);},theme);
  await context.route('**/*',route=>{
    assert.equal(new URL(route.request().url()).origin,base,'não deve acessar origem externa');
    assert.equal(route.request().method(),'GET','tema não deve enviar operações ao servidor');
    return route.continue();
  });
  return page;
}
async function open(page,path='/'){await page.goto(base+path,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);}
async function theme(page){return page.locator('html').getAttribute('data-theme');}

test('escuro é o padrão e o controle está visível no mobile',async()=>{
  const p=await pageFor();await open(p);assert.equal(await theme(p),'dark');
  assert.equal(await p.getByRole('button',{name:'Usar tema claro',exact:true}).isVisible(),true);
  assert.equal(await p.locator('meta[name="theme-color"]').getAttribute('content'),'#101815');await p.close();
});
test('claro persiste no recarregamento e nas outras páginas sem alterar os dados',async()=>{
  const p=await pageFor();await open(p);const before=await p.locator('[data-number]').allTextContents();
  await p.getByRole('button',{name:'Usar tema claro',exact:true}).click();assert.equal(await theme(p),'light');
  assert.deepEqual(await p.locator('[data-number]').allTextContents(),before);
  await p.reload({waitUntil:'networkidle'});assert.equal(await theme(p),'light');
  await p.screenshot({path:artifacts+'/alternancia-mobile-claro.png',fullPage:true});
  for(const path of ['/conexoes/','/revisao/?pagina=campanhas']) {await open(p,path);assert.equal(await theme(p),'light');}
  await p.getByRole('button',{name:'Usar tema escuro',exact:true}).click();await p.reload({waitUntil:'networkidle'});assert.equal(await theme(p),'dark');await p.close();
});
test('abas do mesmo navegador sincronizam a escolha de aparência',async()=>{
  const p=await pageFor();await open(p);const other=await p.context().newPage();await other.goto(base,{waitUntil:'networkidle'});
  await p.getByRole('button',{name:'Usar tema claro',exact:true}).click();
  await other.getByRole('button',{name:'Usar tema escuro',exact:true}).waitFor();assert.equal(await theme(other),'light');
  await other.evaluate(()=>localStorage.removeItem('ienvia:appearance:v1:preview-demo'));
  await p.getByRole('button',{name:'Usar tema claro',exact:true}).waitFor();assert.equal(await theme(p),'dark');await p.close();await other.close();
});
test('armazenamento negado não quebra a página e a escolha funciona na aba',async()=>{
  const p=await pageFor();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Bloqueado','SecurityError');}}));
  await open(p);assert.equal(await theme(p),'dark');await p.getByRole('button',{name:'Usar tema claro',exact:true}).click();assert.equal(await theme(p),'light');
  assert.match(await p.locator('#appearance-feedback').textContent(),/não foi possível salvar/);assert.deepEqual(errors,[]);await p.close();
});
test('preferência clara é aplicada antes do módulo principal, mesmo se ele não carregar',async()=>{
  const p=await pageFor(390,'light');await p.route('**/assets/dashboard.js',route=>route.abort());await open(p);
  assert.equal(await theme(p),'light');assert.equal(await p.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(244, 247, 245)');await p.close();
});
test('valor inválido salvo retorna ao escuro sem injeção de atributo',async()=>{
  const p=await pageFor(390,'<img src=x onerror=alert(1)>');await open(p);assert.equal(await theme(p),'dark');assert.equal(await p.locator('html').getAttribute('onerror'),null);await p.close();
});
for(const color of ['dark','light']) {
  for(const [name,path] of [['dashboard','/'],['evolution','/conexoes/'],['local','/conexoes/?modo=local'],['revisao','/revisao/?pagina=campanhas']]) {
    test(`contraste básico: ${name} no tema ${color}`,async()=>{
      const p=await pageFor(390,color);await open(p,path);assert.deepEqual(await contrastIssues(p),[]);await p.close();
    });
  }
  test(`busca e diálogo de informações continuam legíveis e operáveis em ${color}`,async()=>{
    const p=await pageFor(390,color);await open(p);await p.getByRole('button',{name:'Buscar página',exact:true}).click();
    assert.deepEqual(await contrastIssues(p),[]);await p.keyboard.press('Escape');
    await p.getByRole('button',{name:'Sobre a conta de demonstração',exact:true}).click();assert.deepEqual(await contrastIssues(p),[]);
    await p.keyboard.press('Escape');assert.equal(await p.locator('#info-dialog').isVisible(),false);await p.close();
  });
}
for(const width of [320,390,1440]) {
  test(`tema claro em ${width}px não cria overflow nem esconde o seletor`,async()=>{
    const p=await pageFor(width,'light');for(const path of ['/','/conexoes/','/revisao/?pagina=campanhas']) {
      await open(p,path);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
      assert.equal(await p.getByRole('button',{name:'Usar tema escuro',exact:true}).isVisible(),true);
    }await p.close();
  });
}

test('ações da Visão geral apenas navegam e não enviam comandos nem consultam APIs reais',async()=>{
  const p=await pageFor();const requests=[];p.on('request',r=>requests.push({path:new URL(r.url()).pathname,method:r.method()}));
  const cases=[
    ['Abrir conversas','/revisao/?pagina=crm&area=inbox'],
    ['Conferir conexões','/conexoes/'],
    ['Ver conexões e motor','/conexoes/'],
    [/^Conversa de exemplo/,'/revisao/?pagina=crm&area=inbox'],
    [/^Campanha de exemplo/,'/revisao/?pagina=campanhas'],
    [/^Verificar prontidão dos chips/,'/conexoes/']
  ];
  for(const [name,destination] of cases) {
    await open(p);assert.equal(await p.locator('#chart-bars li').count(),7);
    await p.getByRole('link',{name,exact:typeof name==='string'}).click();await p.waitForURL(base+destination);
  }
  assert(requests.every(r=>r.method==='GET'&&!r.path.startsWith('/api/')));await p.close();
});

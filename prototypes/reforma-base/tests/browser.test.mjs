import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';
import { contrastIssues } from './contrast.mjs';

let server, browser, base;
const artifacts = process.env.PREVIEW_ARTIFACTS || '/home/user/auditoria/arquitetura-v2/previews';
before(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  server = createPreviewServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
async function newPage(width = 1440, height = 960) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors = [], external = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method()); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  return { page, errors, external, writes };
}
async function open(page, pathname = '/') { await page.goto(base + pathname, { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); }

test('servidor da prévia não expõe .env, API ou operações de escrita', async () => {
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/api/bootstrap')).status, 404);
  assert.equal((await fetch(base + '/api/send', { method: 'POST' })).status, 405);
});

test('navegação abre outra página, preserva URL direta e não carrega módulos da tela anterior', async () => {
  const { page, errors } = await newPage();
  await open(page);
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Conexões e motor', exact: true }).click();
  await page.waitForURL('**/conexoes/**');
  assert.equal(await page.locator('h1').textContent(), 'Conexões e motor');
  assert.equal(await page.locator('.nav-item[aria-current="page"]').textContent(), 'Conexões e motor');
  await page.reload({ waitUntil: 'networkidle' });
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  assert(resources.every(url => !url.endsWith('/dashboard.js') && !url.endsWith('/dashboard.css') && !url.endsWith('/app.js')));
  await page.goBack({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('h1').textContent(), 'Sua operação, com clareza.');
  assert.deepEqual(errors, []); await page.close();
});

test('busca abre por teclado, encontra Conexões sem acento e lida com ausência de resultados', async () => {
  const { page } = await newPage(); await open(page);
  await page.keyboard.press('Control+k');
  await page.locator('#search-dialog').waitFor({ state: 'visible' });
  await page.getByRole('searchbox').fill('CONEXOES');
  assert.equal(await page.locator('.search-result').count(), 1);
  await page.getByRole('searchbox').fill('inexistente');
  assert.match(await page.locator('#search-results').textContent(), /Nenhuma página encontrada/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#search-dialog').isVisible(), false); await page.close();
});

test('menu mobile controla foco, Escape e navegação sem prender o conteúdo', async () => {
  const { page } = await newPage(390, 844); await open(page);
  const button = page.getByRole('button', { name: 'Abrir menu', exact: true });
  await button.click();
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#workspace').evaluate(element => element.inert), true);
  assert.equal(await page.getByRole('button', { name: 'Fechar menu', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.screenshot({ path: `${artifacts}/menu-mobile.png`, fullPage: false });
  await page.keyboard.press('Escape');
  assert.equal(await button.getAttribute('aria-expanded'), 'false');
  assert.equal(await button.evaluate(element => element === document.activeElement), true);
  await button.click();
  await page.getByRole('link', { name: 'Conexões e motor', exact: true }).click();
  await page.waitForURL('**/conexoes/**');
  assert.equal(await page.locator('#workspace').evaluate(element => element.inert), false); await page.close();
});

test('cenário de Motor local responde ao teclado e permanece selecionado após recarregar', async () => {
  const { page } = await newPage(); await open(page, '/conexoes/');
  await page.getByRole('tab', { name: 'Evolution na nuvem' }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Motor local', exact: true }).getAttribute('aria-selected'), 'true');
  assert.match(page.url(), /modo=local/);
  assert.equal(await page.locator('#panel-local').isVisible(), true);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#panel-local').isVisible(), true);
  await page.getByRole('tab', { name: 'Motor local', exact: true }).focus(); await page.keyboard.press('Home');
  assert.equal(await page.locator('#panel-cloud').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Conectar chip', exact: true }).isDisabled(), true); await page.close();
});

test('as quatro subáreas de CRM abrem sua indicação de revisão, sem fingir implementação', async () => {
  const { page } = await newPage();
  for (const [id, label] of [['inbox','Caixa de entrada'],['contatos','Contatos'],['kanban','Kanban'],['coach','Coach']]) {
    await open(page, `/revisao/?pagina=crm&area=${id}`);
    assert.equal(await page.locator('h1').textContent(), `Conversas: ${label}`);
    assert.match(await page.locator('.empty-review').textContent(), /ainda não foram migradas/);
    assert.equal(await page.locator('.subnav a[aria-current="page"]').textContent(), label);
  }
  await page.close();
});

test('parâmetros desconhecidos não injetam HTML nem mensagens arbitrárias na tela', async () => {
  const { page, errors } = await newPage();
  await open(page, '/revisao/?pagina=' + encodeURIComponent('<img src=x onerror="window.__xss=1">'));
  assert.equal(await page.locator('h1').textContent(), 'Página em revisão');
  assert.equal(await page.evaluate(() => window.__xss), undefined); assert.deepEqual(errors, []); await page.close();
});

test('informações da prévia abrem em diálogo acessível e fecham com Escape', async () => {
  const { page } = await newPage(); await open(page);
  await page.getByRole('button', { name: 'Sobre a conta de demonstração' }).click();
  await page.getByRole('dialog', { name: 'Uma prévia, não sua operação real' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#info-dialog').isVisible(), false); await page.close();
});

for (const [name, pathname] of [['visão geral', '/'], ['conexões', '/conexoes/']]) {
  test(`texto sólido visível de ${name} passa na verificação básica de contraste`, async () => {
    const { page } = await newPage(); await open(page, pathname);
    assert.deepEqual(await contrastIssues(page), []); await page.close();
  });
}
for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`páginas em ${width}px: sem overflow, erro JS, rede externa ou envio`, async () => {
    const { page, errors, external, writes } = await newPage(width, width < 600 ? 844 : 960);
    for (const [name, pathname] of [['base', '/'], ['conexoes', '/conexoes/']]) {
      await open(page, pathname);
      const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert(geometry.scroll <= geometry.width + 1, `${name}: ${JSON.stringify(geometry)}`);
      assert.equal(await page.locator('h1').count(), 1);
      if (width === 390 || width === 1440) await page.screenshot({ path: `${artifacts}/${name}-${width < 600 ? 'mobile' : 'desktop'}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []); await page.close();
  });
}

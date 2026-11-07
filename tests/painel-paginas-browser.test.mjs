// Navegação real pelas páginas separadas do painel antigo, em Chromium:
// abre cada página, confere que a aba certa aparece, que as outras não vazam e que o menu
// leva de uma página para a outra (URL muda de verdade).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { PAGINAS } from '../scripts/gerar-paginas-painel.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const app = express();
app.use(express.static(path.join(RAIZ, 'public')));
// O painel chama /api/* no boot: responde o mínimo para a tela montar sem tocar em nada real.
app.all('/api/*splat', (_req, res) => res.json({ ok: false, error: 'sem_api_neste_teste' }));
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
test.after(async () => { await browser.close(); await new Promise(r => server.close(r)); });

async function abrir(rota) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const erros = [];
  await c.addInitScript(() => {
    localStorage.setItem('zapia_cloud_auth', JSON.stringify({ accessToken: 'SYNTHETIC' }));
    sessionStorage.setItem('zapia_pin', '1234');
  });
  await c.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== base) return r.abort();
    return r.continue();
  });
  const p = await c.newPage();
  p.on('pageerror', e => erros.push(e.message));
  await p.goto(`${base}/${rota}/`);
  return { c, p, erros };
}

test('cada aba é uma página: só a seção da página aparece, as outras ficam escondidas', async () => {
  for (const pagina of PAGINAS) {
    const { c, p } = await abrir(pagina.rota);
    try {
      await p.waitForSelector(`#tab-${pagina.tab}.active`, { timeout: 15000 });
      assert.equal(await p.locator(`#tab-${pagina.tab}`).isVisible(), true, `${pagina.rota}: aba não apareceu`);
      for (const outra of PAGINAS) {
        if (outra.tab === pagina.tab) continue;
        assert.equal(await p.locator(`#tab-${outra.tab}`).isVisible(), false, `${pagina.rota}: aba ${outra.tab} vazou`);
      }
      // o menu continua inteiro e clicável
      assert.ok(await p.locator('.nav-btn[data-tab]').count() >= 9, `${pagina.rota}: menu incompleto`);
    } finally { await c.close(); }
  }
});

test('o menu troca de página (URL muda), sem recarregar conteúdo perdido', async () => {
  const { c, p, erros } = await abrir('visao-geral');
  try {
    await p.waitForSelector('#tab-dashboard.active', { timeout: 15000 });
    await p.locator('.nav-btn[data-tab="campanhas"]').click();
    await p.waitForURL(/\/campanhas\/$/, { timeout: 15000 });
    await p.waitForSelector('#tab-campanhas.active', { timeout: 15000 });
    assert.equal(await p.locator('#tab-campanhas').isVisible(), true);
    await p.locator('.nav-btn[data-tab="conversas-inexistente"]').count();
    await p.locator('.nav-btn[data-tab="crm"]').click();
    await p.waitForURL(/\/conversas\/$/, { timeout: 15000 });
    await p.waitForSelector('#tab-crm.active', { timeout: 15000 });
    assert.equal(erros.filter(e => !/Failed to fetch|NetworkError/i.test(e)).length, 0, `erros de página: ${erros.join(' | ')}`);
  } finally { await c.close(); }
});

// Prova visual da limpeza: abre a MESMA aba no HTML antigo (backup) e no novo, e compara
// as capturas pixel a pixel. Serve para garantir que trocar `style=` por classe não mudou
// aparência — o que era inline continua valendo igual.
//
// Uso: node scripts/comparar-visual.mjs <arquivo-antigo.html> <aba> [largura]
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const RAIZ = path.resolve(import.meta.dirname, '..');
const [antigo, aba, larguraArg] = process.argv.slice(2);
const largura = Number(larguraArg) || 1440;

const app = express();
app.use(express.static(path.join(RAIZ, 'public')));
// O arquivo antigo não conhece window.IENVIA_PAGINA (isso entrou junto com as páginas
// separadas). Injetamos a mesma marcação para as duas versões abrirem a MESMA aba.
app.get(['/__antigo/','/__antigo/index.html'], (_req, res) => {
  const html = fs.readFileSync(antigo, 'utf8').replace(
    '<script src="/app.js"></script>',
    `<script>window.IENVIA_PAGINA='${aba}';</script><script src="/app.js"></script>`
  );
  res.type('html').send(html);
});
app.get(['/','/index.html'], (_req, res) => res.type('html').send(fs.readFileSync(path.join(RAIZ, 'public', 'painel.html'), 'utf8')));
app.all('/api/*splat', (_req, res) => res.json({ ok: false }));
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function capturar(url) {
  const c = await browser.newContext({ viewport: { width: largura, height: 900 }, deviceScaleFactor: 1 });
  await c.addInitScript(([t]) => {
    localStorage.setItem('zapia_cloud_auth', JSON.stringify({ accessToken: 'SYNTHETIC' }));
    sessionStorage.setItem('zapia_pin', '1234');
    window.IENVIA_PAGINA = t;
  }, [aba]);
  await c.route('**/*', r => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
  const p = await c.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  // Espera existir e ficar visível (a aba da página; as outras ficam hidden).
  // Diagnóstico em caso de falha: mostra o que a página realmente tem.
  try {
    await p.waitForSelector(`#tab-${aba}.active`, { state: 'visible', timeout: 20000 });
  } catch (erro) {
    const info = await p.evaluate(a => ({ pagina: window.IENVIA_PAGINA, cls: document.querySelector(`#tab-${a}`)?.className, href: location.href }), aba).catch(() => null);
    console.error('diagnóstico:', JSON.stringify(info));
    throw erro;
  }
  await p.waitForTimeout(1200);
  const bytes = await p.locator(`#tab-${aba}`).screenshot();
  await c.close();
  return bytes;
}

const antes = await capturar(`${base}/__antigo/`);
const depois = await capturar(`${base}/painel.html`);
await browser.close();
await new Promise(r => server.close(r));

const iguais = antes.equals(depois);
const destino = path.join(os.tmpdir(), `visual-${aba}-${largura}`);
fs.mkdirSync(destino, { recursive: true });
fs.writeFileSync(path.join(destino, 'antes.png'), antes);
fs.writeFileSync(path.join(destino, 'depois.png'), depois);
console.log(`${aba} @ ${largura}px → ${iguais ? 'IDÊNTICO' : 'DIFERENTE'} (${antes.length}b vs ${depois.length}b)`);
console.log(`capturas: ${destino}`);
process.exit(iguais ? 0 : 1);

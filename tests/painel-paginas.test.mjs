// Garante que a separação do painel antigo em páginas não perde NADA: cada página tem que
// conter todos os elementos do mestre, menos as abas (que são distribuídas entre páginas).
//
// Se alguém editar public/painel.html e esquecer de regerar, este teste falha e diz o comando.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { executar, PAGINAS, gerarTodas, abasDoMestre } from '../scripts/gerar-paginas-painel.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const mestre = fs.readFileSync(path.join(RAIZ, 'public', 'painel.html'), 'utf8');

const idsDe = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const idsDeAba = html => {
  const out = new Set();
  for (const m of html.matchAll(/<section id="tab-([a-z0-9-]+)" class="tab-pane[\s\S]*?(?=<section id="tab-|<\/main>)/g)) {
    for (const id of idsDe(m[0])) out.add(id);
  }
  return out;
};

test('cada página existe, tem base href, título próprio e a aba certa ativa', () => {
  for (const pagina of gerarTodas(mestre)) {
    const arquivo = path.join(RAIZ, 'public', pagina.rota, 'index.html');
    assert.ok(fs.existsSync(arquivo), `falta public/${pagina.rota}/index.html — rode: node scripts/gerar-paginas-painel.mjs`);
    const html = fs.readFileSync(arquivo, 'utf8');
    assert.match(html, /<base href="\/" \/>/, 'página sem <base href="/">');
    assert.match(html, new RegExp(`<title>Ienvia — ${pagina.titulo}</title>`));
    assert.ok(html.includes(`window.IENVIA_PAGINA='${pagina.tab}'`), 'página não declara a aba');
    assert.match(html, new RegExp(`<section id="tab-${pagina.tab}" class="tab-pane active">`));
    // As outras abas ficam presentes (o app.js depende delas) porém escondidas.
    for (const aba of abasDoMestre(mestre)) {
      if (aba === pagina.tab) continue;
      assert.match(html, new RegExp(`<section id="tab-${aba}" class="tab-pane" hidden>`), `aba ${aba} não pode aparecer aberta em ${pagina.rota}`);
    }
  }
});

test('nenhum elemento do mestre se perde fora das abas (modais, gavetas, login)', () => {
  const comuns = new Set([...idsDe(mestre)].filter(id => !idsDeAba(mestre).has(id)));
  assert.ok(comuns.size > 50, `esperava muitos elementos comuns, achei ${comuns.size}`);
  for (const pagina of gerarTodas(mestre)) {
    const html = fs.readFileSync(path.join(RAIZ, 'public', pagina.rota, 'index.html'), 'utf8');
    const tem = idsDe(html);
    for (const id of comuns) assert.ok(tem.has(id), `public/${pagina.rota}/index.html perdeu #${id}`);
  }
});

test('a seção da aba correspondente é idêntica à do mestre', () => {
  const secao = (html, aba) => {
    const i = html.indexOf(`<section id="tab-${aba}" class="tab-pane`);
    assert.ok(i > 0, `aba ${aba} ausente`);
    const fim = html.indexOf('<section id="tab-', i + 10);
    const corte = fim < 0 ? html.indexOf('</main>', i) : fim;
    // tira só a marcação de classe/hidden do cabeçalho da seção
    return html.slice(i, corte).replace(/^<section id="tab-[a-z0-9-]+" class="tab-pane[^"]*"( hidden)?>/, '');
  };
  for (const pagina of gerarTodas(mestre)) {
    const html = fs.readFileSync(path.join(RAIZ, 'public', pagina.rota, 'index.html'), 'utf8');
    assert.equal(secao(html, pagina.tab), secao(mestre, pagina.tab), `conteúdo da aba ${pagina.tab} mudou em ${pagina.rota}`);
  }
});

test('menu lateral aponta para a página da aba e marca a página atual', () => {
  for (const pagina of gerarTodas(mestre)) {
    const html = fs.readFileSync(path.join(RAIZ, 'public', pagina.rota, 'index.html'), 'utf8');
    for (const outra of PAGINAS) {
      assert.ok(html.includes(`data-tab="${outra.tab}" data-rota="${outra.rota}"`), `menu sem destino para ${outra.tab}`);
    }
    const atual = html.match(new RegExp(`<button[^>]*data-tab="${pagina.tab}"[^>]*aria-current="page"[^>]*>`));
    assert.ok(atual, `página atual (${pagina.rota}) não está marcada no menu`);
  }
});

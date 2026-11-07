// Separa o painel antigo (public/painel.html, um arquivo único de ~214 KB) em uma página HTML
// por aba, mantendo TUDO funcionando com o mesmo app.js:
//
//  * `public/painel.html` continua sendo o arquivo mestre (não é reescrito) — o gerador só lê.
//  * Para cada aba sai `public/<rota>/index.html` com <base href="/"> e `?tab=<aba>`, que o
//    app.js lê no carregamento para já abrir a página certa.
//  * As abas que ficam em outras páginas recebem `hidden`, então não há dois conteúdo iguais
//    montados na tela. O que não pode sumir (overlays, modais, gavetas) é copiado inteiro.
//
// Uso: node scripts/gerar-paginas-painel.mjs [--check]
// `--check` falha se as páginas geradas estiverem diferentes do mestre (usado em teste).

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MESTRE = path.join(RAIZ, 'public', 'painel.html');

// aba do painel -> rota pública. A primeira é a "dona" do miolo comum (header, menus, modais).
export const PAGINAS = [
  { tab: 'dashboard', rota: 'visao-geral', titulo: 'Visão geral' },
  { tab: 'crm', rota: 'conversas', titulo: 'Atendimento e CRM' },
  { tab: 'historico', rota: 'historico', titulo: 'Histórico por instância' },
  { tab: 'instancias', rota: 'instancias', titulo: 'Instâncias' },
  { tab: 'conexoes', rota: 'conexoes', titulo: 'Conexões e motor' },
  { tab: 'campanhas', rota: 'campanhas', titulo: 'Campanhas' },
  { tab: 'treinamento', rota: 'treinamento', titulo: 'Treinamento' },
  { tab: 'catalogo', rota: 'catalogo', titulo: 'Catálogo' },
  { tab: 'audios', rota: 'audios', titulo: 'Áudios' },
  { tab: 'simulador', rota: 'simulador', titulo: 'Simulador' },
  { tab: 'ia', rota: 'inteligencia-artificial', titulo: 'Motor de IA' },
  { tab: 'seguranca', rota: 'seguranca', titulo: 'Segurança' },
  { tab: 'configuracoes', rota: 'configuracoes', titulo: 'Configurações' },
  { tab: 'contas', rota: 'contas', titulo: 'Contas' }
];


// Menu lateral: cada item aponta para a página da aba (navegação de verdade, com URL própria).
// `switchTab` continua no onclick como reforço para quando a página já é a certa.
const ROTA_POR_TAB = Object.fromEntries(PAGINAS.map(p => [p.tab, p.rota]));

function apontarMenu(html, rotaAtual) {
  let saida = html;
  for (const [tab, rota] of Object.entries(ROTA_POR_TAB)) {
    const re = new RegExp(`(<button[^>]*data-tab="${tab}")`, 'g');
    saida = saida.replace(re, (m) => {
      if (/data-rota=/.test(m)) return m;
      const atual = rota === rotaAtual ? ' aria-current="page"' : '';
      return `${m} data-rota="${rota}" onclick="location.href='/${rota}/'"${atual}`;
    });
  }
  return saida;
}

const escapeRE = texto => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Todas as abas declaradas no mestre, na ordem em que aparecem.
export function abasDoMestre(html) {
  return [...html.matchAll(/<section id="tab-([a-z0-9-]+)" class="tab-pane/g)].map(m => m[1]);
}

// Troca o `class` da seção da aba: só a aba da página fica ativa e as outras somem.
function ajustarSecao(html, abas, tabAtiva) {
  let saida = html;
  for (const aba of abas) {
    const abre = `<section id="tab-${aba}" class="tab-pane`;
    const i = saida.indexOf(abre);
    if (i < 0) continue;
    const fim = saida.indexOf('>', i);
    let tag = saida.slice(i, fim + 1);
    const ativa = aba === tabAtiva;
    let novo = tag.replace(/class="tab-pane[^"]*"/, `class="tab-pane${ativa ? ' active' : ''}"`);
    if (!ativa && !/\shidden[\s>]/.test(novo)) novo = novo.replace(/>$/, ' hidden>');
    if (ativa && /\shidden[\s>]/.test(novo)) novo = novo.replace(/\s+hidden(?=[\s>])/, '');
    saida = saida.slice(0, i) + novo + saida.slice(fim + 1);
  }
  return saida;
}

export function gerarPagina(mestre, { tab, titulo }) {
  const abas = abasDoMestre(mestre);
  if (!abas.includes(tab)) throw new Error(`Aba ausente no mestre: ${tab}`);
  let html = ajustarSecao(mestre, abas, tab);
  html = apontarMenu(html, ROTA_POR_TAB[tab]);
  // <base> mantém os caminhos absolutos (/app.js, /styles.css) válidos em qualquer rota.
  if (!html.includes('<base href="/">')) {
    html = html.replace(/(<head>\s*)/i, `$1<base href="/" />\n  `);
  }
  // O app.js abre a aba da URL; o título muda por página (aba do navegador).
  html = html.replace(/\?tab=[a-z-]+/g, ''); // limpa marcações antigas
  html = html.replace(
    /<script src="\/app\.js"><\/script>/,
    `<script>window.IENVIA_PAGINA='${tab}';</script>\n  <script src="/app.js"></script>`
  );
  html = html.replace(/<title>[^<]*<\/title>/, `<title>Ienvia — ${titulo}</title>`);
  return html;
}

export function gerarTodas(mestre = fs.readFileSync(MESTRE, 'utf8')) {
  return PAGINAS.map(pagina => ({ ...pagina, html: gerarPagina(mestre, pagina) }));
}

function principal() {
  const conferir = process.argv.includes('--check');
  const mestre = fs.readFileSync(MESTRE, 'utf8');
  const paginas = gerarTodas(mestre);
  let diferentes = 0;
  for (const pagina of paginas) {
    const destino = path.join(RAIZ, 'public', pagina.rota, 'index.html');
    const atual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : null;
    if (atual === pagina.html) continue;
    diferentes += 1;
    if (conferir) {
      console.error(`desatualizada: public/${pagina.rota}/index.html`);
      continue;
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, pagina.html);
    console.log(`escrita: public/${pagina.rota}/index.html (${pagina.titulo})`);
  }
  if (conferir && diferentes) process.exit(1);
  if (!diferentes) console.log('páginas já estão iguais ao mestre.');
}

// Exporta o executor para o teste conferir página por página sem tocar no disco.
export const executar = { gerarTodas, PAGINAS, abasDoMestre };

if (process.argv[1] && process.argv[1].endsWith('gerar-paginas-painel.mjs')) principal();

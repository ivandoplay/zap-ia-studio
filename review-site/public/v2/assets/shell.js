import { getNavigation, findPages } from './navigation.js';
import { icon } from './icons.js';
import { mountAppearance } from './appearance.js';

export function mountShell({ pageId, title, group = 'Operação', currentUser, permissions = {}, appearanceApi, aboutText }) {
  const page = document.querySelector('main');
  const role = permissions.master ? 'master' : 'user';
  const navigation = getNavigation(role);
  const allPages = navigation.flatMap(section => section.items);
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  const links = navigation.map(section => `<section class="nav-section"><h2>${section.label}</h2>${section.items.map(item => item.children
    ? `<details class="nav-folder" ${pageId === item.id ? 'open' : ''}><summary>${icon(item.icon)}<span>${item.label}</span>${icon('down', 'folder-arrow')}</summary><div class="subnav">${item.children.map(child => `<a href="${child.href}" ${pageId === item.id && new URLSearchParams(location.search).get('area') === child.id ? 'aria-current="page"' : ''}>${child.label}</a>`).join('')}</div></details>`
    : `<a class="nav-item ${pageId === item.id ? 'is-active' : ''}" href="${item.href}" ${pageId === item.id ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span>${item.id === 'contas' ? '<span class="master-tag">Master</span>' : ''}</a>`).join('')}</section>`).join('');
  shell.innerHTML = `
    <a class="skip-link" href="#main-content">Pular para o conteúdo</a>
    <aside class="sidebar" id="sidebar" aria-label="Navegação lateral">
      <div class="brand-row"><a class="brand" href="/visao-geral/" aria-label="Ienvia, visão geral"><img src="/v2/assets/ienvia-icon.png" width="38" height="38" alt=""><span translate="no">ienvia<span class="brand-dot">.</span></span></a><button class="icon-button nav-close" id="close-menu" type="button" aria-label="Fechar menu">${icon('close')}</button></div>
      <div class="workspace-label"><span class="workspace-monogram">D</span><div><strong>Minha conta</strong><span>Resumo da operação</span></div><span class="workspace-dot" aria-hidden="true"></span></div>
      <nav class="side-nav" aria-label="Menu principal">${links}</nav>
      <div class="sidebar-bottom"><div class="lab-status"><span></span>Resumo somente leitura</div><p>Acompanhe os dados da conta.<br>Esta tela não envia mensagens.</p><button class="sidebar-about" type="button" id="about-preview">${icon('info')}Sobre esta página</button></div>
    </aside>
    <button class="menu-backdrop" id="menu-backdrop" type="button" aria-label="Fechar menu lateral" hidden></button>
    <div class="workspace" id="workspace">
      <header class="topbar"><div class="topbar-left"><button class="icon-button menu-toggle" id="open-menu" type="button" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb"><span id="breadcrumb-group"></span>${icon('chevron')}<strong id="breadcrumb-page"></strong></div></div>
      <div class="topbar-actions"><button class="search-trigger" type="button" id="open-search" aria-label="Buscar página" aria-haspopup="dialog" aria-controls="search-dialog">${icon('search')}<span>Buscar página…</span><kbd>Ctrl K</kbd></button><button class="icon-button theme-toggle" id="theme-toggle" type="button" aria-label="Usar tema claro" title="Usar tema claro"></button><span class="topbar-divider" aria-hidden="true"></span><button class="icon-button" id="notifications" type="button" aria-label="Sobre a atualização dos dados">${icon('info')}</button><button class="avatar-button" type="button" id="about-account" aria-label="Informações da conta">D</button></div></header>
      <div id="page-slot"></div>
      <footer class="page-footer"><span>Ienvia • Reforma por etapas</span><span>Dados por conta · tema individual</span></footer>
    </div>
    <dialog id="search-dialog" class="search-dialog" aria-labelledby="search-title"><div class="dialog-heading"><h2 id="search-title">Para onde vamos?</h2><button class="icon-button" type="button" data-close-dialog aria-label="Fechar busca">${icon('close')}</button></div><label class="sr-only" for="page-search">Buscar uma página pelo nome</label><div class="search-input-wrap">${icon('search')}<input id="page-search" name="page-search" type="search" placeholder="Busque uma página…" autocomplete="off" spellcheck="false"></div><div class="search-results" id="search-results" aria-live="polite"></div><p class="dialog-footnote">Os demais menus abrem o painel atual, preservando sua operação.</p></dialog>
    <dialog id="info-dialog" class="info-dialog" aria-labelledby="info-title"><div class="dialog-heading"><h2 id="info-title"></h2><button class="icon-button" type="button" data-close-dialog aria-label="Fechar informação">${icon('close')}</button></div><p id="info-body"></p><button class="button button-primary" type="button" data-close-dialog>Entendi</button></dialog>
    <div id="appearance-feedback" class="theme-feedback" role="status" hidden></div><div class="sr-only" role="status" aria-live="polite" id="live-feedback"></div>`;
  document.body.prepend(shell);
  shell.querySelector('#page-slot').append(page);
  page.id = 'main-content';
  page.tabIndex = -1;
  shell.querySelector('#breadcrumb-group').textContent = group;
  shell.querySelector('#breadcrumb-page').textContent = title;
  document.title = `${title} · Ienvia`;
  shell.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  page.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });

  const sidebar = shell.querySelector('#sidebar');
  const workspace = shell.querySelector('#workspace');
  const backdrop = shell.querySelector('#menu-backdrop');
  const menuButton = shell.querySelector('#open-menu');
  const mobile = matchMedia('(max-width: 999px)');
  const searchDialog = shell.querySelector('#search-dialog');
  const infoDialog = shell.querySelector('#info-dialog');
  let menuOpen = false;
  function setMenu(open, returnFocus = true) {
    menuOpen = Boolean(open && mobile.matches);
    document.body.classList.toggle('menu-open', menuOpen);
    menuButton.setAttribute('aria-expanded', String(menuOpen));
    backdrop.hidden = !menuOpen;
    sidebar.inert = mobile.matches && !menuOpen;
    workspace.inert = menuOpen;
    if (menuOpen) {
      sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true');
      shell.querySelector('#close-menu').focus();
    } else {
      sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
      if (mobile.matches && returnFocus) menuButton.focus();
    }
  }
  setMenu(false, false);
  const onMobileChange = () => setMenu(false, false);
  mobile.addEventListener('change', onMobileChange);
  menuButton.addEventListener('click', () => setMenu(true));
  shell.querySelector('#close-menu').addEventListener('click', () => setMenu(false));
  backdrop.addEventListener('click', () => setMenu(false));
  const onKeyDown = event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (menuOpen) setMenu(false, false); openSearch(); }
    if (event.key === 'Escape' && searchDialog.open) { event.preventDefault(); searchDialog.close(); }
    else if (event.key === 'Escape' && infoDialog.open) { event.preventDefault(); infoDialog.close(); }
    else if (event.key === 'Escape' && menuOpen) { event.preventDefault(); setMenu(false); }
    if (event.key === 'Tab' && menuOpen && !searchDialog.open && !infoDialog.open) {
      const focusable = [...sidebar.querySelectorAll('a[href], button, summary')].filter(element => element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKeyDown);
  for (const dialog of [searchDialog, infoDialog]) {
    dialog.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  }
  const searchInput = shell.querySelector('#page-search');
  function renderSearch() {
    const results = shell.querySelector('#search-results');
    results.replaceChildren();
    for (const item of findPages(searchInput.value, role)) {
      const link = document.createElement('a'); link.className = 'search-result'; link.href = item.href;
      link.innerHTML = `${icon(item.icon)}<span></span>${icon('chevron')}`;
      link.querySelector('span').textContent = item.label; results.append(link);
    }
    if (!results.children.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = 'Nenhuma página encontrada. Tente outro nome.'; results.append(empty); }
  }
  function openSearch() { searchInput.value = ''; renderSearch(); searchDialog.showModal(); searchInput.focus(); }
  shell.querySelector('#open-search').addEventListener('click', openSearch);
  searchInput.addEventListener('input', renderSearch);
  function showInfo(heading, description) {
    shell.querySelector('#info-title').textContent = heading;
    shell.querySelector('#info-body').textContent = description;
    infoDialog.showModal();
  }
  const about = () => showInfo(title, aboutText || 'Esta página consulta um resumo de dados. Não envia mensagens, não inicia campanhas e não reconecta o WhatsApp. Os demais menus continuam no painel atual; Conexões / Motor abre a área atual de conexão até sua reforma.');
  shell.querySelector('#about-preview').addEventListener('click', about);
  shell.querySelector('#about-account').addEventListener('click', () => showInfo('Sua conta', `Operador: ${currentUser?.displayName || 'Painel local'}. A aparência pertence ao operador, inclusive durante o suporte a outra conta.`));
  shell.querySelector('#notifications').addEventListener('click', () => showInfo('Atualização dos dados', 'O resumo é atualizado a cada 30 segundos enquanto esta aba está visível. Falhas são sinalizadas e o último dado válido é identificado como desatualizado. Online no motor não significa conexão ativa no WhatsApp.'));
  shell.querySelector('.workspace-label strong').textContent = currentUser?.displayName || 'Painel local';
  for (const item of shell.querySelectorAll('.workspace-monogram, #about-account')) item.textContent = (currentUser?.displayName || 'L').slice(0, 1).toUpperCase();
  const disposeAppearance = mountAppearance({ currentUser, api: appearanceApi });
  return { showInfo, pages: allPages, dispose() { disposeAppearance(); document.removeEventListener('keydown', onKeyDown); mobile.removeEventListener('change', onMobileChange); document.body.classList.remove('menu-open'); workspace.inert = false; for (const dialog of [searchDialog, infoDialog]) if (dialog.open) dialog.close(); } };
}

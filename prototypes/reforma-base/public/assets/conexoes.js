import { mountShell } from './shell.js';
const { showInfo } = mountShell({ pageId: 'conexoes', title: 'Conexões e motor', group: 'Configurações' });
const tabs = [...document.querySelectorAll('[data-mode]')];
function selectMode(mode, focus = false) {
  const chosen = mode === 'local' ? 'local' : 'cloud';
  for (const tab of tabs) {
    const active = tab.dataset.mode === chosen;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    document.querySelector(`#panel-${tab.dataset.mode}`).hidden = !active;
    if (active && focus) tab.focus();
  }
  const url = new URL(location.href); url.searchParams.set('modo', chosen); history.replaceState(null, '', url);
}
selectMode(new URLSearchParams(location.search).get('modo'));
for (const tab of tabs) {
  tab.addEventListener('click', () => selectMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
    if (next !== null) { event.preventDefault(); selectMode(tabs[next].dataset.mode, true); }
  });
}
document.querySelector('#readiness-help').addEventListener('click', () => showInfo('Prontidão não é um único indicador', 'Um chip pode estar conectado sem existir executor disponível. Um executor pode estar ativo enquanto o WhatsApp está restrito. E um ID de mensagem aceito não comprova entrega. A integração deverá validar e mostrar esses estados separadamente.'));
document.querySelector('#restriction-help').addEventListener('click', () => showInfo('Respeitar a restrição da conta', 'Este é um cenário fictício. Em uma operação real, uma restrição confirmada exige respeitar a orientação do WhatsApp. A interface não deve reconectar, trocar de número ou repetir envios automaticamente para contornar a condição.'));

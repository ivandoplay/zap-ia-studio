import {mountShell} from './shell.js';
import {mountPage,renderSummary,setSyncState} from './view.js';
import {mountConnections,renderConnections,setConnectionsSync} from './connections-view.js';
import {demoData} from './demo-data.js';
const page=document.documentElement.dataset.reviewPage||'overview';
const scenarioValues=['normal','empty','stale','error','support'];
const params=new URLSearchParams(location.search);
let scenario=scenarioValues.includes(params.get('cenario'))?params.get('cenario'):'normal';
const data=demoData(scenario);
if(page==='overview')mountPage();else if(page==='conexoes')mountConnections();
const shell=mountShell({pageId:page,title:page==='overview'?'Visão geral':page==='conexoes'?'Conexões e motor':'Página ainda não reformada',currentUser:data.viewer,permissions:data.permissions,appearanceApi:{account:false},aboutText:'Revisão visual isolada com dados de demonstração. Não existe autenticação real, consulta a banco ou acesso ao WhatsApp. Os botões operacionais são exemplos desativados. O tema é salvo somente neste navegador da revisão.'});
function showPending(){shell.showInfo('Página ainda não reformada','Esta área ainda não foi implementada na reforma. Ela não abre o painel de produção e não executa operações. Você pode continuar avaliando Visão geral e Conexões / Motor.');}
function render(){
 const current=demoData(scenario);
 const exit=()=>{scenario='normal';select.value=scenario;render();};
 if(page==='overview'){
  renderSummary(current,{onExitSupport:exit});
  document.getElementById('sync-status').textContent='Dados de demonstração';
  document.getElementById('updated-at').textContent='Exemplo visual local · sem consulta à API';
  document.getElementById('data-caption').textContent='Exemplo visual, sem conexão ao banco';
  document.getElementById('data-tag').textContent='Demonstração';
  if(scenario==='stale'||scenario==='error')setSyncState('stale',scenario==='error'?'Simulação de falha de consulta. Nenhuma API foi chamada.':'Simulação de diagnóstico desatualizado. Estes estados não pertencem à sua conta.');
 }else if(page==='conexoes'){
  renderConnections(current,exit);
  document.getElementById('connections-sync').textContent='Dados de demonstração';
  document.getElementById('connections-time').textContent='Exemplo visual local · sem consulta à API';
  if(scenario==='stale'||scenario==='error')setConnectionsSync('stale','Simulação visual de indisponibilidade. Nenhuma sessão real é consultada ou alterada.');
 }
 document.querySelectorAll('a[href^="/painel"]').forEach(link=>{const area=link.hash.slice(1)||'painel';link.href=`/em-preparo/?pagina=${encodeURIComponent(area)}`;link.title='Página ainda não reformada — somente demonstração';});
}
const banner=document.createElement('section');banner.className='review-banner';banner.setAttribute('aria-label','Ambiente de revisão visual');
banner.innerHTML='<div><strong>Revisão visual · dados de demonstração</strong><span>Sem login real, banco de dados ou operações de WhatsApp. O site principal não foi alterado.</span></div><label for="review-scenario">Cenário <select id="review-scenario"><option value="normal">Padrão</option><option value="empty">Vazio</option><option value="stale">Desatualizado</option><option value="error">Falha simulada</option><option value="support">Suporte visual</option></select></label>';
document.getElementById('page-slot').before(banner);
const select=document.getElementById('review-scenario');select.value=scenario;
select.addEventListener('change',()=>{scenario=select.value;const url=new URL(location.href);url.searchParams.set('cenario',scenario);history.replaceState(null,'',url);render();});
document.querySelector('.workspace-label div>span').textContent='Ambiente visual isolado';
document.querySelector('.lab-status').lastChild.textContent=' Revisão sem integrações';
const refresh=document.getElementById(page==='conexoes'?'connections-refresh':'refresh-summary');
if(refresh){refresh.textContent='Recarregar exemplo';refresh.addEventListener('click',render);}
document.querySelectorAll('.search-dialog .dialog-footnote').forEach(el=>el.textContent='Visão geral e Conexões estão em revisão. Os demais menus indicam páginas ainda não reformadas.');
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin){event.preventDefault();showPending();return;}if(url.pathname==='/painel'){event.preventDefault();showPending();}});
render();

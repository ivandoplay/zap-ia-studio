import {mountOverviewParity,overviewParityDemo} from './overview-parity.js';
import {mountAccounts} from './accounts-view.js';
import {createAccountsDemoStore} from './accounts-store.js';
import {mountSecuritySettings} from './security-settings-view.js';
import {createSecuritySettingsDemoStore} from './security-settings-store.js';
import {mountAiSettings} from './ai-settings-view.js';
import {createAiSettingsDemoStore} from './ai-settings-store.js';
import {mountSimulator} from './simulator-view.js';
import {createSimulatorDemoStore} from './simulator-store.js';
import {mountResources} from './resources-view.js';
import {createResourceDemoStore} from './resources-store.js';
import {mountTraining} from './training-view.js';
import {createTrainingDemoStore} from './training-store.js';
import {mountCampaigns} from './campaigns-view.js';
import {createCampaignDemoStore} from './campaigns-demo.js';
import {mountHistory} from './history-view.js';
import {createHistoryDemoReader} from './history-demo.js';
import {mountChannels} from './channels-view.js';
import {createChannelDemoStore} from './channels-demo.js';
import {createConnectionControls} from './connections-controls.js';
import {mountShell} from './shell.js';
import {mountPage,renderSummary,setSyncState} from './view.js';
import {mountConnections,renderConnections,setConnectionsSync} from './connections-view.js';
import {demoData} from './demo-data.js';
const page=document.documentElement.dataset.reviewPage||'overview';
const scenarioValues=['normal','empty','stale','error','support'];
const params=new URLSearchParams(location.search);
let scenario=scenarioValues.includes(params.get('cenario'))?params.get('cenario'):'normal';
const data=demoData(scenario);
const exampleConfig={slots:[1,2,3].map(i=>({slotId:`slot_${i}`,label:`Chip ${i} · exemplo`,aiEnabled:i!==2}))};
const controls=page==='conexoes'?createConnectionControls({demo:true,readConfiguration:async()=>exampleConfig,operate:async(path,body)=>{if(path.endsWith('/slot-config')){Object.assign(exampleConfig.slots.find(s=>s.slotId===body.slotId),body);return {ok:true};}return {ok:true,status:'qr_ready',pairingCode:'DEMO2026'};}}):null;
let parityUI,accountsUI,securitySettingsUI,aiSettingsUI,simulatorUI,resourceUI,trainingUI,channelUI,historyUI,campaignUI;if(page==='overview')mountPage();else if(page==='conexoes')mountConnections();else if(page==='canais')channelUI=mountChannels({adapter:createChannelDemoStore({scenario}),demo:true});
if(page==='historico')historyUI=mountHistory({reader:createHistoryDemoReader({scenario}),demo:true});
const shell=mountShell({pageId:page,title:page==='overview'?'Visão geral':page==='conexoes'?'Conexões e motor':page==='canais'?'Instâncias':page==='historico'?'Histórico por instância':page==='campanhas'?'Campanhas':page==='treinamento'?'Treinamento da IA':page==='catalogo'?'Catálogo e PIX':page==='audios'?'Biblioteca de Áudios':page==='simulador'?'Simulador de Atendimento':page==='ia'?'Inteligência artificial':page==='contas'?'Contas e administração':page==='config'?'Segurança e configurações':'Página ainda não reformada',currentUser:data.viewer,permissions:data.permissions,appearanceApi:{account:false},syncDescription:page==='historico'?'Dados fictícios, sem atualização em tempo real. Use Atualizar para recarregar o exemplo. Não há consulta à API.':undefined,aboutText:'Revisão visual isolada com dados de demonstração. Não existe autenticação real, consulta a banco ou acesso ao WhatsApp. Os controles demonstrativos atuam somente em memória ou explicam integrações pendentes. O tema é salvo somente neste navegador da revisão.'});
function showPending(){shell.showInfo('Página ainda não reformada','Esta área ainda não foi implementada na reforma. Ela não abre o painel de produção e não executa operações. Você pode avaliar Visão geral, Conversas, Instâncias, Histórico, Campanhas, Treinamento, Catálogo, Áudios, Simulador, Inteligência artificial, Configurações e Conexões / Motor.');}
function render(){
 const current=demoData(scenario);
 const exit=()=>{scenario='normal';select.value=scenario;render();};
 if(page==='overview'){
  parityUI?.dispose();parityUI=mountOverviewParity({host:document.getElementById('overviewParityHost'),ownerId:current.tenant.id,viewerId:current.viewer.id,master:current.permissions.master,storage:localStorage,demo:true,summary:()=>current});parityUI.render(overviewParityDemo({ownerId:current.tenant.id,empty:scenario==='empty'}));if(['error','stale'].includes(scenario))parityUI.unavailable();
  renderSummary(current,{onExitSupport:exit});
  document.getElementById('sync-status').textContent='Dados de demonstração';
  document.getElementById('updated-at').textContent='Exemplo visual local · sem consulta à API';
  document.getElementById('data-caption').textContent='Exemplo visual, sem conexão ao banco';
  document.getElementById('data-tag').textContent='Demonstração';
  if(scenario==='stale'||scenario==='error')setSyncState('stale',scenario==='error'?'Simulação de falha de consulta. Nenhuma API foi chamada.':'Simulação de diagnóstico desatualizado. Estes estados não pertencem à sua conta.');
 }else if(page==='canais'){
  channelUI?.dispose();channelUI=mountChannels({host:document.getElementById('page-slot'),adapter:createChannelDemoStore({scenario}),demo:true,onExitSupport:exit});void channelUI.load();
 }else if(page==='historico'){
  historyUI?.dispose();historyUI=mountHistory({host:document.getElementById('page-slot'),reader:createHistoryDemoReader({scenario}),demo:true,onExitSupport:exit});void historyUI.load();
 }else if(page==='contas'){
  accountsUI?.dispose();accountsUI=mountAccounts({host:document.getElementById('page-slot'),adapter:createAccountsDemoStore({storage:sessionStorage,scenario}),demo:true});void accountsUI.load();
 }else if(page==='config'){
  securitySettingsUI?.dispose();securitySettingsUI=mountSecuritySettings({host:document.getElementById('page-slot'),adapter:createSecuritySettingsDemoStore({scenario}),demo:true});void securitySettingsUI.load();
 }else if(page==='ia'){
  aiSettingsUI?.dispose();aiSettingsUI=mountAiSettings({host:document.getElementById('page-slot'),adapter:createAiSettingsDemoStore({scenario}),demo:true});void aiSettingsUI.load();
 }else if(page==='simulador'){
  simulatorUI?.dispose();simulatorUI=mountSimulator({host:document.getElementById('page-slot'),adapter:createSimulatorDemoStore({scenario}),demo:true});void simulatorUI.load();
 }else if(['catalogo','audios'].includes(page)){
  resourceUI?.dispose();resourceUI=mountResources({page,host:document.getElementById('page-slot'),adapter:createResourceDemoStore({scenario}),demo:true});void resourceUI.load();
 }else if(page==='treinamento'){
  trainingUI?.dispose();trainingUI=mountTraining({host:document.getElementById('page-slot'),adapter:createTrainingDemoStore({scenario}),demo:true});void trainingUI.load();
 }else if(page==='campanhas'){
  campaignUI?.dispose();campaignUI=mountCampaigns({host:document.getElementById('page-slot'),adapter:createCampaignDemoStore({scenario}),demo:true});void campaignUI.load();
 }else if(page==='conexoes'){
  renderConnections(current,exit);controls.update(current);
  document.getElementById('connections-sync').textContent='Dados de demonstração';
  document.getElementById('connections-time').textContent='Exemplo visual local · sem consulta à API';
  if(scenario==='stale'||scenario==='error'){controls.suspend();setConnectionsSync('stale','Simulação visual de indisponibilidade. Nenhuma sessão real é consultada ou alterada.');}
 }
 document.querySelectorAll('a[href^="/painel"]').forEach(link=>{const area=link.hash.slice(1)||'painel',ready={crm:'/conversas/',campanhas:'/campanhas/',treinamento:'/treinamento/',simulador:'/simulador/',catalogo:'/catalogo/',audios:'/audios/',ia:'/inteligencia-artificial/',seguranca:'/configuracoes/',contas:'/contas/'};link.href=ready[area]||`/em-preparo/?pagina=${encodeURIComponent(area)}`;link.title=ready[area]?'Abrir área demonstrativa reformada':'Fluxo do painel atual — indisponível na demonstração';});
}
const banner=document.createElement('section');banner.className='review-banner';banner.setAttribute('aria-label','Ambiente de revisão visual');
banner.innerHTML='<div><strong>Revisão visual · dados de demonstração</strong><span>Sem login real, banco de dados ou operações de WhatsApp. O site principal não foi alterado.</span></div><label for="review-scenario">Cenário <select id="review-scenario"><option value="normal">Padrão</option><option value="empty">Vazio</option><option value="stale">Desatualizado</option><option value="error">Falha simulada</option><option value="support">Suporte visual</option></select></label>';
document.getElementById('page-slot').before(banner);
const select=document.getElementById('review-scenario');select.value=scenario;if(page==='pending')select.closest('label').hidden=true;
select.addEventListener('change',()=>{controls?.suspend();scenario=select.value;const url=new URL(location.href);url.searchParams.set('cenario',scenario);history.replaceState(null,'',url);render();});
document.querySelector('.workspace-label div>span').textContent='Ambiente visual isolado';
document.querySelector('.lab-status').lastChild.textContent=' Revisão sem integrações';
const refresh=document.getElementById(page==='conexoes'?'connections-refresh':'refresh-summary');
if(refresh){refresh.textContent='Recarregar exemplo';refresh.addEventListener('click',render);}
document.querySelectorAll('.search-dialog .dialog-footnote').forEach(el=>el.textContent='Visão geral, Conversas, Instâncias, Histórico, Campanhas, Treinamento, Catálogo, Áudios, Simulador, Inteligência artificial, Configurações e Conexões estão em revisão. Os demais menus indicam páginas ainda não reformadas.');
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin){event.preventDefault();showPending();return;}if(url.pathname==='/painel'){event.preventDefault();showPending();}});
render();

window.addEventListener('pagehide',()=>{parityUI?.dispose();accountsUI?.dispose();campaignUI?.dispose();trainingUI?.dispose();resourceUI?.dispose();simulatorUI?.dispose();aiSettingsUI?.dispose();securitySettingsUI?.dispose();});

import {createCampaignDraftAdapter} from './campaigns-writer.js';
import {isCampaignId} from './campaigns-contract.js';
import {createSessionClient,SessionError} from './session-client.js';
import {createCampaignReadAdapter} from './campaigns-reader.js';
import {mountCampaigns} from './campaigns-view.js';
import {mountShell} from './shell.js';
import {showGate} from './view.js';
let localStore,sessionStore;try{localStore=localStorage;}catch{}try{sessionStore=sessionStorage;}catch{}
const uuidMode=new URL(location.href).searchParams.get('fonte')==='uuid';
const api=createSessionClient({localStore,sessionStore});let ui,shell,reader,generation=0;
function dispose(){generation++;ui?.dispose();reader?.dispose();shell?.dispose();ui=reader=shell=null;}
function lost(){dispose();showGate({eyebrow:'CAMPANHAS',title:'Reabra as campanhas pelo painel',description:'O acesso ou a conta mudou. Os dados anteriores foram removidos.',retry:initialize});}
async function initialize(){dispose();const mine=generation;showGate({eyebrow:'CAMPANHAS',busy:true,title:'Verificando o acesso…',description:uuidMode?'Rascunhos UUID por conta homologada. Nenhuma campanha será iniciada.':'Somente leitura do legado. Nenhuma campanha será iniciada.'});try{
 const status=await api.status();if(mine!==generation)return;if(status.cloudLoginRequired||!status.currentUser?.id)throw new SessionError('Entre pelo painel existente.',401);
 if(!uuidMode&&sessionStore?.getItem('zapia_act_as'))throw new SessionError('Campanhas legadas não oferecem consulta em modo suporte. Volte à conta titular.',403);
 let target;try{target=JSON.parse(sessionStore?.getItem('zapia_act_as')||'null')?.userId;}catch{}if(uuidMode&&target&&!isCampaignId(target))throw new SessionError('Conta de suporte inválida.',403);
 const candidate=(uuidMode?createCampaignDraftAdapter:createCampaignReadAdapter)({ownerId:uuidMode&&target?target:status.currentUser.id,request:(path,options)=>api.request(path,options),scope:()=>api.scope(),onScopeLost:lost});
 reader=candidate;if(uuidMode){await candidate.initialize();if(mine!==generation){candidate.dispose();return;}}
 ui=mountCampaigns({adapter:reader,onAccessLost:lost});shell=mountShell({pageId:'campanhas',title:'Campanhas',currentUser:status.currentUser,permissions:{master:status.currentUser.role==='master'},appearanceApi:{account:false},syncDescription:uuidMode?'Preparação de rascunhos por UUID. Não inicia execução, não acompanha WhatsApp nem envia mensagens.':'Somente consulta manual. Não inicia motores, não acompanha execução automaticamente e não envia mensagens.',aboutText:uuidMode?'Rascunhos UUID persistentes, com revisão e idempotência. Alterações, geração de IA e transferência privada são homologadas separadamente. Execução real permanece bloqueada; campanhas legadas não foram convertidas.':'A nova interface consulta campanhas legadas em modo somente leitura, até 100 registros no recorte atual. Rascunhos UUID estão disponíveis em serviço separado, condicionado à homologação da conta. Execução real permanece bloqueada. O editor completo está disponível somente com dados fictícios na demonstração separada. Nada é enviado por esta página.'});const switcher=document.createElement('a');switcher.href=uuidMode?'/campanhas/':'/campanhas/?fonte=uuid';switcher.textContent=uuidMode?'Consultar legado (somente leitura)':'Abrir rascunhos UUID';document.getElementById('campIntegration')?.append(document.createTextNode(' · '),switcher);void ui.load();
 }catch(e){if(mine!==generation)return;showGate({eyebrow:'CAMPANHAS',title:e.status===401?'Entre pelo painel existente':'Campanhas indisponíveis',description:e.message||'Não presumimos uma lista vazia.',retry:initialize,exitSupport:e.status===403?()=>{api.exitSupport();lost();}:undefined});}}
window.addEventListener('storage',e=>{if(['zapia_cloud_auth','zapia_act_as','zapia_pin',null].includes(e.key)){lost();location.reload();}});
window.addEventListener('pagehide',lost);window.addEventListener('pageshow',e=>{if(e.persisted){lost();location.reload();}});initialize();

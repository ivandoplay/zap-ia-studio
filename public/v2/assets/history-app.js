import {createSessionClient,SessionError} from './session-client.js';
import {createHistoryReader} from './history-reader.js';
import {mountHistory} from './history-view.js';
import {mountShell} from './shell.js';
import {showGate} from './view.js';
let localStore,sessionStore;try{localStore=localStorage;}catch{}try{sessionStore=sessionStorage;}catch{}
const api=createSessionClient({localStore,sessionStore});let ui,shell,generation=0;
function dispose(){generation++;ui?.dispose();shell?.dispose();ui=null;shell=null;}
function gate(){showGate({eyebrow:'HISTÓRICO',title:'Reabra o histórico pelo painel',description:'O acesso ou a conta mudou. Os dados anteriores foram removidos.',retry:initialize});}
async function initialize(){dispose();const mine=generation;showGate({eyebrow:'HISTÓRICO',busy:true,title:'Verificando o acesso…',description:'Somente leitura. Nenhuma sessão WhatsApp será iniciada.'});try{
 const status=await api.status();if(mine!==generation)return;if(status.cloudLoginRequired)throw new SessionError('Entre pelo painel existente para consultar o histórico.',401);
 const reader=createHistoryReader({request:(path,options)=>api.request(path,options)}),first=await reader.instances();if(mine!==generation)return;
 ui=mountHistory({reader,initial:first,onExitSupport:()=>{dispose();api.exitSupport();gate();location.reload();},onAccessLost:()=>{dispose();gate();}});
 shell=mountShell({pageId:'historico',title:'Histórico por instância',currentUser:first.viewer,permissions:{master:first.viewer.role==='master'},appearanceApi:{account:false},syncDescription:'Esta página não acompanha mensagens automaticamente. Clique em Atualizar para consultar novamente ou altere a seleção e os filtros. Não verifica a conexão do motor.',aboutText:'Consulta somente leitura da nova base de histórico UUID. Conversas de um mesmo cliente no mesmo negócio podem reunir várias origens. Ocultar CRM não apaga mensagens. Não migra dados antigos nem inicia motores; sem cache privado e sem envios.'});void ui.load();
 }catch(error){if(mine!==generation)return;showGate({eyebrow:'HISTÓRICO',title:error.status===401?'Entre pelo painel existente':'Histórico ainda indisponível',description:error.message||'Não presumimos histórico vazio. Esta tela não lê o CRM legado como alternativa.',retry:initialize});}}
window.addEventListener('storage',event=>{if(['zapia_cloud_auth','zapia_act_as','zapia_pin',null].includes(event.key)){dispose();gate();location.reload();}});
window.addEventListener('pagehide',()=>{dispose();gate();});window.addEventListener('pageshow',event=>{if(event.persisted){dispose();gate();location.reload();}});initialize();

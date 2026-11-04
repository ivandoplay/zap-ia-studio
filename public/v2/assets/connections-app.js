import {createSessionClient,SessionError} from './session-client.js';
import {createSummaryPoller} from './poller.js';
import {mountShell} from './shell.js';
import {showGate} from './view.js';
import {assertConnections,mountConnections,renderConnections,setConnectionsSync} from './connections-view.js';
let localStore,sessionStore;try{localStore=localStorage;}catch{}try{sessionStore=sessionStorage;}catch{}
const api=createSessionClient({localStore,sessionStore});
let generation=0,poller,shell,lastSuccess=0,stale=false;
function clear(){poller?.stop();shell?.dispose();shell=null;}
function restart(){clear();showGate({eyebrow:'CONEXÕES E MOTOR',busy:true,title:'Verificando o contexto…'});location.reload();}
function exitSupport(){api.exitSupport();restart();}
function gateError(error){clear();showGate({eyebrow:'CONEXÕES E MOTOR',title:error.status===401?'Entre ou desbloqueie o painel':error.status===403?'Acesso não autorizado':'Diagnóstico indisponível',description:error.status===401?'Use o login ou PIN existente no painel atual. Depois, abra Conexões / Motor na nova navegação.':error.message||'Falha na consulta. Nenhuma sessão foi alterada.',retry:initialize,exitSupport});}
async function initialize(){
 const mine=++generation;clear();showGate({eyebrow:'CONEXÕES E MOTOR',busy:true,title:'Consultando os sinais…',description:'Verificando a sessão existente. Não criamos, desconectamos ou reconectamos sessões.'});
 try{
  const status=await api.status();if(mine!==generation)return;
  if(status.cloudLoginRequired)throw new SessionError('Entre pelo painel atual.',401,{authRequired:true});
  const data=assertConnections(await api.request('/api/connections/summary'));if(mine!==generation)return;
  mountConnections();shell=mountShell({pageId:'conexoes',title:'Conexões e motor',currentUser:data.viewer,permissions:data.permissions,appearanceApi:{account:false},aboutText:'Este diagnóstico separa sessão WhatsApp, leitura da Evolution e heartbeat dos motores. Não envia mensagens, não gera QR e não altera sessões. O pareamento e as configurações continuam nos controles atuais. Nesta etapa, a aparência é salva no navegador, sem depender da nova tabela de preferências.'});
  const identity=JSON.stringify([data.viewer.id,data.tenant.id,data.permissions.master,data.mode]);
  renderConnections(data,exitSupport);lastSuccess=Date.now();stale=false;
  poller=createSummaryPoller({getScope:api.scope,isVisible:()=>document.visibilityState==='visible',load:async({signal})=>assertConnections(await api.request('/api/connections/summary',{signal})),
   onData:value=>{if(mine!==generation)return;if(identity!==JSON.stringify([value.viewer.id,value.tenant.id,value.permissions.master,value.mode])){restart();return;}renderConnections(value,exitSupport);lastSuccess=Date.now();stale=false;},
   onBusy:busy=>{const button=document.getElementById('connections-refresh');if(button){button.disabled=busy;button.setAttribute('aria-busy',String(busy));}if(busy&&!stale)setConnectionsSync('loading');},
   onPause:()=>{if(!stale)setConnectionsSync('paused');},
   onError:error=>{if(mine!==generation)return;if([400,401,403].includes(error.status)){gateError(error);return;}stale=true;setConnectionsSync('stale',`${error.message||'Falha na consulta.'} Exibindo o último diagnóstico, sem confirmação atual de conexão ou motor.`);},onScopeChanged:restart
  });
  document.getElementById('connections-refresh').addEventListener('click',()=>poller.refresh());poller.start();
 }catch(error){if(mine!==generation)return;if(error.detail?.scopeChanged)return restart();gateError(error);}
}
window.addEventListener('storage',event=>{if(['zapia_cloud_auth','zapia_act_as','zapia_pin',null].includes(event.key)){if(poller)poller.checkScope();else restart();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&lastSuccess&&Date.now()-lastSuccess>60000){stale=true;setConnectionsSync('stale','O último diagnóstico tem mais de um minuto. Confirmando os sinais novamente.');}poller?.visibilityChanged();});
window.addEventListener('pagehide',clear);initialize();

import {mountOverviewParity} from './overview-parity.js';
import {createSessionClient,SessionError} from './session-client.js';
import {createSummaryPoller} from './poller.js';
import {mountShell} from './shell.js';
import {mountPage,showGate,renderSummary,assertPayload,setSyncState} from './view.js';
let localStore,sessionStore;try{localStore=window.localStorage;}catch{}try{sessionStore=window.sessionStorage;}catch{}
const api=createSessionClient({localStore,sessionStore});
let generation=0,poller,shell,parityUI,parityAbort,lastSuccess=0,stale=false;
const exitSupport=()=>{poller?.stop();api.exitSupport();restart();};
function clear(){parityAbort?.abort();parityUI?.dispose();parityUI=null;poller?.stop();shell?.dispose();shell=null;}
function restart(){clear();showGate({busy:true});location.reload();}
function gateError(error){
 clear();
 const auth=error.status===401,pin=error.detail?.pinRequired,denied=error.status===403;
 showGate({title:pin?'PIN necessário':auth?'Entre para continuar':denied?'Acesso não autorizado':'Resumo indisponível agora',description:pin?'Desbloqueie o painel atual com seu PIN e depois abra “Nova visão geral” no menu.':auth?'Use o login que já existe no painel. Depois de entrar, abra “Nova visão geral” no menu.':error.message||'Não foi possível consultar os dados. Nenhum valor foi substituído por zero.',retry:initialize,exitSupport});
}
async function initialize(){
 const mine=++generation;clear();showGate({busy:true});
 try{
  const status=await api.status();if(mine!==generation)return;
  if(status.cloudLoginRequired)throw new SessionError('Entre pelo painel atual.',401,{authRequired:true});
  const data=assertPayload(await api.request('/api/dashboard/summary'));if(mine!==generation)return;
  mountPage();
  shell=mountShell({pageId:'overview',title:'Visão geral',currentUser:data.viewer,permissions:data.permissions,appearanceApi:{account:data.preferenceScope==='account',load:()=>api.request('/api/dashboard/appearance'),save:theme=>api.request('/api/dashboard/appearance',{method:'PUT',body:{theme}})}});
  const identity=JSON.stringify([data.viewer.id,data.tenant.id,data.permissions.master,data.mode]);
  let latest=data,parityBusy=false,parityTime=0;const initialScope=api.scope();parityUI=mountOverviewParity({host:document.querySelector('#overviewParityHost'),ownerId:data.tenant.id,viewerId:data.viewer.id,master:data.permissions.master,storage:localStore,summary:()=>latest});
  async function loadParity(force=false){if(parityBusy||!force&&Date.now()-parityTime<30000)return;parityBusy=true;parityTime=Date.now();parityAbort=new AbortController();try{const value=await api.request('/api/dashboard/parity',{signal:parityAbort.signal});if(mine!==generation)return;if(api.scope()!==initialScope){restart();return;}parityUI?.render(value);}catch(e){if(mine!==generation)return;if([400,401,403,409].includes(e.status)){gateError(e);return;}parityUI?.unavailable();}finally{parityBusy=false;}}
  void loadParity();
  renderSummary(data,{onExitSupport:exitSupport});lastSuccess=Date.now();stale=false;
  poller=createSummaryPoller({getScope:api.scope,isVisible:()=>document.visibilityState==='visible',
   load:async({signal})=>assertPayload(await api.request('/api/dashboard/summary',{signal})),
   onData:value=>{if(mine!==generation)return;if(identity!==JSON.stringify([value.viewer.id,value.tenant.id,value.permissions.master,value.mode])){restart();return;}latest=value;renderSummary(value,{onExitSupport:exitSupport});void loadParity();lastSuccess=Date.now();stale=false;},
   onBusy:busy=>{const button=document.querySelector('#refresh-summary');if(button){button.disabled=busy;button.setAttribute('aria-busy',String(busy));}if(busy&&!stale)setSyncState('loading');},
   onPause:()=>{if(!stale)setSyncState('paused');},
   onError:error=>{if(mine!==generation)return;if([400,401,403].includes(error.status)){gateError(error);return;}stale=true;parityUI?.unavailable();setSyncState('stale',`${error.message||'Falha ao atualizar.'} Exibindo o último resumo válido. Status anteriores não são confirmação atual.`);},
   onScopeChanged:restart
  });
  document.querySelector('#refresh-summary').addEventListener('click',()=>{void loadParity(true);poller.refresh();});poller.start();
 }catch(error){if(mine!==generation)return;if(error.detail?.scopeChanged){restart();return;}gateError(error);}
}
window.addEventListener('storage',event=>{if(event.key==='zapia_cloud_auth'||event.key==='zapia_act_as'||event.key==='zapia_pin'||event.key===null){if(poller)poller.checkScope();else restart();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&lastSuccess&&Date.now()-lastSuccess>60000){stale=true;parityUI?.unavailable();setSyncState('stale','O último resumo tem mais de um minuto. Confirmando os dados novamente.');}poller?.visibilityChanged();});
window.addEventListener('pagehide',()=>clear());
initialize();

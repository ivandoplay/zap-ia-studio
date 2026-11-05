export class SessionError extends Error {constructor(message,status=0,detail={}){super(message);this.status=status;this.detail=detail;}}
export function createSessionClient({fetcher=globalThis.fetch,localStore,sessionStore}={}) {
 const read=(store,key)=>{try{return store?.getItem(key)||'';}catch{return '';}};
 const write=(store,key,value)=>{try{value===null?store?.removeItem(key):store?.setItem(key,value);}catch{}};
 const auth=()=>{try{return JSON.parse(read(localStore,'zapia_cloud_auth'))||{};}catch{return {};}};
 const actingId=()=>{try{const value=JSON.parse(read(sessionStore,'zapia_act_as'));return typeof value?.userId==='string'?value.userId:'';}catch{return '';}};
 const scope=()=>JSON.stringify([auth().accessToken||'',read(sessionStore,'zapia_act_as'),read(sessionStore,'zapia_pin')]);
 const operations=new Set(['/api/wa/connect','/api/wa/disconnect','/api/wa/slot-config','/api/evolution-cloud/connect','/api/evolution-cloud/disconnect','/api/evolution-cloud/delete']);
 const channelRoute=path=>/^\/api\/channels(?:\/[0-9a-f-]{36}(?:\/legacy-link)?)?(?:\?|$)/i.test(path);
 // Conversas: somente leitura nesta etapa (lista com filtros e mensagens de uma conversa).
 const conversationsRoute=path=>/^\/api\/conversations(?:\/[^/?]+)?(?:\?|$)/i.test(path);
 const nonReplay=(path,method)=>operations.has(path)||(channelRoute(path)&&method!=='GET');
 let refreshing;
 async function raw(path,{method='GET',body,signal,acting=true}={}) {
  if(!conversationsRoute(path)&&!channelRoute(path)&&!operations.has(path)&&!path.startsWith('/api/connections/pairing?')&&!['/api/connections/configuration','/api/auth/status','/api/auth/refresh','/api/dashboard/summary','/api/dashboard/appearance','/api/connections/summary'].includes(path))throw new Error('Rota não permitida');
  const headers={Accept:'application/json'},stored=auth(),pin=read(sessionStore,'zapia_pin'),target=actingId();
  if(stored.accessToken)headers.Authorization=`Bearer ${stored.accessToken}`;
  if(pin)headers['x-panel-pin']=pin;
  if(acting&&target)headers['x-zapia-act-as']=target;
  if(body!==undefined)headers['Content-Type']='application/json';
  const timeout=AbortSignal.timeout(20000);
  let response;
  try{response=await fetcher(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store',credentials:'same-origin',redirect:'error'});}catch(error){if(signal?.aborted)throw error;throw new SessionError(nonReplay(path,method)?'Resultado não confirmado. Não repita a operação: consulte os sinais antes de decidir.':'Sem resposta do servidor. Tente novamente.',503,{uncertain:nonReplay(path,method)});}
  let data;try{data=await response.json();}catch{throw new SessionError('Resposta inválida do servidor.',503);}
  if(!response.ok||data.ok===false)throw new SessionError(data.error||'Não foi possível concluir a consulta.',response.status,data);
  return data;
 }
 async function refresh(){
  if(refreshing)return refreshing;
  const before=scope(),token=auth().refreshToken;
  if(!token)throw new SessionError('Sua sessão expirou. Entre novamente pelo painel.',401,{authRequired:true});
  refreshing=(async()=>{try{
   const data=await raw('/api/auth/refresh',{method:'POST',body:{refreshToken:token},acting:false});
   if(before!==scope())throw new SessionError('A conta mudou durante a atualização.',409,{scopeChanged:true});
   if(!data.session?.accessToken)throw new SessionError('Resposta de sessão inválida.',503);
   write(localStore,'zapia_cloud_auth',JSON.stringify(data.session));return data;
  }catch(error){if(before===scope()){if(error.status===401)write(localStore,'zapia_cloud_auth',null);else if(error.status===503&&error.detail.retrySession?.accessToken&&error.detail.retrySession?.refreshToken)write(localStore,'zapia_cloud_auth',JSON.stringify(error.detail.retrySession));}throw error;}finally{refreshing=null;}})();return refreshing;
 }
 async function request(path,options={}) {
  if(globalThis.navigator?.onLine===false&&options.method&&options.method!=='GET')throw new SessionError('Sem rede. Pedido bloqueado; nada foi guardado para envio automático.',503,{code:'OFFLINE_NOT_QUEUED'});
  const before=scope();
  try{const data=await raw(path,options);if(before!==scope())throw new SessionError('O contexto mudou.',409,{scopeChanged:true});return data;}catch(error){
   if(before!==scope())throw new SessionError('O contexto mudou.',409,{scopeChanged:true});
   if(nonReplay(path,options.method||'GET')||error.status!==401||error.detail.pinRequired||!error.detail.authRequired)throw error;
   await refresh();
   // Refresh pode trocar apenas o token. Uma troca de conta/chip não pode reaproveitar esta resposta.
   const old=JSON.parse(before),current=JSON.parse(scope());
   if(old[1]!==current[1]||old[2]!==current[2])throw new SessionError('O contexto mudou.',409,{scopeChanged:true});
   const after=scope(),data=await raw(path,options);if(after!==scope())throw new SessionError('O contexto mudou.',409,{scopeChanged:true});return data;
  }
 }
 return {scope,request,command:(path,body)=>request(path,{method:'POST',body}),async status(){let data=await raw('/api/auth/status',{acting:false});if(data.cloudLoginRequired&&auth().refreshToken){await refresh();data=await raw('/api/auth/status',{acting:false});}return data;},exitSupport(){write(sessionStore,'zapia_act_as',null);},clearActing:()=>write(sessionStore,'zapia_act_as',null)};
}

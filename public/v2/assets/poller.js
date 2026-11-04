export function createSummaryPoller({load,onData=()=>{},onError=()=>{},onBusy=()=>{},onPause=()=>{},onScopeChanged=()=>{},getScope,isVisible=()=>true,schedule=setTimeout,cancel=clearTimeout,interval=30000}={}) {
 const initialScope=getScope();let timer,controller,busy=false,stopped=false,epoch=0,scopeChanged=false,resume=false;
 function clear(){if(timer!==undefined){cancel(timer);timer=undefined;}}
 function stop(){stopped=true;epoch++;clear();controller?.abort();onBusy(false);}
 function changed(){if(getScope()===initialScope)return false;if(!scopeChanged){scopeChanged=true;stop();onScopeChanged();}return true;}
 async function refresh(){
  clear();if(stopped||changed()||!isVisible()||busy)return;
  busy=true;onBusy(true);controller=new AbortController();const mine=++epoch;
  try{
   const data=await load({signal:controller.signal});
   if(stopped||changed()||mine!==epoch||!isVisible())return;
   onData(data);
  }catch(error){if(!stopped&&!changed()&&mine===epoch&&!controller.signal.aborted&&isVisible())onError(error);}
  finally{busy=false;onBusy(false);if(!stopped&&isVisible()&&!changed())timer=schedule(refresh,resume?0:interval);resume=false;}
 }
 function visibilityChanged(){
  if(stopped||changed())return;
  if(!isVisible()){epoch++;clear();controller?.abort();onPause();}
  else if(!busy)refresh();else resume=true;
  // Se uma implementação de fetch ignorar abort, sua resposta é descartada pelo epoch.
 }
 return {refresh,visibilityChanged,stop,checkScope:changed,start(){clear();if(!stopped&&isVisible()&&!changed())timer=schedule(refresh,interval);}};
}

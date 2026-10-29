// Agendador experimental: não conhece WhatsApp nem envia sem um processador injetado.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function criarMotorCampanhas({client,userId,workerId,deviceId,processar,aoErro=()=>{},intervaloMs=5000,heartbeatMs=25000,maxConcorrencia=2}={}){
 if(!client||typeof client.rpc!=='function'||typeof client.from!=='function'||!UUID.test(userId)||!UUID.test(workerId)||typeof deviceId!=='string'||!deviceId||deviceId.length>80||typeof processar!=='function'||typeof aoErro!=='function'||!Number.isSafeInteger(maxConcorrencia)||maxConcorrencia<1||maxConcorrencia>4||!Number.isSafeInteger(intervaloMs)||intervaloMs<1000||!Number.isSafeInteger(heartbeatMs)||heartbeatMs<5000||heartbeatMs>45000)throw new Error('Motor de campanhas inválido.');
 let parado=false,ocupado=false,timer=null,heartbeatTimer=null,indice=0,offsetProntas=0,offsetRecuperacao=0,heartbeatEmCurso=null;
 const tarefas=new Map();
 const relatar=()=>{try{aoErro('Falha ao processar campanha; nenhum reenvio foi iniciado automaticamente.');}catch{}};
 async function heartbeat(){
  if(parado)return false;
  if(heartbeatEmCurso)return heartbeatEmCurso;
  heartbeatEmCurso=(async()=>{const {error}=await client.rpc('ienvia_registrar_worker_campanha',{p_worker:workerId,p_device:deviceId});if(error)throw new Error('Heartbeat indisponível.');return true;})().finally(()=>{heartbeatEmCurso=null;});
  return heartbeatEmCurso;
 }
 async function pagina(view,offset){
  const {data,error}=await client.from(view).select('owner_id,campanha_id,proxima_acao_em').eq('owner_id',userId).order('proxima_acao_em',{ascending:true}).range(offset,offset+49);
  if(error||!Array.isArray(data)||data.length>50||data.some(x=>x.owner_id!==userId||!UUID.test(x.campanha_id)))throw new Error('Lista de campanhas inválida.');return data;
 }
 async function ciclo(){
  if(parado||ocupado)return;ocupado=true;
  try{
   await heartbeat();if(parado)return;
   const recuperaveis=await pagina('ienvia_campanha_recuperaveis',offsetRecuperacao);offsetRecuperacao=recuperaveis.length===50?offsetRecuperacao+50:0;
   if(recuperaveis.length){
    const ids=recuperaveis.map(x=>x.campanha_id),r=await client.rpc('ienvia_recuperar_lote_campanha',{p_campanhas:ids});
    if(r.error||!Array.isArray(r.data)||r.data.length>ids.length||r.data.some(v=>v.owner_id!==userId||!ids.includes(v.campanha_id)))throw new Error('Não foi possível recuperar campanhas.');
   }
   if(parado)return;
   const prontas=await pagina('ienvia_campanha_prontas',offsetProntas);offsetProntas=prontas.length===50?offsetProntas+50:0;
   if(!prontas.length){indice=0;return;}
   const inicio=indice%prontas.length;let visitados=0;
   for(;visitados<prontas.length&&tarefas.size<maxConcorrencia;visitados++){
    const row=prontas[(inicio+visitados)%prontas.length];if(tarefas.has(row.campanha_id))continue;
    const task=Promise.resolve().then(()=>{if(!parado)return processar(row.campanha_id);}).catch(relatar).finally(()=>tarefas.delete(row.campanha_id));
    tarefas.set(row.campanha_id,task);
   }
   indice=(inicio+Math.max(visitados,1))%prontas.length;
  }finally{ocupado=false;}
 }
 function iniciar(){if(parado||timer)return;timer=setInterval(()=>ciclo().catch(relatar),intervaloMs);heartbeatTimer=setInterval(()=>heartbeat().catch(relatar),heartbeatMs);timer.unref?.();heartbeatTimer.unref?.();ciclo().catch(relatar);}
 function parar(){parado=true;if(timer)clearInterval(timer);if(heartbeatTimer)clearInterval(heartbeatTimer);timer=null;heartbeatTimer=null;}
 async function drenar(){await Promise.allSettled([...tarefas.values()]);}
 return {ciclo,iniciar,parar,drenar,heartbeat};
}

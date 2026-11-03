// Liga campanhas duráveis ao worker do titular, roteando cada reserva ao provedor do chip selecionado.
import {criarSeletorCampanha} from './campanhaSelecao.js';
import {criarRepositorioCampanhaSupabase} from './campanhaRepositorio.js';
import {executarPassoCampanha} from './campanhaExecutor.js';
import {criarEmissorCampanha} from './campanhaEmissor.js';
import {criarMotorCampanhas} from './campanhaMotor.js';
import {criarProxyEvolutionCampanha} from './campanhaEvolutionProxy.js';
import {SUPABASE_URL} from './cloudConfig.js';
export function conectarMotorCampanhas({client,userId,workerId,deviceId,whatsapp,storage,sessaoAtiva,carregarArquivo,converterVoz,registrar=()=>{},aoErro=()=>{},maxWaSlots=()=>3,proxyEvolution}={}){
 if(!whatsapp?.slots||!storage||typeof storage.isContactIgnored!=='function'||typeof sessaoAtiva!=='function'||typeof maxWaSlots!=='function')throw new Error('Integração de campanha inválida.');
 const evo=proxyEvolution||(client?.auth?.getSession?criarProxyEvolutionCampanha({client,userId,supabaseUrl:SUPABASE_URL}):{status:async()=>({ok:true,available:false,slots:{}}),send:async()=>{throw new Error('Evolution API indisponível.');}});
 let evoCache={},evoCacheAt=0,evoInFlight=null;
 const evolutionSlots=async()=>{
  if(Date.now()-evoCacheAt<5000)return evoCache;
  if(!evoInFlight)evoInFlight=evo.status().then(out=>{if(out?.ok!==true)throw new Error('Evolution API indisponível para esta conta.');evoCache=out.available?out.slots||{}:{};evoCacheAt=Date.now();return evoCache;}).finally(()=>{evoInFlight=null;});
  return evoInFlight;
 };
 const podeEnviarDestinatario=({telefone})=>{
  if(!sessaoAtiva())return false;
  const jid=`${telefone}@s.whatsapp.net`;
  if(whatsapp.isAnyOwnSlotPhone?.(telefone)||storage.isContactIgnored(telefone)||['slot_1','slot_2','slot_3'].some(id=>storage.isContactIgnored(id==='slot_1'?jid:`${id}::${jid}`)))throw Object.assign(new Error('Destinatário indisponível para campanha.'),{code:'contato_restrito'});
  return true;
 };
 const resolverProvedor=async id=>{
  if(!sessaoAtiva()||!['slot_1','slot_2','slot_3'].includes(id)||Number(id.slice(-1))>maxWaSlots())return null;
  const local=whatsapp.slots[id],localOn=Boolean(local?.slotId===id&&local.status==='connected'&&local.sock);
  const remote=await evolutionSlots(),remoteOn=remote?.[id]?.status==='connected';
  if(localOn&&remoteOn)throw Object.assign(new Error(`O chip ${id} está conectado por Baileys e Evolution. Desconecte um dos provedores para evitar envio pelo número errado.`),{code:'chip_provedor_ambiguo'});
  if(localOn)return 'baileys';
  if(remoteOn)return 'evolution_api';
  throw Object.assign(new Error(`O chip selecionado (${id}) está desconectado. O envio não será transferido para outro chip.`),{code:'chip_indisponivel'});
 };
 const selecionar=criarSeletorCampanha({client,userId,chipDisponivel:resolverProvedor,podeEnviarDestinatario,carregarArquivo,converterVoz});
 const repositorio=criarRepositorioCampanhaSupabase({client,selecionar,workerId});
 const enviar=criarEmissorCampanha({obterSlot:id=>whatsapp.slots[id],podeEnviar:async acao=>{
  if(!sessaoAtiva()||!podeEnviarDestinatario(acao))return false;
  return await resolverProvedor(acao.slotId)===(acao.provedor||'baileys');
 },enviarEvolution:acao=>evo.send(acao),registrar,aoErro});
 const processar=async campanhaId=>{
  const resultado=await executarPassoCampanha({repositorio,campanhaId,enviar});
  if(resultado.status==='erro_reserva'&&sessaoAtiva()){
   const {data,error}=await client.rpc('ienvia_registrar_falha_campanha',{p_campanha:campanhaId,p_codigo:resultado.codigo});
   if(error||!Array.isArray(data)||data.length>1||data.some(x=>x.owner_id!==userId||x.campanha_id!==campanhaId))throw new Error('Não foi possível registrar a pausa de segurança.');
  }
  return resultado;
 };
 const motor=criarMotorCampanhas({client,userId,workerId,deviceId,processar,aoErro});
 return {...motor,processar};
}

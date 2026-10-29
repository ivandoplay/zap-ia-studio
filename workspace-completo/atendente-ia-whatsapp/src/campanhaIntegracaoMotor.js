// Integração experimental do protocolo com o motor local já existente.
import {criarSeletorCampanha} from './campanhaSelecao.js';
import {criarRepositorioCampanhaSupabase} from './campanhaRepositorio.js';
import {executarPassoCampanha} from './campanhaExecutor.js';
import {criarEmissorCampanha} from './campanhaEmissor.js';
import {criarMotorCampanhas} from './campanhaMotor.js';
export function conectarMotorCampanhas({client,userId,workerId,deviceId,whatsapp,storage,sessaoAtiva,carregarArquivo,converterVoz,registrar=()=>{},aoErro=()=>{},maxWaSlots=()=>3}={}){
 if(!whatsapp?.slots||!storage||typeof storage.isContactIgnored!=='function'||typeof sessaoAtiva!=='function'||typeof maxWaSlots!=='function')throw new Error('Integração de campanha inválida.');
 const podeEnviarDestinatario=({telefone})=>{
  if(!sessaoAtiva())return false;
  const jid=`${telefone}@s.whatsapp.net`;
  if(whatsapp.isAnyOwnSlotPhone?.(telefone)||storage.isContactIgnored(telefone)||['slot_1','slot_2','slot_3'].some(id=>storage.isContactIgnored(id==='slot_1'?jid:`${id}::${jid}`)))throw Object.assign(new Error('Destinatário indisponível para campanha.'),{code:'contato_restrito'});
  return true;
 };
 const chipDisponivel=id=>{const s=whatsapp.slots[id];return Boolean(sessaoAtiva()&&Number(id.slice(-1))<=maxWaSlots()&&s?.slotId===id&&s.status==='connected'&&s.sock);};
 const selecionar=criarSeletorCampanha({client,userId,chipDisponivel,podeEnviarDestinatario,carregarArquivo,converterVoz});
 const repositorio=criarRepositorioCampanhaSupabase({client,selecionar,workerId});
 const enviar=criarEmissorCampanha({obterSlot:id=>whatsapp.slots[id],podeEnviar:acao=>chipDisponivel(acao.slotId)&&podeEnviarDestinatario(acao),registrar,aoErro});
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

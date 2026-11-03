// Integração experimental do protocolo com o motor local já existente.
// O chip pode viver em dois lugares: no socket Baileys deste processo ou numa
// instância da Evolution API. O emissor escolhe por etapa, sem reenviar nada.
import {criarSeletorCampanha} from './campanhaSelecao.js';
import {criarRepositorioCampanhaSupabase} from './campanhaRepositorio.js';
import {executarPassoCampanha} from './campanhaExecutor.js';
import {criarEmissorCampanha} from './campanhaEmissor.js';
import {criarMotorCampanhas} from './campanhaMotor.js';
export function conectarMotorCampanhas({client,userId,workerId,deviceId,whatsapp,storage,sessaoAtiva,carregarArquivo,converterVoz,registrar=()=>{},aoErro=()=>{},maxWaSlots=()=>3,canalEvolution=null}={}){
 if(!whatsapp?.slots||!storage||typeof storage.isContactIgnored!=='function'||typeof sessaoAtiva!=='function'||typeof maxWaSlots!=='function')throw new Error('Integração de campanha inválida.');
 if(canalEvolution!==null&&(typeof canalEvolution!=='object'||typeof canalEvolution.disponivel!=='function'||typeof canalEvolution.enviar!=='function'))throw new Error('Canal Evolution inválido.');
 const podeEnviarDestinatario=({telefone})=>{
  if(!sessaoAtiva())return false;
  const jid=`${telefone}@s.whatsapp.net`;
  if(whatsapp.isAnyOwnSlotPhone?.(telefone)||storage.isContactIgnored(telefone)||['slot_1','slot_2','slot_3'].some(id=>storage.isContactIgnored(id==='slot_1'?jid:`${id}::${jid}`)))throw Object.assign(new Error('Destinatário indisponível para campanha.'),{code:'contato_restrito'});
  return true;
 };
 const chipLocal=id=>{const s=whatsapp.slots[id];return Boolean(sessaoAtiva()&&Number(id.slice(-1))<=maxWaSlots()&&s?.slotId===id&&s.status==='connected'&&s.sock);};
 // A disponibilidade é assíncrona porque o chip da nuvem é consultado na Evolution API.
 const chipDisponivel=async id=>{
  if(!sessaoAtiva()||!['slot_1','slot_2','slot_3'].includes(id))return false;
  if(chipLocal(id))return true;
  return canalEvolution?await canalEvolution.disponivel(id):false;
 };
 const selecionar=criarSeletorCampanha({client,userId,chipDisponivel,podeEnviarDestinatario,carregarArquivo,converterVoz});
 const repositorio=criarRepositorioCampanhaSupabase({client,selecionar,workerId});
 const enviarPeloSocket=criarEmissorCampanha({obterSlot:id=>whatsapp.slots[id],podeEnviar:acao=>chipLocal(acao.slotId)&&podeEnviarDestinatario(acao),registrar,aoErro});
 const registrarNuvem=(acao,resultado)=>{
  const jid=`${acao.telefone}@s.whatsapp.net`;
  // Registro não pode converter uma aceitação em falha e induzir reenvio.
  Promise.resolve().then(()=>registrar({acao,jid,enviado:{key:{id:resultado.messageId}},slot:whatsapp.slots[acao.slotId]})).catch(()=>{try{aoErro('Falha ao registrar o envio no histórico.');}catch{}});
 };
 const enviar=async acao=>{
  if(chipLocal(acao.slotId)){
   if(!podeEnviarDestinatario(acao))throw new Error('Destinatário indisponível para campanha.');
   return enviarPeloSocket(acao);
  }
  if(!canalEvolution||!await canalEvolution.disponivel(acao.slotId))throw new Error('Chip indisponível.');
  // Só depois das checagens acima o material reservado é enviado pela nuvem.
  if(!podeEnviarDestinatario(acao))throw new Error('Destinatário indisponível para campanha.');
  const resultado=await canalEvolution.enviar({campanhaId:acao.campanhaId,destinatarioId:acao.destinatarioId,etapa:acao.etapa,tentativaId:acao.tentativaId});
  if(resultado?.status==='aceita')registrarNuvem(acao,resultado);
  return resultado;
 };
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

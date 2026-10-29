// Orquestra UMA etapa, sem criar timers nem persistir dados por conta própria.
// O repositório deve reservar atomicamente uma única ação por campanha, verificar
// pausa/agendamento/horários e garantir que etapas anteriores foram confirmadas.
// Uma reserva persistida deve permanecer bloqueada após erro ou queda do processo.
import { randomUUID } from 'node:crypto';

function textoCurto(x) { return typeof x==='string' && x.length>0 && x.length<=200; }
function reservaValida(acao,campanhaId,tentativaId) {
  if(!acao||typeof acao!=='object'||acao.campanhaId!==campanhaId||acao.tentativaId!==tentativaId||
     !textoCurto(acao.destinatarioId)||typeof acao.telefone!=='string'||!/^[1-9][0-9]{7,14}$/.test(acao.telefone)||!Number.isSafeInteger(acao.etapa)||acao.etapa<0||acao.etapa>=100||
     !['slot_1','slot_2','slot_3'].includes(acao.slotId)||!acao.material||typeof acao.material!=='object'||
     Array.isArray(acao.material)||!['texto','imagem','audio'].includes(acao.material.tipo))return false;
  try { const material=JSON.stringify(acao.material);return typeof material==='string'&&material.length<=16000; } catch { return false; }
}
export async function executarPassoCampanha({repositorio,campanhaId,enviar}={}) {
  if(!textoCurto(campanhaId)||typeof enviar!=='function'||!repositorio||
     ['reservar','confirmar','marcarIncerta'].some(k=>typeof repositorio[k]!=='function'))throw new Error('Executor de campanha mal configurado.');
  const tentativaId=randomUUID();
  let acao;
  try { acao=await repositorio.reservar({campanhaId,tentativaId}); }
  catch (erro) {
    const codigo=erro?.code==='contato_restrito'?'contato_restrito':typeof erro?.message==='string'&&erro.message.startsWith('Campo não informado:')?'campos':'preparacao';
    return {status:'erro_reserva',codigo};
  }
  if(!acao)return {status:'indisponivel'};
  const identificador={campanhaId,tentativaId};
  const marcarIncerta=async()=>{
    let registrada=false;
    try { registrada=await repositorio.marcarIncerta(identificador)===true; } catch { /* Continua bloqueado como em_envio. */ }
    return {status:'incerta',registrada};
  };
  if(!reservaValida(acao,campanhaId,tentativaId))return marcarIncerta();
  let resposta;
  try { resposta=await enviar(acao); } catch { return marcarIncerta(); }
  // Somente um adaptador de envio confiável pode declarar aceitação; timeout,
  // erro e respostas desconhecidas não provam que não ocorreu um envio.
  if(resposta?.status!=='aceita')return marcarIncerta();
  try {
    if(await repositorio.confirmar(identificador)!==true)return {status:'incerta',registrada:false};
  } catch { return {status:'incerta',registrada:false}; }
  return {status:'confirmada'};
}

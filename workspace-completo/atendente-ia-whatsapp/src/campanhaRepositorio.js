// Adaptador para os RPCs experimentais de campanha. Ainda não está ligado ao worker.
// Os ensaios SQL incluem pausa, janela, lote e revisão, mas a seleção de material,
// a autorização do chip e a integração com mídia continuam pendentes.
import {isDeepStrictEqual} from 'node:util';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function candidatoValido(c) {
  return c && UUID.test(c.destinatarioId) && typeof c.telefone==='string' && /^[1-9][0-9]{7,14}$/.test(c.telefone) && typeof c.nome==='string' && c.nome.length<=200 && Number.isSafeInteger(c.etapa) && c.etapa>=0 && c.etapa<100 &&
    Number.isSafeInteger(c.revisao) && c.revisao>=0 && ['slot_1','slot_2','slot_3'].includes(c.slotId) && c.material && typeof c.material==='object' && !Array.isArray(c.material) &&
    (c.material.tipo==='texto' || (['imagem','audio'].includes(c.material.tipo) && c.anexo && Buffer.isBuffer(c.anexo.buffer) && c.anexo.buffer.length>0 && c.anexo.buffer.length<=35*1024*1024 && typeof c.anexo.mime==='string'));
}
export function criarRepositorioCampanhaSupabase({client,selecionar,workerId}={}) {
  if(!client||typeof client.rpc!=='function'||typeof selecionar!=='function'||!UUID.test(workerId))throw new Error('Repositório de campanha inválido.');
  const emAndamento=new Map();
  async function transicionar(nome,{campanhaId,tentativaId},status) {
    const chave=emAndamento.get(tentativaId);
    if(!chave||chave.campanhaId!==campanhaId)return false;
    const args={p_campanha:campanhaId,p_destinatario:chave.destinatarioId,p_etapa:chave.etapa,p_tentativa:tentativaId};
    const {data,error}=await client.rpc(nome,args);
    if(error)throw new Error('Não foi possível registrar a etapa.');
    if(!Array.isArray(data)||data.length>1)throw new Error('Resposta de checkpoint inválida.');
    if(data.length===0)return false;
    const linha=data[0];
    if(linha.status!==status||linha.tentativa_id!==tentativaId||linha.campanha_id!==campanhaId||linha.destinatario_id!==chave.destinatarioId||linha.etapa!==chave.etapa)throw new Error('Resposta de checkpoint inconsistente.');
    emAndamento.delete(tentativaId);
    return true;
  }
  return {
    async reservar({campanhaId,tentativaId}) {
      if(!UUID.test(campanhaId)||!UUID.test(tentativaId)||emAndamento.size>=1000)throw new Error('Dados de reserva inválidos.');
      const candidato=await selecionar({campanhaId});
      if(!candidato)return null;
      if(!candidatoValido(candidato))throw new Error('Candidato inválido.');
      const material={slotId:candidato.slotId,bloco:candidato.material};
      const args={p_campanha:campanhaId,p_destinatario:candidato.destinatarioId,p_etapa:candidato.etapa,p_tentativa:tentativaId,p_material:material,p_revisao:candidato.revisao,p_worker:workerId};
      const {data,error}=await client.rpc('ienvia_reservar_worker_campanha',args);
      if(error?.code==='23505')return null;
      if(error)throw new Error('Não foi possível reservar a etapa.');
      if(!Array.isArray(data)||data.length>1)throw new Error('Resposta de reserva inválida.');
      if(!data.length)return null;
      const linha=data[0], salvo=linha.material;
      if(linha.status!=='em_envio'||linha.campanha_id!==campanhaId||linha.destinatario_id!==candidato.destinatarioId||linha.etapa!==candidato.etapa||linha.tentativa_id!==tentativaId||
         !salvo||salvo.slotId!==candidato.slotId||!salvo.bloco||typeof salvo.bloco!=='object'||Array.isArray(salvo.bloco)||!isDeepStrictEqual(salvo.bloco,candidato.material))throw new Error('Reserva inconsistente.');
      emAndamento.set(tentativaId,{campanhaId,destinatarioId:linha.destinatario_id,etapa:linha.etapa});
      return {campanhaId,tentativaId,destinatarioId:linha.destinatario_id,telefone:candidato.telefone,nome:candidato.nome,etapa:linha.etapa,slotId:salvo.slotId,material:salvo.bloco,...(candidato.anexo?{anexo:candidato.anexo}:{})};
    },
    confirmar(ids) {return transicionar('ienvia_confirmar_etapa',ids,'confirmada');},
    marcarIncerta(ids) {return transicionar('ienvia_marcar_etapa_incerta',ids,'incerta');}
  };
}

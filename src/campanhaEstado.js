// Modelo puro para prototipar o estado da campanha. Não persiste nem envia mensagens.
// O integrador DEVE gravar a transição para em_envio de forma durável e exclusiva
// antes de chamar o WhatsApp; o estado isolado não fornece atomicidade entre workers.
import { sortearInteiro } from './campanhaVariacoes.js';
const inteiro = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
function validarConfig(c) {
  if (!c || !inteiro(c.loteMin) || !inteiro(c.loteMax) || c.loteMin < 1 || c.loteMin > c.loteMax) throw new Error('Limites do lote inválidos.');
  for (const [min,max] of [['intervaloMinMs','intervaloMaxMs'],['pausaLoteMinMs','pausaLoteMaxMs']]) {
    if (!inteiro(c[min]) || !inteiro(c[max]) || c[min] > c[max]) throw new Error('Intervalo ou pausa inválidos.');
  }
}
function validarTempo(agora) { if (!Number.isSafeInteger(agora) || agora < 0) throw new Error('Horário inválido.'); }
export function criarEstado(destinatarios, config, random = Math.random) {
  validarConfig(config);
  if (!Array.isArray(destinatarios) || !destinatarios.length || destinatarios.some(x => typeof x !== 'string' || !x.trim())) throw new Error('Destinatários inválidos.');
  if (new Set(destinatarios).size !== destinatarios.length) throw new Error('Destinatários duplicados.');
  return {status:'ativa',pendentes:[...destinatarios],emEnvio:null,enviados:0,config:{...config},loteMeta:sortearInteiro(config.loteMin,config.loteMax,random),loteEnviados:0,proximaAcaoEm:null,pausaTipo:null};
}
export function iniciarProximo(s, agora) {
  validarTempo(agora);
  if (s.status === 'incerta') throw new Error('Envio incerto exige revisão manual.');
  if (s.status === 'pausada') throw new Error('Campanha pausada.');
  if (s.status !== 'ativa' || s.emEnvio || !s.pendentes.length) throw new Error('Campanha não está pronta para enviar.');
  if (s.proximaAcaoEm !== null && agora < s.proximaAcaoEm) throw new Error('Aguardando próxima ação.');
  return {...s,status:'em_envio',emEnvio:s.pendentes[0],pendentes:s.pendentes.slice(1),proximaAcaoEm:null,pausaTipo:null};
}
export function confirmarEnvio(s, agora, random = Math.random) {
  validarTempo(agora);
  if (s.status !== 'em_envio' || !s.emEnvio) throw new Error('Nenhum envio em andamento.');
  const total=s.enviados+1, lote=s.loteEnviados+1;
  if (!s.pendentes.length) return {...s,status:'concluida',emEnvio:null,enviados:total,loteEnviados:lote,proximaAcaoEm:null,pausaTipo:null};
  const loteCompleto=lote >= s.loteMeta;
  const atraso=loteCompleto ? sortearInteiro(s.config.pausaLoteMinMs,s.config.pausaLoteMaxMs,random) : sortearInteiro(s.config.intervaloMinMs,s.config.intervaloMaxMs,random);
  return {...s,status:'ativa',emEnvio:null,enviados:total,loteEnviados:loteCompleto?0:lote,loteMeta:loteCompleto?sortearInteiro(s.config.loteMin,s.config.loteMax,random):s.loteMeta,proximaAcaoEm:agora+atraso,pausaTipo:loteCompleto?'lote':'intervalo'};
}
export function recuperarInterrupcao(s) {
  if (s.status === 'em_envio' && s.emEnvio) return {...s,status:'incerta'};
  if (s.status === 'ativa') return {...s,status:'pausada'};
  return {...s};
}
export function resolverIncerteza(s, decisao, agora, random = Math.random) {
  validarTempo(agora);
  if (s.status !== 'incerta' || !s.emEnvio) throw new Error('Não há envio incerto.');
  if (decisao === 'confirmada') {
    const resultado=confirmarEnvio({...s,status:'em_envio'},agora,random);
    return resultado.status === 'concluida' ? resultado : {...resultado,status:'pausada'};
  }
  if (decisao === 'nao-enviada') return {...s,status:'pausada',pendentes:[s.emEnvio,...s.pendentes],emEnvio:null};
  throw new Error('Decisão inválida para envio incerto.');
}
export function pausar(s) {
  if (s.status !== 'ativa') throw new Error('A campanha não pode ser pausada agora.');
  return {...s,status:'pausada'};
}
export function retomar(s) {
  if (s.status === 'incerta') throw new Error('Envio incerto exige revisão manual.');
  if (s.status !== 'pausada') throw new Error('A campanha não está pausada.');
  return {...s,status:'ativa'};
}
export function pularPausa(s, agora) {
  validarTempo(agora);
  if (s.status !== 'ativa' || !s.pausaTipo || s.proximaAcaoEm === null || s.proximaAcaoEm <= agora) throw new Error('Não há pausa ativa para pular.');
  return {...s,proximaAcaoEm:agora,pausaTipo:null};
}

// Protocolo puro de progresso por destinatário/bloco. Nenhum envio é feito aqui.
// Persistência transacional e exclusão entre processos são responsabilidade da integração.
function copiarMaterial(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Material inválido.');
  let serializado;
  try { serializado = JSON.stringify(valor); } catch { throw new Error('Material inválido.'); }
  if (!serializado || serializado.length > 16000) throw new Error('Material inválido ou grande demais.');
  return JSON.parse(serializado);
}
export function criarSequencia(etapas) {
  if (!Array.isArray(etapas) || etapas.length === 0 || etapas.length > 100 || etapas.some(x=>typeof x !== 'string' || !x.trim())) throw new Error('Etapas inválidas.');
  if (new Set(etapas).size !== etapas.length) throw new Error('Etapas duplicadas.');
  return { etapas:[...etapas], indice:0, concluidas:[], status:'pronta', emEnvio:null, preparado:null, pausarDepois:false };
}
export function iniciarEtapa(s, material) {
  if (s.status === 'incerta') throw new Error('Envio incerto exige revisão manual.');
  if (s.status === 'pausada') throw new Error('Sequência pausada.');
  if (s.status !== 'pronta' || s.indice >= s.etapas.length || s.emEnvio) throw new Error('Sequência não está pronta para envio.');
  if (s.preparado && material !== undefined) throw new Error('Material já escolhido para esta etapa; não é permitido substituir.');
  const escolhido=s.preparado ? copiarMaterial(s.preparado) : copiarMaterial(material);
  return {...s,status:'em_envio',preparado:null,emEnvio:{etapa:s.etapas[s.indice],indice:s.indice,material:escolhido}};
}
export function confirmarEtapa(s) {
  if (s.status !== 'em_envio' || !s.emEnvio || s.emEnvio.indice !== s.indice || s.emEnvio.etapa !== s.etapas[s.indice]) throw new Error('Etapa em envio inválida.');
  const proximo=s.indice+1;
  return {...s,indice:proximo,concluidas:[...s.concluidas,s.emEnvio.etapa],emEnvio:null,preparado:null,status:proximo === s.etapas.length?'concluida':s.pausarDepois?'pausada':'pronta',pausarDepois:false};
}
export function interromperSequencia(s) {
  if (s.status === 'em_envio' && s.emEnvio) return {...s,status:'incerta'};
  if (s.status === 'pronta') return {...s,status:'pausada'};
  return {...s};
}
export function resolverEtapaIncerta(s, decisao) {
  if (s.status !== 'incerta' || !s.emEnvio) throw new Error('Nenhuma etapa incerta.');
  if (decisao === 'confirmada') {
    const out=confirmarEtapa({...s,status:'em_envio',pausarDepois:true});
    return out;
  }
  if (decisao === 'nao-enviada') return {...s,status:'pausada',preparado:copiarMaterial(s.emEnvio.material),emEnvio:null,pausarDepois:false};
  throw new Error('Decisão inválida para etapa incerta.');
}
export function pausarSequencia(s) {
  if (s.status === 'em_envio') return {...s,pausarDepois:true};
  if (s.status === 'pronta') return {...s,status:'pausada'};
  throw new Error('Sequência não pode ser pausada agora.');
}
export function retomarSequencia(s) {
  if (s.status === 'incerta') throw new Error('Envio incerto exige revisão manual.');
  if (s.status !== 'pausada') throw new Error('Sequência não está pausada.');
  return {...s,status:'pronta'};
}

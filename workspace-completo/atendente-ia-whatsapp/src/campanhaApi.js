// Camada de validação para RPCs experimentais. Não inicia motor nem envia WhatsApp.
import {validarPlanoCampanha} from './campanhaPlano.js';
import {normalizarTelefoneCampanha} from './campanhaImportacao.js';
import {proximaJanela} from './campanhaHorarios.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function contexto(client,user){if(!client||typeof client.rpc!=='function'||!user||!UUID.test(user.id))throw new Error('Conta ou conexão inválida.');}
function planoDaConta(plano,user){
 const out=validarPlanoCampanha(plano),max=user.role==='master'?3:([1,2,3].includes(Number(user.maxWaSlots))?Number(user.maxWaSlots):1);
 if(out.chips.some(s=>Number(s.slice(-1))>max))throw new Error('Um dos chips não está autorizado para esta conta.');return out;
}
function opcoesValidas(opcoes={}){
 if(!obj(opcoes))throw new Error('Opções inválidas.');
 const permitidas=['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max','restricao_horaria','fuso','dias','inicio','fim','inicio_em'];
 if(Object.keys(opcoes).some(k=>!permitidas.includes(k)))throw new Error('Opção desconhecida.');
 for(const k of ['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms'])if(k in opcoes&&(!Number.isSafeInteger(opcoes[k])||opcoes[k]<0||opcoes[k]>604800000))throw new Error('Intervalo inválido.');
 for(const k of ['lote_min','lote_max'])if(k in opcoes&&(!Number.isSafeInteger(opcoes[k])||opcoes[k]<1||opcoes[k]>10000))throw new Error('Tamanho do lote inválido.');
 if((opcoes.intervalo_min_ms??0)>(opcoes.intervalo_max_ms??0)||(opcoes.pausa_lote_min_ms??0)>(opcoes.pausa_lote_max_ms??0)||(opcoes.lote_min??1)>(opcoes.lote_max??1))throw new Error('Mínimo maior que máximo.');
 if('restricao_horaria'in opcoes&&typeof opcoes.restricao_horaria!=='boolean')throw new Error('Restrição inválida.');
 if('dias'in opcoes&&(!Array.isArray(opcoes.dias)||!opcoes.dias.length||opcoes.dias.length>7||opcoes.dias.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(opcoes.dias).size!==opcoes.dias.length))throw new Error('Dias inválidos.');
 for(const k of ['inicio','fim'])if(k in opcoes&&(typeof opcoes[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(opcoes[k])))throw new Error('Horário inválido.');
 if(opcoes.restricao_horaria&&(opcoes.inicio??'00:00')===(opcoes.fim??'23:59'))throw new Error('Horários de início e fim iguais.');
 if('fuso'in opcoes){if(typeof opcoes.fuso!=='string'||opcoes.fuso.length>80)throw new Error('Fuso inválido.');try{new Intl.DateTimeFormat('pt-BR',{timeZone:opcoes.fuso});}catch{throw new Error('Fuso inválido.');}}
 if('inicio_em'in opcoes&&(typeof opcoes.inicio_em!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(opcoes.inicio_em)||!Number.isFinite(Date.parse(opcoes.inicio_em))))throw new Error('Data de início inválida.');
 return {...opcoes};
}
function prepararLista(lista,blocos){
 if(!Array.isArray(lista)||!lista.length||lista.length>10000||lista.length*blocos>100000)throw new Error('Limite de destinatários excedido.');
 const vistos=new Set(),out=[];
 for(const item of lista){
  if(!obj(item)||Object.keys(item).some(k=>!['telefone','nome','campos'].includes(k)))throw new Error('Destinatário inválido.');
  const telefone=normalizarTelefoneCampanha(item.telefone);if(!telefone||vistos.has(telefone))throw new Error('Telefone inválido ou duplicado.');vistos.add(telefone);
  const nome=item.nome??'';if(typeof nome!=='string'||nome.length>200)throw new Error('Nome inválido.');
  const campos=item.campos??{};if(!obj(campos))throw new Error('Campos inválidos.');
  for(const [k,v] of Object.entries(campos))if(!/^[a-z0-9_]{1,60}$/.test(k)||['__proto__','prototype','constructor','nome','telefone'].includes(k)||typeof v!=='string'||v.length>2000)throw new Error('Campo personalizado inválido.');
  out.push({telefone,nome,campos});
 }
 if(JSON.stringify(out).length>1900000)throw new Error('Lista muito grande.');return out;
}
async function rpcUm(client,user,nome,args,campanhaId){
 const {data,error}=await client.rpc(nome,args);if(error)throw new Error('Não foi possível concluir a operação da campanha.');
 if(!Array.isArray(data)||data.length!==1||!data[0]||data[0].owner_id!==user.id||!UUID.test(data[0].campanha_id)||campanhaId&&data[0].campanha_id!==campanhaId)throw new Error('Campanha não encontrada ou ação não permitida.');
 return data[0];
}
function validarCamposDaLista(plano,lista){
 const campos=new Set();for(const b of plano.blocos)if(b.tipo==='texto')for(const texto of b.textos)for(const m of texto.matchAll(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu))campos.add(m[1].toLocaleLowerCase('pt-BR'));
 for(const d of lista)for(const campo of campos)if(campo!=='nome'&&campo!=='telefone'&&!Object.hasOwn(d.campos,campo))throw new Error(`Campo ${campo} ausente em pelo menos um destinatário. Confira a lista ou o texto.`);
}
export async function criarCampanha({client,user,plano,opcoes={},destinatarios}={}){
 contexto(client,user);const p=planoDaConta(plano,user),o=opcoesValidas(opcoes),lista=prepararLista(destinatarios,p.blocos.length);validarCamposDaLista(p,lista);
 return rpcUm(client,user,'ienvia_criar_campanha',{p_plano:p,p_opcoes:o,p_lista:lista});
}
export async function editarCampanha({client,user,campanhaId,plano,opcoes}={}){
 contexto(client,user);if(!UUID.test(campanhaId))throw new Error('Campanha inválida.');const p=planoDaConta(plano,user);
 if(opcoes!==undefined)return rpcUm(client,user,'ienvia_editar_configuracao_campanha',{p_campanha:campanhaId,p_plano:p,p_opcoes:opcoesValidas(opcoes)},campanhaId);
 return rpcUm(client,user,'ienvia_editar_plano_campanha',{p_campanha:campanhaId,p_plano:p},campanhaId);
}
export async function controlarCampanha({client,user,campanhaId,acao}={}){
 contexto(client,user);if(!UUID.test(campanhaId))throw new Error('Campanha inválida.');
 if(acao==='pular')return rpcUm(client,user,'ienvia_pular_pausa_campanha',{p_campanha:campanhaId},campanhaId);
 if(!['pausar','retomar','iniciar'].includes(acao))throw new Error('Ação inválida.');
 return rpcUm(client,user,'ienvia_alterar_status_campanha',{p_campanha:campanhaId,p_status:acao==='pausar'?'pausada':'ativa'},campanhaId);
}
// A revisão é humana e deve ser precedida de conferência no WhatsApp.
export async function resolverIncertezaCampanha({client,user,campanhaId,destinatarioId,etapa,tentativaId,decisao,conferi}={}){
 contexto(client,user);
 if(!UUID.test(campanhaId)||!UUID.test(destinatarioId)||!UUID.test(tentativaId)||!Number.isSafeInteger(etapa)||etapa<0||etapa>=100||!['confirmada','nao_enviada'].includes(decisao)||conferi!==true)throw new Error('Confira a conversa antes de decidir sobre o envio incerto.');
 const {data,error}=await client.rpc('ienvia_resolver_etapa_incerta',{p_campanha:campanhaId,p_destinatario:destinatarioId,p_etapa:etapa,p_tentativa:tentativaId,p_decisao:decisao});
 if(error||!Array.isArray(data)||data.length!==1)throw new Error('Não foi possível resolver a tentativa. Atualize os dados e confira a conversa.');
 const x=data[0];if(x.owner_id!==user.id||x.campanha_id!==campanhaId||x.destinatario_id!==destinatarioId||x.etapa!==etapa||x.status!==(decisao==='confirmada'?'confirmada':'pendente')||(decisao==='confirmada'&&x.tentativa_id!==tentativaId)||(decisao==='nao_enviada'&&x.tentativa_id!==null))throw new Error('Resultado de revisão inconsistente. Atualize os dados.');
 return x;
}
export async function detalharCampanha({client,user,campanhaId}={}){
 contexto(client,user);if(!UUID.test(campanhaId))throw new Error('Campanha inválida.');
 const consulta=(t,campos)=>client.from(t).select(campos).eq('owner_id',user.id).eq('campanha_id',campanhaId);
 const [c,s,p]=await Promise.all([
  consulta('ienvia_campanhas_controle','owner_id,campanha_id,nome,status,proxima_acao_em,pausa_tipo,revisao,plano,falha_codigo,intervalo_min_ms,intervalo_max_ms,pausa_lote_min_ms,pausa_lote_max_ms,intervalo_etapas_ms,lote_min,lote_max,restricao_horaria,fuso,dias,inicio,fim').maybeSingle(),
  consulta('ienvia_campanha_resumo','owner_id,campanha_id,total,concluidos,incertos,excluidos').maybeSingle(),
  consulta('ienvia_campanha_checkpoints','owner_id,campanha_id,destinatario_id,etapa,tentativa_id,status,material,atualizado_em').in('status',['em_envio','incerta']).maybeSingle()
 ]);
 if(c.error||s.error||p.error||!c.data)throw new Error('Não foi possível carregar a campanha.');
 const valida=x=>!x||(x.owner_id===user.id&&x.campanha_id===campanhaId);
 if(!valida(c.data)||!valida(s.data)||!valida(p.data))throw new Error('Dados de campanha inconsistentes.');
 let revisao=null;
 if(p.data){
  const x=p.data;if(!UUID.test(x.destinatario_id)||!UUID.test(x.tentativa_id)||!Number.isSafeInteger(x.etapa)||x.etapa<0||x.etapa>=100||!['incerta','em_envio'].includes(x.status))throw new Error('Tentativa inconsistente.');
  const d=await consulta('ienvia_campanha_destinatarios','owner_id,campanha_id,destinatario_id,nome,telefone').eq('destinatario_id',x.destinatario_id).maybeSingle();
  if(d.error||!d.data||!valida(d.data)||d.data.destinatario_id!==x.destinatario_id||!/^\d{8,15}$/.test(d.data.telefone))throw new Error('Destinatário inconsistente.');
  revisao={...x,destinatario:d.data};
 }
 let pendente=null;
 if(c.data.status==='pausada'&&['contato_restrito','campos','preparacao'].includes(c.data.falha_codigo)&&!revisao){
  const x=await consulta('ienvia_campanha_proxima_falha','owner_id,campanha_id,destinatario_id,nome,telefone,etapa').maybeSingle();
  if(x.error||!valida(x.data)||(x.data&&(!UUID.test(x.data.destinatario_id)||!/^\d{8,15}$/.test(x.data.telefone))))throw new Error('Dados da próxima etapa inconsistentes.');
  pendente=x.data;
 }
 return {campanha:c.data,resumo:s.data||{total:0,concluidos:0,incertos:0},revisao,pendente,proxima_acao_estimada_em:revisao?null:estimarProximaAcao(c.data)};
}
export function estimarProximaAcao(c,agora=Date.now()){
 if(c?.status!=='ativa')return null;
 const tempo=Date.parse(c.proxima_acao_em);if(!Number.isFinite(tempo)||!Number.isSafeInteger(agora))return null;
 let instante=Math.max(agora,tempo);
 if(c.restricao_horaria){try{instante=proximaJanela({fuso:c.fuso,dias:c.dias,inicio:String(c.inicio).slice(0,5),fim:String(c.fim).slice(0,5)},instante);}catch{return null;}}
 return new Date(instante).toISOString();
}
export async function listarDestinatariosCampanha({client,user,campanhaId,inicio=0}={}){
 contexto(client,user);if(!UUID.test(campanhaId)||!Number.isSafeInteger(inicio)||inicio<0||inicio>9950)throw new Error('Página inválida.');
 const {data,error}=await client.from('ienvia_campanha_lista_destinatarios').select('owner_id,campanha_id,destinatario_id,nome,telefone,ordem,pode_excluir,excluido').eq('owner_id',user.id).eq('campanha_id',campanhaId).order('ordem',{ascending:true}).range(inicio,inicio+49);
 if(error||!Array.isArray(data)||data.length>50||data.some(x=>x.owner_id!==user.id||x.campanha_id!==campanhaId||!UUID.test(x.destinatario_id)||!/^\d{8,15}$/.test(x.telefone)||typeof x.pode_excluir!=='boolean'))throw new Error('Não foi possível carregar os destinatários.');return data;
}
export async function removerDestinatarioCampanha({client,user,campanhaId,destinatarioId,confirmo}={}){
 contexto(client,user);if(!UUID.test(campanhaId)||!UUID.test(destinatarioId)||confirmo!==true)throw new Error('Confirme a remoção do destinatário.');
 const {data,error}=await client.rpc('ienvia_remover_destinatario_campanha',{p_campanha:campanhaId,p_destinatario:destinatarioId});
 if(error||!Array.isArray(data)||data.length!==1||data[0].owner_id!==user.id||data[0].campanha_id!==campanhaId||data[0].destinatario_id!==destinatarioId)throw new Error('Não é possível remover o restante: pode existir uma etapa em envio ou incerta. Atualize a lista.');return data[0];
}

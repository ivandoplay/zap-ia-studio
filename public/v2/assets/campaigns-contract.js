// Contrato novo UUID. Não converte slots, não grava dados e não despacha mensagens.
import {normalizarTelefoneCampanha} from './campaigns-import.js';
import {expandirMensagem} from './campaigns-variations.js';
export const isCampaignId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=message=>{throw new Error(message);};
const keys=(x,allowed)=>{if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('Campo não permitido.');};
const text=(x,max)=>typeof x==='string'&&!!x.trim()&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
export const campaignDefaults=()=>({intervalo_min_ms:20000,intervalo_max_ms:40000,lote_min:8,lote_max:12,pausa_lote_min_ms:300000,pausa_lote_max_ms:600000,intervalo_etapas_ms:0,restricao_horaria:false,fuso:'America/Fortaleza',dias:[0,1,2,3,4,5,6],inicio:'09:00',fim:'18:00'});
export function validateCampaignPlan(plan){
 keys(plan,['nome','instanceIds','distribution','retomada','blocos']);
 if(!text(plan.nome,120)||!Array.isArray(plan.instanceIds)||!plan.instanceIds.length||plan.instanceIds.some(x=>!isCampaignId(x))||new Set(plan.instanceIds.map(x=>x.toLowerCase())).size!==plan.instanceIds.length||!['fixo','rodizio'].includes(plan.distribution)||(plan.distribution==='fixo'&&plan.instanceIds.length!==1)||!['manual','automatica'].includes(plan.retomada))fail('Escolha o nome, a distribuição e as instâncias da campanha.');
 if(!Array.isArray(plan.blocos)||!plan.blocos.length||plan.blocos.length>100||new Set(plan.blocos.map(b=>b?.id?.toLowerCase?.())).size!==plan.blocos.length)fail('Use de 1 a 100 blocos distintos.');
 for(const b of plan.blocos){
  if(!isCampaignId(b?.id)||!['texto','imagem','audio'].includes(b.tipo))fail('Bloco inválido.');
  if(b.tipo==='texto'){
   keys(b,['id','tipo','modo','textos','selecao']);if(!['fixo','spintax','rotacao','ia'].includes(b.modo)||!Array.isArray(b.textos)||!b.textos.length||b.textos.length>20||b.textos.some(t=>!text(t,5000))||(['fixo','spintax'].includes(b.modo)&&b.textos.length!==1))fail('Confira os textos: de 1 a 20 versões, com até 5.000 caracteres cada.');
   if(['rotacao','ia'].includes(b.modo)&&!['sequencial','aleatorio'].includes(b.selecao))fail('Escolha a ordem dos textos.');
   if(b.modo==='spintax'){const fields=Object.create(null);for(const m of b.textos[0].matchAll(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu))fields[m[1]]='exemplo';expandirMensagem(b.textos[0],fields,()=>0);}
  }else{keys(b,['id','tipo','pastaId','selecao',...(b.tipo==='audio'?['notaVoz']:[])]);if(!isCampaignId(b.pastaId)||!['sequencial','aleatorio'].includes(b.selecao)||(b.tipo==='audio'&&typeof b.notaVoz!=='boolean'))fail('Confira a pasta, a seleção e o formato da mídia.');}
 }
 if(JSON.stringify(plan).length>250000)fail('Plano grande demais.');return structuredClone({...plan,nome:plan.nome.trim(),instanceIds:plan.instanceIds.map(x=>x.toLowerCase())});
}
export function validateCampaignOptions(input={}){
 const defaults=campaignDefaults();keys(input,[...Object.keys(defaults),'inicio_em']);const o={...defaults,...input};
 for(const k of ['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max'])if(!Number.isSafeInteger(o[k])||o[k]<(k.startsWith('lote_')?1:0)||o[k]>(k.startsWith('lote_')?10000:604800000))fail('Intervalo ou tamanho de lote inválido.');
 if(o.intervalo_min_ms>o.intervalo_max_ms||o.pausa_lote_min_ms>o.pausa_lote_max_ms||o.lote_min>o.lote_max)fail('O mínimo não pode ser maior que o máximo.');
 if(typeof o.restricao_horaria!=='boolean'||!Array.isArray(o.dias)||!o.dias.length||o.dias.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(o.dias).size!==o.dias.length)fail('Confira os dias da semana.');
 if(typeof o.fuso!=='string'||o.fuso.length>80)fail('Fuso inválido.');try{new Intl.DateTimeFormat('pt-BR',{timeZone:o.fuso});}catch{fail('Fuso inválido.');}
 for(const k of ['inicio','fim'])if(typeof o[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(o[k]))fail('Horário inválido.');
 if(o.restricao_horaria&&o.inicio===o.fim)fail('Horários de início e fim iguais.');
 if('inicio_em'in o&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(o.inicio_em)||!Number.isFinite(Date.parse(o.inicio_em))))fail('Data de início inválida.');return structuredClone(o);
}
export function validateCampaignDraft(input){
 keys(input,['plano','opcoes','destinatarios','expectedRevision']);const plano=validateCampaignPlan(input.plano),opcoes=validateCampaignOptions(input.opcoes),list=input.destinatarios;
 if(!Array.isArray(list)||!list.length||list.length>10000||list.length*plano.blocos.length>100000)fail('Confira uma lista de até 10.000 destinatários.');
 const seen=new Set(),destinatarios=[];
 for(const d of list){keys(d,['telefone','nome','campos']);const telefone=normalizarTelefoneCampanha(d.telefone),nome=d.nome??'',campos=d.campos??{};if(!telefone||seen.has(telefone)||typeof nome!=='string'||nome.length>200||!object(campos))fail('Destinatário inválido ou duplicado.');seen.add(telefone);
  for(const [k,v]of Object.entries(campos))if(!/^[a-z0-9_]{1,60}$/.test(k)||['__proto__','constructor','prototype','nome','telefone'].includes(k)||typeof v!=='string'||v.length>2000)fail('Campo personalizado inválido.');
  for(const b of plano.blocos)if(b.tipo==='texto')for(const t of b.textos)for(const m of t.matchAll(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu)){const k=m[1].toLocaleLowerCase('pt-BR');if(!['nome','telefone'].includes(k)&&!Object.hasOwn(campos,k))fail('Campo '+k+' ausente em um destinatário.');}
  destinatarios.push({telefone,nome,campos:structuredClone(campos)});
 }
 if(JSON.stringify(destinatarios).length>1900000)fail('Lista grande demais.');return {plano,opcoes,destinatarios};
}

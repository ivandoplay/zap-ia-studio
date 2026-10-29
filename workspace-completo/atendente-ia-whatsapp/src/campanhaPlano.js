// Validação e preparação puras; não persistem, buscam arquivos nem enviam mensagens.
import {escolherItem,expandirMensagem} from './campanhaVariacoes.js';
import {isDeepStrictEqual} from 'node:util';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOTS=['slot_1','slot_2','slot_3'];
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function validarBloco(b){
 if(!isObject(b)||!UUID.test(b.id)||!['texto','imagem','audio'].includes(b.tipo))throw new Error('Bloco inválido.');
 if(b.tipo==='texto'){
  if(!['fixo','spintax','rotacao','ia'].includes(b.modo)||!Array.isArray(b.textos)||!b.textos.length||b.textos.length>20||b.textos.some(x=>typeof x!=='string'||!x.trim()||x.length>5000))throw new Error('Textos do bloco inválidos.');
  if(['fixo','spintax'].includes(b.modo)&&b.textos.length!==1)throw new Error('Informe um texto para este modo.');
  if(['rotacao','ia'].includes(b.modo)&&!['sequencial','aleatorio'].includes(b.selecao))throw new Error('Seleção de textos inválida.');
  if(b.modo==='spintax'){
   const campos=Object.create(null);for(const match of b.textos[0].matchAll(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu))campos[match[1]]='x';
   expandirMensagem(b.textos[0],campos,()=>0);
  }
 }else{
  if(!UUID.test(b.pastaId)||!['sequencial','aleatorio'].includes(b.selecao))throw new Error('Pasta ou seleção inválida.');
  if(b.tipo==='audio'&&typeof b.notaVoz!=='boolean')throw new Error('Escolha o tipo de áudio.');
 }
 return b;
}
export function validarPlanoCampanha(plano){
 if(!isObject(plano)||typeof plano.nome!=='string'||!plano.nome.trim()||plano.nome.length>120||!Array.isArray(plano.chips)||plano.chips.length<1||plano.chips.length>3||plano.chips.some(x=>!SLOTS.includes(x))||new Set(plano.chips).size!==plano.chips.length||!['fixo','rodizio'].includes(plano.modoChips)||(plano.modoChips==='fixo'&&plano.chips.length!==1)||!['manual','automatica'].includes(plano.retomada)||!Array.isArray(plano.blocos)||plano.blocos.length<1||plano.blocos.length>100)throw new Error('Plano de campanha inválido.');
 if(new Set(plano.blocos.map(b=>b?.id?.toLowerCase?.())).size!==plano.blocos.length)throw new Error('Blocos duplicados.');
 plano.blocos.forEach(validarBloco);
 let serial;try{serial=JSON.stringify(plano);}catch{throw new Error('Plano inválido.');}if(serial.length>250000)throw new Error('Plano grande demais.');
 return JSON.parse(serial);
}
function substituirCampos(texto,campos){
 const valores=new Map(Object.entries(campos).map(([k,v])=>[k.toLocaleLowerCase('pt-BR'),v]));
 return texto.replace(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu,(_,nome)=>{const chave=nome.toLocaleLowerCase('pt-BR');if(!valores.has(chave)||valores.get(chave)==null)throw new Error(`Campo não informado: ${nome}.`);return String(valores.get(chave));});
}
export function prepararMaterialCampanha({plano,bloco,destinatario,arquivos=[],random=Math.random}={}){
 validarPlanoCampanha(plano);validarBloco(bloco);
 if(!plano.blocos.some(b=>b.id.toLowerCase()===bloco.id.toLowerCase()&&isDeepStrictEqual(b,bloco)))throw new Error('Bloco não corresponde ao plano.');
 if(!isObject(destinatario)||!Number.isSafeInteger(destinatario.ordem)||destinatario.ordem<1||destinatario.ordem>10000||typeof destinatario.nome!=='string'||typeof destinatario.telefone!=='string'||!/^\d{8,15}$/.test(destinatario.telefone)||!isObject(destinatario.campos||{}))throw new Error('Destinatário inválido.');
 const indice=destinatario.ordem-1;
 const slotId=plano.modoChips==='fixo'?plano.chips[0]:escolherItem(plano.chips,'sequencial',indice,random).item;
 let material;
 if(bloco.tipo==='texto'){
  const texto=['rotacao','ia'].includes(bloco.modo)?escolherItem(bloco.textos,bloco.selecao,indice,random).item:bloco.textos[0];
  const campos={...(destinatario.campos||{}),nome:destinatario.nome,telefone:destinatario.telefone};
  const resultado=bloco.modo==='spintax'?expandirMensagem(texto,campos,random):substituirCampos(texto,campos);
  if(!resultado.trim()||resultado.length>10000)throw new Error('Mensagem personalizada inválida ou grande demais.');
  material={tipo:'texto',texto:resultado};
 }else{
  if(!Array.isArray(arquivos))throw new Error('Arquivos inválidos.');
  const validos=arquivos.filter(x=>isObject(x)&&x.pastaId===bloco.pastaId&&x.tipo===bloco.tipo&&UUID.test(x.id));
  const escolhido=escolherItem(validos,bloco.selecao,indice,random).item;
  material={tipo:bloco.tipo,arquivoId:escolhido.id,pastaId:bloco.pastaId,...(bloco.tipo==='audio'?{notaVoz:bloco.notaVoz}:{})};
 }
 return {slotId,material};
}

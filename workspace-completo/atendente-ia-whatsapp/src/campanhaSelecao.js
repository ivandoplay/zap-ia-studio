// Prepara apenas a candidata sugerida. A RPC ainda revalida revisão, horário e ordem.
import {createHash} from 'node:crypto';
import {prepararMaterialCampanha,validarPlanoCampanha} from './campanhaPlano.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slots=['slot_1','slot_2','slot_3'];
export function criarSeletorCampanha({client,userId,chipDisponivel,podeEnviarDestinatario=()=>true,carregarArquivo,converterVoz,random=Math.random}={}){
 if(!client||typeof client.from!=='function'||!UUID.test(userId)||typeof chipDisponivel!=='function'||typeof podeEnviarDestinatario!=='function')throw new Error('Seletor inválido.');
 return async ({campanhaId}={})=>{
  if(!UUID.test(campanhaId))throw new Error('Campanha inválida.');
  const [proximo,controle]=await Promise.all([
   client.from('ienvia_campanha_proxima_etapa').select('owner_id,campanha_id,revisao,destinatario_id,telefone,nome,campos,ordem,etapa,bloco_config,material_preparado').eq('owner_id',userId).eq('campanha_id',campanhaId).maybeSingle(),
   client.from('ienvia_campanhas_controle').select('owner_id,campanha_id,revisao,plano').eq('owner_id',userId).eq('campanha_id',campanhaId).maybeSingle()
  ]);
  if(proximo.error||controle.error)throw new Error('Não foi possível consultar a campanha.');
  const row=proximo.data,c=controle.data;if(!row||!c)return null;
  if(row.owner_id!==userId||c.owner_id!==userId||row.campanha_id!==campanhaId||c.campanha_id!==campanhaId||!UUID.test(row.destinatario_id)||!Number.isSafeInteger(row.etapa)||row.etapa<0||row.etapa>=100||!Number.isSafeInteger(row.revisao)||row.revisao<0||!/^\d{8,15}$/.test(row.telefone))throw new Error('Candidato inválido.');
  if(row.revisao!==c.revisao)return null;
  if(!await podeEnviarDestinatario({telefone:row.telefone,nome:row.nome||''}))return null;
  validarPlanoCampanha(c.plano);
  let escolhido,arquivos=[];
  if(row.material_preparado){
   const m=row.material_preparado;if(!m||typeof m!=='object'||!slots.includes(m.slotId)||!m.bloco||typeof m.bloco!=='object'||!['texto','imagem','audio'].includes(m.bloco.tipo))throw new Error('Material preparado inválido.');
   escolhido={slotId:m.slotId,material:m.bloco};
  } else {
   const b=row.bloco_config;
   if(b?.tipo==='imagem'||b?.tipo==='audio'){
    for(let ini=0;ini<10000;ini+=500){
     const q=await client.from('ienvia_campanha_arquivos').select('owner_id,arquivo_id,pasta_id,tipo,mime,tamanho,sha256,ordem').eq('owner_id',userId).eq('pasta_id',b.pastaId).eq('excluindo',false).order('ordem',{ascending:true}).range(ini,ini+499);
     if(q.error||!Array.isArray(q.data))throw new Error('Não foi possível consultar os arquivos.');
     if(q.data.some(f=>f.owner_id!==userId||f.pasta_id!==b.pastaId||f.tipo!==b.tipo||!UUID.test(f.arquivo_id)))throw new Error('Arquivo de outra conta ou pasta.');
     arquivos.push(...q.data);if(q.data.length<500)break;
    }
   }
   escolhido=prepararMaterialCampanha({plano:c.plano,bloco:b,destinatario:{telefone:row.telefone,nome:row.nome||'',campos:row.campos||{},ordem:row.ordem},arquivos:arquivos.map(f=>({id:f.arquivo_id,pastaId:f.pasta_id,tipo:f.tipo})),random});
  }
  if(!await chipDisponivel(escolhido.slotId))return null;
  let anexo;
  if(escolhido.material.tipo==='imagem'||escolhido.material.tipo==='audio'){
   if(typeof carregarArquivo!=='function')throw new Error('Mídia indisponível.');
   let arquivo=arquivos.find(f=>f.arquivo_id===escolhido.material.arquivoId&&f.pasta_id===escolhido.material.pastaId);
   if(!arquivo){const q=await client.from('ienvia_campanha_arquivos').select('owner_id,arquivo_id,pasta_id,tipo,mime,tamanho,sha256,ordem').eq('owner_id',userId).eq('arquivo_id',escolhido.material.arquivoId).eq('excluindo',false).maybeSingle();if(q.error)throw new Error('Não foi possível consultar o arquivo.');arquivo=q.data;}
   if(!arquivo||arquivo.owner_id!==userId||arquivo.arquivo_id!==escolhido.material.arquivoId||arquivo.pasta_id!==escolhido.material.pastaId||arquivo.tipo!==escolhido.material.tipo||!Number.isSafeInteger(arquivo.tamanho)||arquivo.tamanho<1||arquivo.tamanho>35*1024*1024||!/^\w{64}$/.test(arquivo.sha256||''))throw new Error('Arquivo inválido.');
   anexo=await carregarArquivo(arquivo);
   if(!anexo||!Buffer.isBuffer(anexo.buffer)||anexo.buffer.length!==arquivo.tamanho||anexo.mime!==arquivo.mime||createHash('sha256').update(anexo.buffer).digest('hex')!==arquivo.sha256)throw new Error('Integridade da mídia não conferida.');
   if(escolhido.material.tipo==='audio'&&escolhido.material.notaVoz===true){
    if(typeof converterVoz!=='function')throw new Error('Conversor de voz indisponível.');
    const voz=await converterVoz(anexo.buffer,`audio.${({ 'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/webm':'webm' })[anexo.mime]||'bin'}`);
    if(!voz||!Buffer.isBuffer(voz.buffer)||!voz.buffer.length||voz.buffer.length>35*1024*1024||!Number.isFinite(voz.durationSec)||voz.durationSec<=0)throw new Error('Nota de voz inválida.');
    anexo={...anexo,voz};
   }
  }
  return {destinatarioId:row.destinatario_id,telefone:row.telefone,nome:row.nome||'',etapa:row.etapa,revisao:row.revisao,slotId:escolhido.slotId,material:escolhido.material,...(anexo?{anexo}:{})};
 };
}

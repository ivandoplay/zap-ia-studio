// Consulta do legado com allowlist fechada. Não adapta UUID para slots e não expõe escrita.
import {isCampaignId} from './campaigns-contract.js';
import {isCampaignReadPath} from './campaigns-read-policy.js';
export function createCampaignReadAdapter({request,ownerId,scope=()=>'',onScopeLost=()=>{}}={}){
 if(typeof request!=='function'||!isCampaignId(ownerId))throw Error('Conta autenticada não identificada.');let disposed=false;const initialScope=scope();
 const invalid=()=>{throw Object.assign(new Error('Resposta de campanhas inválida. Não presumimos uma lista vazia.'),{status:503});};
 const same=()=>{if(disposed||scope()!==initialScope){onScopeLost();throw Object.assign(new Error('A conta mudou. Reabra as campanhas.'),{status:409,detail:{scopeChanged:true}});}};
 const own=x=>x&&typeof x==='object'&&x.owner_id===ownerId;
 const campaign=c=>own(c)&&isCampaignId(c.campanha_id)&&typeof c.nome==='string'&&!!c.nome.trim()&&c.nome.length<=120&&['rascunho','ativa','pausada','concluida'].includes(c.status)&&Number.isSafeInteger(c.revisao)&&c.revisao>=0;
 const folder=f=>own(f)&&isCampaignId(f.pasta_id)&&typeof f.nome==='string'&&f.nome.length<=120&&['imagem','audio'].includes(f.tipo);
 return {capabilities:Object.freeze({demo:false,writable:false,canSend:false}),instances:[],async request(path,options={}){
  same();if((options.method||'GET')!=='GET'||options.body!==undefined||!isCampaignReadPath(path))throw Error('Campanhas permite somente consultas nesta integração.');
  const data=await request(path,{method:'GET',signal:options.signal});same();if(!data||typeof data!=='object')invalid();const parts=new URL(path,'https://local.invalid').pathname.split('/').filter(Boolean).slice(2),id=parts[0];
  if(!parts.length){if(!Array.isArray(data.campanhas)||data.campanhas.length>100||data.campanhas.some(c=>!campaign(c)))invalid();}
  else if(id==='folders'&&parts.length===1){if(!Array.isArray(data.pastas)||data.pastas.length>2000||data.pastas.some(f=>!folder(f)))invalid();}
  else if(id==='folders'){
   if(!isCampaignId(parts[1])||!Array.isArray(data.arquivos)||data.arquivos.length>100||data.arquivos.some(f=>!own(f)||f.pasta_id!==parts[1]||!isCampaignId(f.arquivo_id)||typeof f.nome_original!=='string'||!Number.isSafeInteger(f.tamanho)||f.tamanho<0))invalid();
  }else if(parts[1]==='recipients'){
   if(!isCampaignId(id)||!Array.isArray(data.destinatarios)||data.destinatarios.length>50||data.destinatarios.some(d=>!own(d)||d.campanha_id!==id||!isCampaignId(d.destinatario_id)||typeof d.nome!=='string'||!/^\d{8,15}$/.test(d.telefone)||typeof d.pode_excluir!=='boolean'))invalid();
  }else{
   if(!campaign(data.campanha)||data.campanha.campanha_id!==id||!own(data.resumo)||data.resumo.campanha_id!==id||['total','concluidos','incertos'].some(k=>!Number.isSafeInteger(data.resumo[k])||data.resumo[k]<0)||(data.resumo.owner_id!==undefined&&data.resumo.owner_id!==ownerId)||(data.resumo.campanha_id!==undefined&&data.resumo.campanha_id!==id))invalid();
   const r=data.revisao;if(r&&(!own(r)||r.campanha_id!==id||!isCampaignId(r.tentativa_id)||!isCampaignId(r.destinatario_id)||!Number.isSafeInteger(r.etapa)||r.etapa<0||r.etapa>=100||!['incerta','em_envio'].includes(r.status)||!own(r.destinatario)||r.destinatario.campanha_id!==id||r.destinatario.destinatario_id!==r.destinatario_id||typeof r.destinatario.nome!=='string'||r.destinatario.nome.length>200||!/^\d{8,15}$/.test(r.destinatario.telefone)))invalid();
   const p=data.pendente;if(p&&(!own(p)||p.campanha_id!==id||!isCampaignId(p.destinatario_id)||typeof p.nome!=='string'||!/^\d{8,15}$/.test(p.telefone)||!Number.isSafeInteger(p.etapa)||p.etapa<0||p.etapa>=100))invalid();
  }
  return structuredClone(data);
 },dispose(){disposed=true;}};
}

import {readCampaignXlsx} from './campaigns-xlsx.js';
// Adaptador em memória. Nenhum endpoint HTTP, armazenamento persistente, IA ou envio real.
import {validateCampaignDraft,validateCampaignOptions,isCampaignId,campaignDefaults} from './campaigns-contract.js';
import {importarDestinatarios} from './campaigns-import.js';
const clone=x=>structuredClone(x),uid=()=>crypto.randomUUID();
export function createCampaignDemoStore({scenario='normal',isOnline=()=>globalThis.navigator?.onLine!==false}={}){
 const owner='10000000-0000-4000-8000-000000000001',instances=Array.from({length:6},(_,i)=>({id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,ownerId:owner,name:['Vendas · principal','Relacionamento','Novidades','Equipe comercial','Reservas · offline','Atendimento · sem campanhas'][i],online:i!==4,campaignsEnabled:i!==5,transport:i%2?'evolution_api':'local_worker'}));
 const folders=[{owner_id:owner,pasta_id:'40000000-0000-4000-8000-000000000001',nome:'Novidades da loja',tipo:'imagem'},{owner_id:owner,pasta_id:'40000000-0000-4000-8000-000000000002',nome:'Boas-vindas',tipo:'audio'}],files=new Map(folders.map(f=>[f.pasta_id,[{arquivo_id:uid(),nome_original:f.tipo==='imagem'?'Coleção de novembro.jpg':'Apresentação.ogg',mime:f.tipo==='imagem'?'image/jpeg':'audio/ogg',tamanho:48000,excluindo:false}]])),campaigns=new Map();let disposed=false;
 const capabilities=Object.freeze({demo:true,canSend:false,writable:scenario!=='support'&&scenario!=='stale'});
 function make(input,status='rascunho',name){const d=validateCampaignDraft(input),id=uid(),recipients=d.destinatarios.map((r,i)=>({...r,owner_id:owner,campanha_id:id,destinatario_id:uid(),ordem:i+1,pode_excluir:true,excluido:false}));const c={owner_id:owner,campanha_id:id,nome:name||d.plano.nome,status,revisao:1,plano:d.plano,...d.opcoes,proxima_acao_em:d.opcoes.inicio_em||new Date(Date.now()+180000).toISOString(),pausa_tipo:d.opcoes.inicio_em?'inicio':'pessoa'};campaigns.set(id,{c,recipients,review:null,concluidos:0});return campaigns.get(id);}
 if(scenario!=='empty'&&scenario!=='error'){
  const people=Array.from({length:12},(_,i)=>({telefone:'558699990'+String(i).padStart(4,'0'),nome:['Ana · exemplo','Bruno · exemplo','Clara · exemplo'][i%3],campos:{}}));
  const base={plano:{nome:'Novidades de novembro',instanceIds:[instances[0].id],distribution:'fixo',retomada:'manual',blocos:[{id:uid(),tipo:'texto',modo:'fixo',textos:['Olá, {{nome}}! Confira as novidades deste mês.']},{id:uid(),tipo:'imagem',pastaId:folders[0].pasta_id,selecao:'sequencial'}]},opcoes:{},destinatarios:people};
  const active=make(base,'ativa');active.concluidos=5;for(const r of active.recipients.slice(0,5))r.pode_excluir=false;
  const paused=make({...base,plano:{...base.plano,nome:'Relacionamento · conferir envio'}},'pausada');paused.recipients[0].pode_excluir=false;paused.review={destinatario_id:paused.recipients[0].destinatario_id,tentativa_id:uid(),etapa:0,status:'incerta',material:{instanceId:instances[0].id,bloco:{tipo:'texto',texto:'Olá! Como foi sua experiência?'}},destinatario:clone(paused.recipients[0])};
  make({...base,plano:{...base.plano,nome:'Próxima coleção · rascunho'}},'rascunho');const done=make({...base,plano:{...base.plano,nome:'Pós-venda de outubro'}},'concluida');done.concluidos=12;done.recipients.forEach(r=>r.pode_excluir=false);
 }
 const ensure=write=>{if(disposed)throw Error('A página foi encerrada.');if(scenario==='error')throw Error('Falha simulada de consulta. Nenhuma API foi chamada.');if(write&&(!capabilities.writable||!isOnline()))throw Error(!isOnline()?'Sem rede. Operação bloqueada, sem fila automática.':'Somente leitura neste cenário.');};
 const selected=ids=>{for(const id of ids)if(!instances.some(i=>i.id===id&&i.ownerId===owner))throw Error('Instância não pertence à conta.');};
 const folderCheck=plan=>{for(const b of plan.blocos)if(b.tipo!=='texto'&&!folders.some(f=>f.pasta_id===b.pastaId&&f.tipo===b.tipo))throw Error('Pasta não corresponde ao tipo de mídia.');};
 async function request(path,{method='GET',body}={}){
  const write=method!=='GET';ensure(write);if(!['GET','POST','PUT'].includes(method)||!path.startsWith('/api/campaigns'))throw Error('Operação indisponível.');
  const url=new URL(path,'https://demo.invalid'),parts=url.pathname.split('/').filter(Boolean).slice(2),offset=Number(url.searchParams.get('inicio')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>9950)throw Error('Página inválida.');
  if(!parts.length){if(method==='GET')return clone({campanhas:[...campaigns.values()].map(x=>x.c)});if(method!=='POST')throw Error('Operação inválida.');const d=validateCampaignDraft(body);selected(d.plano.instanceIds);folderCheck(d.plano);return clone({campanha:make(d).c});}
  if(parts[0]==='import-preview'&&parts.length===1&&method==='POST'){
   if(body?.get){const f=body.get('file');if(!f||f.size>4*1024*1024)throw Error('Arquivo de lista: até 4 MB.');const ext=f.name.split('.').pop().toLowerCase();if(ext==='xlsx'){const result=await readCampaignXlsx(f);ensure(true);return result;}if(!['csv','txt'].includes(ext))throw Error('Escolha CSV, XLSX ou TXT.');const texto=await f.text();ensure(true);return importarDestinatarios({texto,formato:ext,separador:body.get('separador')||','});}
   return importarDestinatarios(body);
  }
  if(parts[0]==='ai-variations')throw Error('IA real não é chamada nesta revisão. Use texto fixo, spintax ou rodízio; a geração existe apenas no serviço autenticado homologado.');
  if(parts[0]==='folders'){
   if(parts.length===1){if(method==='GET')return clone({pastas:folders});if(method!=='POST'||!['imagem','audio'].includes(body?.tipo)||typeof body?.nome!=='string'||!body.nome.trim()||body.nome.length>120)throw Error('Confira o nome e o tipo da pasta.');const f={owner_id:owner,pasta_id:uid(),nome:body.nome.trim(),tipo:body.tipo};folders.push(f);files.set(f.pasta_id,[]);return clone({pasta:f});}
   const folder=folders.find(f=>f.pasta_id===parts[1]);if(!folder)throw Error('Pasta não encontrada.');if(parts[2]==='files'&&method==='GET')return clone({arquivos:files.get(folder.pasta_id).slice(offset,offset+100)});throw Error('Transferência real indisponível nesta revisão.');
  }
  if(parts[0]==='files'&&parts[2]==='delete'&&method==='POST'){
   if(body?.confirmo!==true)throw Error('Confirme a exclusão.');for(const [id,items]of files){const index=items.findIndex(f=>f.arquivo_id===parts[1]);if(index>=0){items.splice(index,1);return {ok:true};}}throw Error('Arquivo não encontrado.');
  }
  const item=campaigns.get(parts[0]);if(!item||!isCampaignId(parts[0]))throw Error('Campanha não encontrada.');const {c,recipients}=item;
  if(write&&body?.expectedRevision!==c.revisao)throw Error('A campanha mudou. Atualize os dados antes de alterar.');
  if(parts.length===1){
   if(method==='GET')return clone({campanha:c,resumo:{total:recipients.length,concluidos:item.concluidos,incertos:item.review?.status==='incerta'?1:0,excluidos:recipients.filter(r=>r.excluido).length},revisao:item.review,proxima_acao_estimada_em:c.status==='ativa'?c.proxima_acao_em:null});
   if(method!=='PUT'||c.status==='concluida')throw Error('Esta campanha não pode ser editada.');
   const input={...body,destinatarios:recipients.map(({nome,telefone,campos})=>({nome,telefone,campos}))},d=validateCampaignDraft(input);selected(d.plano.instanceIds);folderCheck(d.plano);if(item.review)throw Error('Confira a tentativa antes de editar.');if(c.status!=='rascunho'&&d.opcoes.inicio_em)throw Error('Início não pode mudar após ativação.');Object.assign(c,{plano:d.plano,nome:d.plano.nome,...d.opcoes,revisao:c.revisao+1});return clone({campanha:c});
  }
  if(parts[1]==='recipients'){
   if(parts.length===2&&method==='GET')return clone({destinatarios:recipients.slice(offset,offset+50)});
   const r=recipients.find(x=>x.destinatario_id===parts[2]);if(method!=='POST'||parts[3]!=='remove'||body?.confirmo!==true||!r?.pode_excluir||r.excluido||item.review?.destinatario_id===r.destinatario_id)throw Error('Não é possível remover esta etapa.');r.excluido=true;r.pode_excluir=false;c.revisao++;return {ok:true};
  }
  if(parts[1]==='control'&&method==='POST'){
   const action=body?.acao;if(action==='pausar'){if(c.status!=='ativa')throw Error('Campanha não está ativa.');c.status='pausada';}
   else if(['iniciar','retomar'].includes(action)){
    if(c.status!==(action==='iniciar'?'rascunho':'pausada')||item.review)throw Error('Confira o estado e a tentativa antes de iniciar ou retomar.');
    selected(c.plano.instanceIds);for(const id of c.plano.instanceIds){const i=instances.find(x=>x.id===id);if(!i.online||!i.campaignsEnabled)throw Error('Instância offline ou sem permissão de campanhas. Não houve troca automática.');}
    folderCheck(c.plano);for(const b of c.plano.blocos)if(b.tipo!=='texto'&&!files.get(b.pastaId)?.length)throw Error('A pasta de mídia está vazia.');c.status='ativa';
   }else if(action==='pular'){if(!['ativa','pausada'].includes(c.status)||!['pessoa','lote'].includes(c.pausa_tipo)||Date.parse(c.proxima_acao_em)<=Date.now()||item.review)throw Error('Não há pausa elegível.');c.proxima_acao_em=new Date().toISOString();}else throw Error('Ação inválida.');c.revisao++;return clone({campanha:c});
  }
  if(parts[1]==='resolve'&&method==='POST'){
   const r=item.review;if(!r||r.status!=='incerta'||body?.conferi!==true||body.tentativaId!==r.tentativa_id||body.destinatarioId!==r.destinatario_id||body.etapa!==r.etapa||!['confirmada','nao_enviada'].includes(body.decisao))throw Error('A tentativa mudou. Confira os dados antes de decidir.');
   const person=recipients.find(p=>p.destinatario_id===r.destinatario_id);const completed=body.decisao==='confirmada'&&r.etapa===c.plano.blocos.length-1;if(completed)item.concluidos++;person.pode_excluir=!completed;item.review=null;c.revisao++;return {ok:true};
  }
  throw Error('Operação indisponível.');
 }
 async function simulateFiles(folderId,list){ensure(true);const f=folders.find(x=>x.pasta_id===folderId);if(!f||!Array.isArray(list)||!list.length)throw Error('Escolha uma pasta e arquivos.');
  // Somente metadata; não lê bytes, não cria URL, não transmite nem guarda arquivo privado.
  for(const x of list)if(typeof x.name!=='string'||!x.name||x.name.length>255||!Number.isSafeInteger(x.size)||x.size<1||x.size>16*1024*1024||!(f.tipo==='imagem'?['image/jpeg','image/png','image/webp']:['audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm']).includes(x.type))throw Error('Tipo de mídia incompatível ou arquivo maior que 16 MB.');
  for(const x of list)files.get(folderId).push({arquivo_id:uid(),nome_original:x.name,mime:x.type,tamanho:x.size,excluindo:false});return {ok:true};
 }
 return {capabilities,instances:clone(instances),request,simulateFiles,dispose(){disposed=true;campaigns.clear();folders.length=0;files.clear();instances.length=0;}};
}

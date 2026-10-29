// Operações de mídia só por caminhos derivados do usuário autenticado. Não executa upload público.
import {createHash,randomUUID} from 'node:crypto';
const BUCKET='ienvia-campanhas-privadas';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX=35*1024*1024;
function tipoBytes(b){
 if(b.length>=8&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return ['imagem','image/png'];
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return ['imagem','image/jpeg'];
 if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return ['imagem','image/webp'];
 if(b.length>=4&&b.toString('ascii',0,4)==='OggS')return ['audio','audio/ogg'];
 if(b.length>=3&&(b.toString('ascii',0,3)==='ID3'||(b[0]===0xff&&(b[1]&0xe0)===0xe0)))return ['audio','audio/mpeg'];
 if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE')return ['audio','audio/wav'];
 if(b.length>=12&&b.toString('ascii',4,8)==='ftyp')return ['audio','audio/mp4'];
 if(b.length>=4&&b.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')))return ['audio','audio/webm'];
 throw new Error('Formato de mídia não reconhecido.');
}
export async function limparUploadsExpirados({client,admin,userId}={}) {
 if(!UUID.test(userId)||!client||!admin?.storage||typeof admin.from!=='function')throw new Error('Limpeza de upload inválida.');
 const {data,error}=await client.from('ienvia_campanha_uploads_expirados').select('owner_id,pasta_id,arquivo_id').eq('owner_id',userId).limit(20);
 if(error||!Array.isArray(data)||data.length>20||data.some(x=>x.owner_id!==userId||!UUID.test(x.pasta_id)||!UUID.test(x.arquivo_id)))throw new Error('Não foi possível consultar uploads expirados.');
 if(!data.length)return 0;
 const paths=data.map(x=>`${userId}/${x.pasta_id}/${x.arquivo_id}`);
 const removidos=await admin.storage.from(BUCKET).remove(paths);if(removidos.error)throw new Error('Não foi possível limpar os arquivos expirados.');
 const registros=await admin.from('ienvia_campanha_uploads').delete().eq('owner_id',userId).eq('status','pendente').in('arquivo_id',data.map(x=>x.arquivo_id));
 if(registros.error)throw new Error('Não foi possível concluir a limpeza de uploads.');
 return data.length;
}
export function criarServicoMediaCampanha({client,admin,supabaseUrl,gerarId=randomUUID}={}){
 if(!client||!admin?.storage||typeof gerarId!=='function')throw new Error('Serviço de mídia indisponível.');
 const origin=new URL(supabaseUrl);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Origem de armazenamento inválida.');
 async function verificarBucket(){
  if(typeof admin.storage.getBucket!=='function')throw new Error('Armazenamento indisponível.');
  const {data,error}=await admin.storage.getBucket(BUCKET);
  if(error||!data||data.id!==BUCKET||data.public!==false||!Number.isSafeInteger(data.file_size_limit)||data.file_size_limit<1||data.file_size_limit>MAX)throw new Error('Armazenamento privado indisponível ou sem limite seguro.');
 }
 async function pasta(userId,pastaId){
  if(!UUID.test(userId)||!UUID.test(pastaId))throw new Error('Dados de pasta inválidos.');
  const {data,error}=await client.from('ienvia_campanha_pastas').select('pasta_id,tipo').eq('owner_id',userId).eq('pasta_id',pastaId).maybeSingle();
  if(error||!data||data.pasta_id!==pastaId||!['audio','imagem'].includes(data.tipo))throw new Error('Pasta não encontrada.');return data;
 }
 function caminho(userId,pastaId,arquivoId){if(!UUID.test(arquivoId))throw new Error('Arquivo inválido.');return `${userId}/${pastaId}/${arquivoId}`;}
 return {
  async excluir({userId,arquivoId}={}){
   if(!UUID.test(userId)||!UUID.test(arquivoId))throw new Error('Arquivo inválido.');
   const {data,error}=await client.rpc('ienvia_iniciar_exclusao_arquivo_campanha',{p_arquivo:arquivoId});
   if(error)throw new Error('Não foi possível excluir: o arquivo pode estar reservado em uma etapa pendente ou incerta.');
   const f=Array.isArray(data)&&data.length===1?data[0]:null;
   if(!f||f.owner_id!==userId||f.arquivo_id!==arquivoId||!UUID.test(f.pasta_id)||f.caminho!==caminho(userId,f.pasta_id,arquivoId)||f.excluindo!==true)throw new Error('Arquivo não encontrado.');
   const removido=await admin.storage.from(BUCKET).remove([f.caminho]);if(removido.error)throw new Error('Não foi possível remover o arquivo do armazenamento. Tente novamente.');
   const final=await admin.rpc('ienvia_finalizar_exclusao_arquivo_campanha_servico',{p_owner:userId,p_arquivo:arquivoId});
   if(final.error||!Array.isArray(final.data)||final.data.length!==1||final.data[0]?.owner_id!==userId||final.data[0]?.arquivo_id!==arquivoId)throw new Error('Não foi possível concluir a exclusão. Tente novamente.');
   return true;
  },
  async iniciar({userId,pastaId,tamanho}={}){
   if(!Number.isSafeInteger(tamanho)||tamanho<1||tamanho>MAX)throw new Error('Tamanho de arquivo inválido.');
   await pasta(userId,pastaId);await verificarBucket();const arquivoId=gerarId(),path=caminho(userId,pastaId,arquivoId);
   const reserva=await client.rpc('ienvia_reservar_upload_campanha',{p_pasta:pastaId,p_arquivo:arquivoId,p_tamanho:tamanho});
   if(reserva.error||!Array.isArray(reserva.data)||reserva.data.length!==1||reserva.data[0].owner_id!==userId||reserva.data[0].pasta_id!==pastaId||reserva.data[0].arquivo_id!==arquivoId||reserva.data[0].tamanho!==tamanho)throw new Error('Não foi possível reservar o upload.');
   const {data,error}=await admin.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});
   if(error||!data||data.path!==path||typeof data.token!=='string'||!data.token)throw new Error('Não foi possível iniciar o envio do arquivo.');
   let url;try{url=new URL(data.signedUrl);}catch{throw new Error('URL de upload inválida.');}
   if(url.origin!==origin.origin||url.username||url.password||url.hash||url.pathname!==`/storage/v1/object/upload/sign/${BUCKET}/${path}`||url.searchParams.get('token')!==data.token)throw new Error('URL de upload inválida.');
   return {arquivoId,signedUrl:url.href};
  },
  async ticket({userId,arquivoId}={}){
   if(!UUID.test(userId)||!UUID.test(arquivoId))throw new Error('Arquivo inválido.');
   const {data:f,error}=await client.from('ienvia_campanha_arquivos').select('owner_id,pasta_id,arquivo_id,caminho,mime,tamanho,sha256').eq('owner_id',userId).eq('arquivo_id',arquivoId).eq('excluindo',false).maybeSingle();
   if(error||!f||f.owner_id!==userId||f.arquivo_id!==arquivoId||!UUID.test(f.pasta_id)||f.caminho!==caminho(userId,f.pasta_id,arquivoId)||!Number.isSafeInteger(f.tamanho)||f.tamanho<1||f.tamanho>MAX||!/^([a-f0-9]{64})$/.test(f.sha256||'')||typeof f.mime!=='string')throw new Error('Arquivo não encontrado.');
   await verificarBucket();const out=await admin.storage.from(BUCKET).createSignedUrl(f.caminho,60);
   if(out.error||!out.data?.signedUrl)throw new Error('Não foi possível acessar o arquivo.');
   let url;try{url=new URL(out.data.signedUrl);}catch{throw new Error('URL de arquivo inválida.');}
   if(url.origin!==origin.origin||url.username||url.password||url.hash||url.pathname!==`/storage/v1/object/sign/${BUCKET}/${f.caminho}`||!url.searchParams.get('token'))throw new Error('URL de arquivo inválida.');
   return {signedUrl:url.href,mime:f.mime,tamanho:f.tamanho,sha256:f.sha256};
  },
  async finalizar({userId,pastaId,arquivoId,nome=''}={}){
   if(typeof nome!=='string'||nome.length>500||/[\u0000-\u001f\u007f]/.test(nome))throw new Error('Nome do arquivo inválido.');
   const nomeSeguro=nome.split(/[\\/]/).pop().trim().slice(0,200);
   const f=await pasta(userId,pastaId),path=caminho(userId,pastaId,arquivoId);await verificarBucket();
   const {data,error}=await admin.storage.from(BUCKET).download(path);
   if(error||!data||!Number.isSafeInteger(data.size)||data.size<1||data.size>MAX)throw new Error('Arquivo não encontrado ou fora do limite.');
   const bytes=Buffer.from(await data.arrayBuffer());if(bytes.length!==data.size)throw new Error('Arquivo incompleto.');
   const [tipo,mime]=tipoBytes(bytes);if(tipo!==f.tipo)throw new Error('O formato não corresponde à pasta.');
   const sha=createHash('sha256').update(bytes).digest('hex');
   const {data:linhas,error:erro}=await admin.rpc('ienvia_registrar_arquivo_campanha_servico',{p_owner:userId,p_pasta:pastaId,p_arquivo:arquivoId,p_mime:mime,p_tamanho:bytes.length,p_sha256:sha,p_nome:nomeSeguro});
   if(erro||!Array.isArray(linhas)||linhas.length!==1||linhas[0]?.owner_id!==userId||linhas[0]?.arquivo_id!==arquivoId)throw new Error('Não foi possível registrar o arquivo.');
   return linhas[0];
  }
 };
}

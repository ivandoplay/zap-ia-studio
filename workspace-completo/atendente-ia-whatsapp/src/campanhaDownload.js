// O worker obtém uma URL curta por sua própria sessão e valida origem, tamanho e hash.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, MAX=35*1024*1024,BUCKET='ienvia-campanhas-privadas';
function origem(x){const u=new URL(x);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Origem de mídia inválida.');return u.origin;}
export function criarLeitorMediaCampanha({client,userId,panelUrl,supabaseUrl,fetcher=globalThis.fetch}={}){
 if(!client?.auth||!UUID.test(userId)||typeof fetcher!=='function')throw new Error('Leitor inválido.');
 const painel=origem(panelUrl),db=origem(supabaseUrl);
 return async arquivo=>{
  if(!arquivo||arquivo.owner_id!==userId||!UUID.test(arquivo.pasta_id)||!UUID.test(arquivo.arquivo_id)||!Number.isSafeInteger(arquivo.tamanho)||arquivo.tamanho<1||arquivo.tamanho>MAX||!/^([a-f0-9]{64})$/.test(arquivo.sha256||'')||typeof arquivo.mime!=='string')throw new Error('Metadados de mídia inválidos.');
  const sessao=await client.auth.getSession();const token=sessao?.data?.session?.access_token;if(sessao?.error||typeof token!=='string'||!token)throw new Error('Sessão do motor indisponível.');
  const resposta=await fetcher(`${painel}/api/campaigns/files/${arquivo.arquivo_id}/ticket`,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!resposta.ok)throw new Error('Não foi possível obter acesso temporário à mídia.');
  const data=await resposta.json(),ticket=data?.ticket;
  if(data?.ok!==true||!ticket||ticket.mime!==arquivo.mime||ticket.tamanho!==arquivo.tamanho||ticket.sha256!==arquivo.sha256)throw new Error('Ticket de mídia inconsistente.');
  let u;try{u=new URL(ticket.signedUrl);}catch{throw new Error('URL de mídia inválida.');}
  const expected=`/storage/v1/object/sign/${BUCKET}/${userId}/${arquivo.pasta_id}/${arquivo.arquivo_id}`;
  if(u.origin!==db||u.username||u.password||u.hash||u.pathname!==expected||!u.searchParams.get('token'))throw new Error('Origem de mídia não autorizada.');
  const download=await fetcher(u.href,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60000)});
  if(!download.ok||!download.body)throw new Error('Não foi possível baixar a mídia.');
  const informado=download.headers.get('content-length');if(informado&&(!/^\d+$/.test(informado)||Number(informado)>arquivo.tamanho))throw new Error('Mídia excede o tamanho esperado.');
  const reader=download.body.getReader(),pedacos=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>arquivo.tamanho||total>MAX){await reader.cancel();throw new Error('Mídia excede o tamanho esperado.');}pedacos.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const buffer=Buffer.concat(pedacos,total);if(total!==arquivo.tamanho||createHash('sha256').update(buffer).digest('hex')!==arquivo.sha256)throw new Error('Integridade da mídia não conferida.');
  return {buffer,mime:arquivo.mime};
 };
}

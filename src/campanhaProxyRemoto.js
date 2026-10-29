// O motor portátil não possui nem recebe a chave de serviço do Supabase.
// Apenas rotas de mídia predefinidas são encaminhadas à Vercel, com a sessão do próprio titular.
const ORIGEM='https://zap-ia-studio.vercel.app';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export function criarProxyMediaCampanha({client,userId,fetcher=globalThis.fetch}={}){
 return async ({tipo,pastaId,arquivoId,body}={})=>{
  let caminho,metodo='POST';
  if(tipo==='iniciar'&&uuid(pastaId))caminho=`/api/campaigns/folders/${pastaId}/upload-init`;
  else if(tipo==='finalizar'&&uuid(pastaId))caminho=`/api/campaigns/folders/${pastaId}/upload-finalize`;
  else if(tipo==='ticket'&&uuid(arquivoId)){caminho=`/api/campaigns/files/${arquivoId}/ticket`;metodo='GET';}
  else if(tipo==='excluir'&&uuid(arquivoId))caminho=`/api/campaigns/files/${arquivoId}/delete`;
  else throw new Error('Operação ou identificador de mídia inválido.');
  const {data,error}=await client.auth.getSession();const sessao=data?.session;
  if(error||!sessao?.access_token||sessao.user?.id!==userId)throw new Error('A sessão do titular não está disponível para mídia.');
  let response;try{response=await fetcher(ORIGEM+caminho,{method:metodo,headers:{Authorization:`Bearer ${sessao.access_token}`,...(metodo==='POST'?{'Content-Type':'application/json'}:{})},...(metodo==='POST'?{body:JSON.stringify(body||{})}:{}),redirect:'error',signal:AbortSignal.timeout(55000)});}catch{throw new Error('Não foi possível conectar ao serviço de mídia. Tente novamente.');}
  let resultado;try{resultado=await response.json()}catch{throw new Error('Resposta inválida do serviço de mídia.');}
  if(!response.ok||resultado?.ok!==true)throw new Error(typeof resultado?.error==='string'?resultado.error:'Operação de mídia indisponível.');
  return resultado;
 };
}

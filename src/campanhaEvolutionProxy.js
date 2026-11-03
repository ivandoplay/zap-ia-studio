// Proxy autenticado do worker portátil para a Evolution API configurada na Vercel.
// O token Supabase fica apenas em memória; mídia trafega por ticket assinado de curta duração.
const PANEL_URL='https://zap-ia-studio.vercel.app';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function criarProxyEvolutionCampanha({client,userId,fetcher=globalThis.fetch,panelUrl=PANEL_URL,supabaseUrl}={}){
 if(!client?.auth||!UUID.test(userId)||typeof fetcher!=='function')throw new Error('Proxy Evolution inválido.');
 const panel=new URL(panelUrl).origin, db=supabaseUrl?new URL(supabaseUrl).origin:'';
 async function token(){const {data,error}=await client.auth.getSession();const s=data?.session;if(error||!s?.access_token||s.user?.id!==userId)throw new Error('Sessão do motor indisponível para Evolution API.');return s.access_token;}
 async function request(path,{method='GET',body}={}){
  const access=await token();let r;try{r=await fetcher(panel+path,{method,headers:{Authorization:`Bearer ${access}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});}catch{throw new Error('Não foi possível conectar à Evolution API.');}
  let out;try{out=await r.json();}catch{throw new Error('Resposta inválida da Evolution API.');}
  if(!r.ok||out?.ok!==true)throw new Error(typeof out?.error==='string'?out.error:'Operação Evolution indisponível.');return out;
 }
 async function status(){return request('/api/evolution-cloud/status');}
 async function send(acao){
  const body={campaignId:acao.campanhaId,recipientId:acao.destinatarioId,etapa:acao.etapa,tentativaId:acao.tentativaId,slotId:acao.slotId};
  if(acao.material?.tipo==='imagem'||acao.material?.tipo==='audio'){
   const fileId=acao.material.arquivoId,pastaId=acao.material.pastaId;
   if(!UUID.test(fileId)||!UUID.test(pastaId))throw new Error('Mídia da campanha inválida.');
   const ticket=await request(`/api/campaigns/files/${fileId}/ticket`);
   const t=ticket.ticket;let u;try{u=new URL(t?.signedUrl);}catch{throw new Error('Ticket de mídia inválido.');}
   const expected=`/storage/v1/object/sign/ienvia-campanhas-privadas/${userId}/${pastaId}/${fileId}`;
   if(!db||ticket.ok!==true||!t||u.origin!==db||u.username||u.password||u.hash||u.pathname!==expected||!u.searchParams.get('token')||!Number.isSafeInteger(t.tamanho)||t.tamanho<1||t.tamanho>35*1024*1024)throw new Error('Ticket de mídia não corresponde à campanha.');
   body.mediaUrl=u.href;
  }
  const out=await request('/api/evolution-cloud/campaign-send',{method:'POST',body});
  if(out.accepted!==true||typeof out.messageId!=='string'||!out.messageId)return {status:'incerta'};
  return {status:'aceita',key:{id:out.messageId},provider:'evolution_api'};
 }
 return {status,send};
}

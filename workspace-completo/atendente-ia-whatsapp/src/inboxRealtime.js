// Realtime é apenas um sinal: o painel ainda lê os dados pela API autenticada.
// Nunca confiar no conteúdo do evento para alterar o CRM ou confirmar envios.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function createInboxRealtime({createClient,onChange}) {
  if(typeof createClient!=='function'||typeof onChange!=='function') throw new Error('Realtime inválido.');
  let current=null,chain=Promise.resolve();
  async function close(){
    const old=current;current=null;
    if(!old)return;
    try { await old.client.removeChannel(old.channel); } catch {}
    try { old.client.realtime.disconnect(); } catch {}
  }
  function serialize(fn){const result=chain.catch(()=>{}).then(fn);chain=result.catch(()=>{});return result;}
  async function update(config){
    const {url='',key='',userId='',token=''}=config||{};
    let validUrl=false;
    try{const u=new URL(url);validUrl=u.protocol==='https:'&&!u.username&&!u.password;}catch{}
    if(!validUrl||!key||!UUID.test(userId)||!token){await close();return;}
    if(current&&current.url===url&&current.key===key&&current.userId===userId){
      if(current.token!==token){await current.client.realtime.setAuth(token);current.token=token;}
      return;
    }
    await close();
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    await client.realtime.setAuth(token);
    const entry={client,url,key,userId,token,channel:null};current=entry;
    const signal=()=>{if(current===entry){try{onChange()}catch{}}};
    entry.channel=client.channel(`ienvia-inbox-${userId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'zapia_contacts',filter:`user_id=eq.${userId}`},signal)
      .subscribe(status=>{if(status==='SUBSCRIBED')signal()});
  }
  return {start:config=>serialize(()=>update(config)),stop:()=>serialize(close)};
}

// Fixture exclusivamente sintética/em memória. Nenhum fetch, auth, socket ou envio.
import {createHistoryReader} from './history-reader.js';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,A=uid(9001),M=uid(9002),T='2026-11-03T12:00:00Z';
export function createHistoryDemoReader({scenario='normal'}={}){
 const instances=Array.from({length:24},(_,i)=>({id:uid(i+1),name:i===0?'Atendimento · Evolution':i===1?'Campanhas · PC':i===2?'Arquivo da loja':`Equipe de exemplo ${i+1}`,transport:i%2?'local_worker':'evolution_api',crmVisible:i!==1&&i!==2}));
 const threads=Array.from({length:23},(_,i)=>({id:uid(100+i),selfJid:'558600000001@s.whatsapp.net',peerJid:i===1?'123456789012345@lid':`${558600000002+i}@s.whatsapp.net`,identityKind:i===1?'provisional_lid':'verified_pn',createdAt:T}));
 const visible=o=>o.crmVisible,hidden=o=>!o.crmVisible;
 return createHistoryReader({request:async(path)=>{
  if(['error','stale'].includes(scenario))throw Object.assign(Error('Falha simulada de consulta. Não é uma lista vazia e nenhuma API foi chamada.'),{status:503});
  const url=new URL(path,'https://fixture.invalid'),q=url.searchParams,after=q.get('after'),visibility=q.get('visibility')||'visible',limit=20;
  const page=(rows,view,scope)=>{const start=after?rows.findIndex(r=>r.id===after)+1:0,items=rows.slice(start,start+limit),hasMore=start+limit<rows.length;return {ok:true,historyView:view,history:{...scope,items,hasMore,nextCursor:hasMore?items.at(-1).id:null}};};
  if(url.pathname==='/api/channels'){const rows=scenario==='empty'?[]:instances.filter(c=>c.name.toLocaleLowerCase('pt-BR').includes((q.get('q')||'').toLocaleLowerCase('pt-BR'))),items=rows.filter(c=>!after||c.id>after).slice(0,limit),hasMore=rows.filter(c=>!after||c.id>after).length>limit;return {ok:true,viewer:{id:scenario==='support'?M:A,displayName:'Operador fictício',role:scenario==='support'?'master':'user'},tenant:{id:A,displayName:'Loja de demonstração'},items,hasMore,nextCursor:hasMore?items.at(-1).id:null};}
  const match=url.pathname.match(/^\/api\/channels\/([^/]+)\/threads(?:\/([^/]+)\/messages)?$/);if(!match)throw Error('Rota não pertence à demonstração.');const c=instances.find(c=>c.id===match[1]);if(!c)throw Error('Instância de exemplo inválida.');const scope={ownerId:A,instanceId:c.id};
  if(!match[2])return page(visibility==='all'||c.crmVisible===(visibility==='visible')?threads:[],'instance_threads',scope);
  const t=threads.find(t=>t.id===match[2]);if(!t)throw Error('Conversa de exemplo inválida.');
  const texts=['Olá! Gostaria de saber como funciona o atendimento.','Olá! Podemos ajudar por aqui.','Esta conversa apareceu também na outra instância.','O histórico fica unido, sem perder a origem.','<img src=x onerror=alert(1)> · exemplo de texto literal, não HTML'];
  const rows=Array.from({length:26},(_,i)=>{const all=i===2?[instances[0],instances[1]]:[instances[i%3]],origins=all.filter(visibility==='all'?()=>true:visibility==='visible'?visible:hidden).map(o=>({instanceId:o.id,name:o.name,crmVisible:o.crmVisible}));return {id:uid(500+i),threadId:t.id,providerMessageId:`SYNTHETIC_DEMO_${i}`,fromMe:i%2===1,text:i===5||i===6?null:texts[i%texts.length],mediaType:i===5?'privacy_omitted':i===6?null:'text',deleted:i===6,conflicted:i===8,ack:i===1?1:i===3?2:0,delivered:i===3,messageAt:new Date(Date.parse(T)+i*60000).toISOString(),timestampSource:i===7?'capture':'provider',dispatchState:i===9?'uncertain':i%2?'accepted':null,origins,originCount:origins.length,originsTruncated:false};}).filter(m=>m.origins.length);
  return page(rows,'canonical_thread',{...scope,threadId:t.id});
 }});
}

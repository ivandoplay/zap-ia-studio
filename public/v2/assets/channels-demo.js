// Dados fictícios em memória. Nunca conecta, envia, autentica ou consulta banco.
import {parseChannelInput,filterCrmContacts} from './channel-policy.js';
export function createChannelDemoStore({scenario='normal',count=32}={}){
 const empty=scenario==='empty',support=scenario==='support',now=new Date().toISOString(),viewer={id:'visual-operator',displayName:'Operador de demonstração',role:'master'},tenant={id:support?'visual-support-target':'visual-operator',displayName:support?'Cliente fictício · suporte':'Equipe de demonstração'};
 const rows=Array.from({length:empty?0:count},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:['Atendimento da loja','Campanhas · somente exemplo','Número fora do CRM','Suporte comercial'][i%4]+(i>=4?` ${i+1}`:''),transport:i%3?'evolution_api':'local_worker',crmVisible:i%3!==2,aiEnabled:i%4===0,campaignsEnabled:i%4===1,tags:i%2?['Campanhas','Exemplo']:['Atendimento','Loja'],revision:1,createdAt:now,updatedAt:now,connection:{status:i%5===4?'not_verified':'connected',checkedAt:now},capabilities:{canPair:false,reason:'DEMONSTRATION_ONLY'}}));
 const contacts=rows.slice(0,6).map((channel,i)=>({id:`contact-demo-${i}`,channelId:channel.id,name:`Contato fictício ${i+1}`,messages:['Mensagem sintética recebida','Mensagem sintética guardada']}));
 const denied=()=>{if(support)throw Object.assign(Error('Suporte: somente leitura.'),{status:403});};
 return {async list({q='',visibility='all',after=null,limit=20}={}){
   if(['error','stale'].includes(scenario))throw Object.assign(Error('Falha simulada de consulta. Não é uma lista vazia e nenhuma API foi chamada.'),{status:503});
   const search=q.toLocaleLowerCase('pt-BR'),filtered=rows.filter(c=>(visibility==='all'||c.crmVisible===(visibility==='visible'))&&(!search||[c.name,...c.tags].some(t=>t.toLocaleLowerCase('pt-BR').includes(search)))).sort((a,b)=>a.id.localeCompare(b.id)),candidates=filtered.filter(c=>!after||c.id>after),page=candidates.slice(0,limit),hasMore=candidates.length>limit;
   return {ok:true,schemaVersion:1,viewer,tenant,permissions:{canEdit:!support},items:structuredClone(page),total:filtered.length,hasMore,nextCursor:hasMore?page.at(-1).id:null,summary:{total:rows.length,crmVisible:rows.filter(c=>c.crmVisible).length,crmHidden:rows.filter(c=>!c.crmVisible).length,aiEnabled:rows.filter(c=>c.aiEnabled).length,campaignsEnabled:rows.filter(c=>c.campaignsEnabled).length},operationalMigrationPending:true};
  },async create(input){denied();const config=parseChannelInput(input);const channel={id:crypto.randomUUID(),...config,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),connection:{status:'not_verified',checkedAt:null},capabilities:{canPair:false,reason:'DEMONSTRATION_ONLY'}};rows.push(channel);return {ok:true,channel:structuredClone(channel)};},
  async update(id,revision,input){denied();const current=rows.find(c=>c.id===id);if(!current)throw Object.assign(Error('Canal de exemplo não encontrado.'),{status:404});if(current.revision!==revision)throw Object.assign(Error('Configuração mudou.'),{status:409});Object.assign(current,parseChannelInput(input,{partial:true}),{revision:revision+1,updatedAt:new Date().toISOString()});return {ok:true,channel:structuredClone(current)};},
  preview:()=>structuredClone({channels:rows,contacts}),
  // Interface de teste da projeção: mudar a visibilidade não modifica armazenamento.
  previewContacts:(visibility='visible')=>structuredClone(filterCrmContacts(contacts,Object.fromEntries(rows.map(c=>[c.id,c])),visibility))
 };
}

// Contrato puro compartilhado pelo servidor, UI e demonstração. Sem I/O ou efeitos operacionais.
export const isChannelId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const invalid=message=>{throw Object.assign(new Error(message),{status:400,code:'INVALID_CHANNEL'});};
export function parseChannelInput(body,{partial=false}={}){
 if(!body||typeof body!=='object'||Array.isArray(body))invalid('Configuração de canal inválida.');
 const allowed=new Set(partial?['name','crmVisible','aiEnabled','campaignsEnabled','tags']:['name','transport','crmVisible','aiEnabled','campaignsEnabled','tags']);
 if(!Object.keys(body).length||Object.keys(body).some(k=>!allowed.has(k)))invalid('Campo não permitido na configuração do canal.');
 const result=partial?{}:{name:'',transport:'',crmVisible:true,aiEnabled:false,campaignsEnabled:false,tags:[]};
 if(!partial||Object.hasOwn(body,'name')){if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>64||/[\u0000-\u001f]/.test(body.name))invalid('Nome do canal: de 1 a 64 caracteres.');result.name=body.name.trim();}
 if(!partial){if(!['evolution_api','local_worker'].includes(body.transport))invalid('Escolha Evolution API ou motor local.');result.transport=body.transport;}
 for(const key of ['crmVisible','aiEnabled','campaignsEnabled'])if(Object.hasOwn(body,key)){if(typeof body[key]!=='boolean')invalid(`${key} deve ser true ou false, sem conversão de strings.`);result[key]=body[key];}
 if(Object.hasOwn(body,'tags')){if(!Array.isArray(body.tags)||body.tags.length>8||body.tags.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>24||/[\u0000-\u001f]/.test(t)))invalid('Use até 8 etiquetas, com até 24 caracteres cada.');result.tags=[...new Set(body.tags.map(t=>t.trim()))];}
 return result;
}
export const channelAllowsAI=policy=>policy?.aiEnabled===true;
export const channelAllowsCampaign=policy=>policy?.campaignsEnabled===true;
// Esconder é uma projeção: não remove, reescreve ou impede a ingestão do histórico.
// Contatos legados sem vínculo migrado continuam visíveis até uma vinculação explícita.
export function filterCrmContacts(contacts,policies,visibility='visible'){
 if(!['visible','hidden','all'].includes(visibility))invalid('Filtro de visibilidade inválido.');
 if(visibility==='all')return [...contacts];
 return contacts.filter(contact=>{const hidden=policies[contact.channelId]?.crmVisible===false;return visibility==='hidden'?hidden:!hidden;});
}

// Campos demonstrativos do CRM original. Não é contrato de mutação operacional.
export const CRM_STAGES=[['novo','Novo contato'],['qualificando','Qualificando'],['em_atendimento','Em atendimento'],['aguardando_humano','Aguardando você'],['concluido','Concluído']];
const bool=new Set(['pinned','archived','aiEnabled','needsHuman','saved','hot','ignoreAi','blocked']);
const strings={name:80,company:120,city:80,email:120,phone:20,leadSource:80,note:1000,assignee:64,lostReason:240};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
const bad=()=>{throw Object.assign(Error('Campo do CRM demonstrativo inválido.'),{status:400});};
export function validateCrmDemoPatch(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)bad();const result={};for(const [key,value]of Object.entries(patch)){
 if(bool.has(key)){if(typeof value!=='boolean')bad();}
 else if(Object.hasOwn(strings,key)){if(typeof value!=='string'||value.length>strings[key]||key==='name'&&!value.trim()||key!=='note'&&/[\u0000-\u001f]/.test(value))bad();}
 else if(key==='unread'){if(!Number.isSafeInteger(value)||value<0||value>99)bad();}
 else if(key==='tags'){if(!Array.isArray(value)||value.length>8||value.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>24||/[\u0000-\u001f]/.test(t)))bad();}
 else if(key==='stage'){if(!CRM_STAGES.some(([id])=>id===value))bad();}
 else if(key==='dealStatus'){if(!['open','won','lost'].includes(value))bad();}
 else if(key==='dealValue'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9)bad();}
 else if(key==='followUp'){if(value!==null&&!date(value))bad();}
 else if(key==='aiPausedUntil'){if(value!==null&&value!=='manual'&&!date(value))bad();}
 else if(key==='tasks'){if(!Array.isArray(value)||value.length>30||value.some(t=>!t||Object.keys(t).some(k=>!['id','text','done'].includes(k))||typeof t.id!=='string'||!/^[\w-]{1,64}$/.test(t.id)||typeof t.text!=='string'||!t.text.trim()||t.text.length>200||typeof t.done!=='boolean')||new Set(value.map(t=>t.id)).size!==value.length)bad();}
 else if(key==='scheduled'){if(!Array.isArray(value)||value.length>10||value.some(t=>!t||Object.keys(t).some(k=>!['id','text','at','instanceId'].includes(k))||typeof t.id!=='string'||!/^[\w-]{1,64}$/.test(t.id)||typeof t.text!=='string'||!t.text.trim()||t.text.length>4000||!date(t.at)||typeof t.instanceId!=='string')||new Set(value.map(t=>t.id)).size!==value.length)bad();}
 else bad();result[key]=structuredClone(value);
 }if(result.tags)result.tags=[...new Set(result.tags.map(t=>t.trim()))];return result;}

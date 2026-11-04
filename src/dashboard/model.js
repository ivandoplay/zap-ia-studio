export const TIME_ZONE='America/Fortaleza';
const defaultFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function dayKey(value,timeZone=TIME_ZONE) {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries((timeZone===TIME_ZONE?defaultFormatter:new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})).formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function localSummary(data={}, {now=Date.now(),tenantId=null}={}) {
 const contacts=Object.values(data.contacts||{}),today=dayKey(now);
 const end=new Date(today+'T12:00:00Z');
 const days=Array.from({length:7},(_,i)=>{const d=new Date(end);d.setUTCDate(end.getUTCDate()-6+i);return {date:d.toISOString().slice(0,10),value:0};});
 for(const contact of contacts){const day=dayKey(contact.lastMessageAt);const entry=days.find(d=>d.date===day);if(entry)entry.value++;}
 return {schemaVersion:1,tenantId,generatedAt:new Date(now).toISOString(),timeZone:TIME_ZONE,counts:{conversations:contacts.length,pendingHuman:contacts.filter(c=>c.stage==='aguardando_humano').length,campaigns:null},campaigns:null,activityDefinition:'last_contact_activity',activity:days};
}
export function assertSummary(data,expectedTenant,{allowLocal=false}={}) {
 const count=v=>Number.isSafeInteger(v)&&v>=0;
 if(!data||data.schemaVersion!==1||data.tenantId!==expectedTenant||data.timeZone!==TIME_ZONE||!Number.isFinite(Date.parse(data.generatedAt||''))||data.activityDefinition!=='last_contact_activity')throw new Error('Resumo inválido');
 if(!count(data.counts?.conversations)||!count(data.counts?.pendingHuman)||data.counts.pendingHuman>data.counts.conversations||!(allowLocal&&data.counts.campaigns===null)&&!count(data.counts.campaigns))throw new Error('Contagens inválidas');
 if(!Array.isArray(data.activity)||data.activity.length!==7||data.activity.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!count(d.value)||(i>0&&d.date<=data.activity[i-1].date))||data.activity.reduce((n,d)=>n+d.value,0)>data.counts.conversations)throw new Error('Série inválida');
 return data;
}

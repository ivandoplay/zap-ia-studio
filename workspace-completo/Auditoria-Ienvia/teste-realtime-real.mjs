import { createRequire } from 'node:module';
const require=createRequire('/home/user/atendente-ia-whatsapp/package.json');
globalThis.WebSocket=require('ws');
const {createClient}=require('@supabase/supabase-js');
const {createInboxRealtime}=await import('/home/user/atendente-ia-whatsapp/src/inboxRealtime.js');
const {SUPABASE_URL:url,SUPABASE_ANON_KEY:key}=await import('/home/user/atendente-ia-whatsapp/src/cloudConfig.js');
const endpoint=`${url}/functions/v1/ienvia-realtime-lab-b4f9c38d`;
async function lab(body){const r=await fetch(endpoint,{method:'POST',headers:{'x-lab-key':'temporary-lab-b4f9c38d7165f2436a','Content-Type':'application/json',apikey:key},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error('Ensaio temporário: '+JSON.stringify(j));return j}
function tracker(){let n=0,waiters=[];const signal=()=>{n++;for(const x of waiters.splice(0))x()};return {signal,get count(){return n},async wait(nExpected,ms=18000){let timer;try{await Promise.race([new Promise(resolve=>{function check(){if(n>=nExpected)resolve();else waiters.push(check)}check()}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo esgotado aguardando sinal')),ms)})])}finally{clearTimeout(timer)}}}}
let users=[],a,b;
try{
 const r=await lab({action:'create'});users=r.users;const x=tracker(),y=tracker();
 a=createInboxRealtime({createClient,onChange:x.signal});b=createInboxRealtime({createClient,onChange:y.signal});
 await Promise.all([a.start({url,key,userId:users[0].id,token:users[0].token}),b.start({url,key,userId:users[1].id,token:users[1].token})]);
 await Promise.all([x.wait(1),y.wait(1)]);
 const contact={user_id:users[0].id,chat_id:'slot_1::teste@lid',data:{chatId:'slot_1::teste@lid',slotId:'slot_1',messages:[]}};
 const request=await fetch(`${url}/rest/v1/zapia_contacts`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${users[0].token}`,'Content-Type':'application/json'},body:JSON.stringify(contact)});if(!request.ok)throw new Error('Falha ao criar ficha temporária: '+request.status);
 await x.wait(2);console.log('Realtime Supabase: inserção da própria conta recebida.');
 await new Promise(resolve=>setTimeout(resolve,1200));if(y.count!==1)throw new Error('Outra conta recebeu evento!');console.log('Realtime Supabase: evento não vazou para outra conta.');
}finally{await a?.stop();await b?.stop();if(users.length)await lab({action:'cleanup',ids:users.map(u=>u.id)});console.log('Contas de teste removidas.');}

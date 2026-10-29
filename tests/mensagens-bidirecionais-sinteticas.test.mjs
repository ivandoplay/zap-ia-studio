import assert from 'node:assert/strict';
import test from 'node:test';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');
process.env.VERCEL='1';process.env.SUPABASE_URL='';process.env.SUPABASE_ANON_KEY='';
const {localStorageInstance:store}=await import('../src/storage.js');
const {whatsappManager}=await import('../src/whatsappManager.js');
store.inMemory=true;store.onMutate=null;store.data.contacts={};store.data.settings.botEnabled=false;const slot=whatsappManager.slots.slot_1;
slot.status='connected';slot.connectedUser={phone:'5586111111111',name:'Dono fictício'};slot.sock={authState:{creds:{me:{id:'5586111111111@s.whatsapp.net',lid:'100000000000001@lid'}}}};slot.broadcastFn=()=>{};slot.fetchContactAvatarIfNeeded=async()=>{};
try{
await test('mensagem comum recebida é adicionada ao CRM com IA desligada',async()=>{await slot.handleIncomingRawMessage({key:{remoteJid:'100000000000002@lid',remoteJidAlt:'5586222222222@s.whatsapp.net',fromMe:false,id:'recebida-sintetica'},message:{conversation:'teste entrada'},messageTimestamp:Math.floor(Date.now()/1000),pushName:'Cliente teste'});assert(Object.values(store.data.contacts).some(c=>c.messages?.some(m=>m.waMsgId==='recebida-sintetica'&&m.role==='user')))});
await test('mensagem enviada do telefone aparece no CRM',async()=>{await slot.handleIncomingRawMessage({key:{remoteJid:'100000000000002@lid',remoteJidAlt:'5586222222222@s.whatsapp.net',fromMe:true,id:'enviada-sintetica'},message:{conversation:'teste saída'},messageTimestamp:Math.floor(Date.now()/1000)});assert(Object.values(store.data.contacts).some(c=>c.messages?.some(m=>m.waMsgId==='enviada-sintetica'&&m.role==='owner')))});
await test('mensagem do aparelho endereçada ao próprio JID conserva telefone do destinatário',async()=>{await slot.handleIncomingRawMessage({key:{remoteJid:'5586111111111@s.whatsapp.net',fromMe:true,id:'device-sintetica'},message:{deviceSentMessage:{destinationJid:'5586333333333@s.whatsapp.net',message:{conversation:'mensagem device'}}},messageTimestamp:Math.floor(Date.now()/1000)});const c=Object.values(store.data.contacts).find(c=>c.messages?.some(m=>m.waMsgId==='device-sintetica'));assert(c,'mensagem precisa aparecer');assert.equal(c.phone,'5586333333333','ficha precisa manter o telefone do destinatário e nunca do próprio chip')});
await test('diagnóstico agregado não contém conteúdo nem identificadores',()=>{const diag=slot.getLiveMessageDiagnostics();assert(diag.gravadasEntrada>=1);assert(diag.gravadasSaida>=2);const texto=JSON.stringify(diag);assert(!texto.includes('teste entrada'));assert(!texto.includes('5586'));});
}finally{slot.sock=null;slot.status='disconnected';slot.connectedUser=null;clearInterval(slot.scheduledMsgTimer);clearInterval(whatsappManager.followUpTimer);if(store.saveTimer)clearTimeout(store.saveTimer)}

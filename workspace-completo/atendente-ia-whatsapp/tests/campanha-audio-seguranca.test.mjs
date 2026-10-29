import test from 'node:test';
import assert from 'node:assert/strict';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Use somente cópia sem sessões reais.');
process.env.VERCEL='1';process.env.SUPABASE_URL='';process.env.SUPABASE_ANON_KEY='';
const {localStorageInstance:storage}=await import('../src/storage.js');
const {whatsappManager}=await import('../src/whatsappManager.js');
storage.inMemory=true;storage.data.settings.antiBan={simulateTyping:false};
const slot=whatsappManager.slots.slot_1;slot.status='connected';slot.rememberBotMessage=()=>{};
try {
 await test('nota de voz com resultado incerto não dispara uma segunda chamada ao WhatsApp',async()=>{
  let chamadas=0;slot.sock={waUploadToServer:async()=>{},sendMessage:async()=>{chamadas++;throw new Error('tempo de resposta esgotado')}};
  await assert.rejects(()=>slot.sendCanonicalVoiceNote({chatId:'111111111111@s.whatsapp.net',oggBuffer:Buffer.from('ogg sintético')}),/tempo/);
  assert.equal(chamadas,1,'erro de upload pode ocorrer após o envio; não reenviar automaticamente');
 });
 await test('nota de voz aceita usa o canal PTT e devolve identificação do envio',async()=>{
  let chamadas=0;slot.sock={waUploadToServer:async()=>{},sendMessage:async(_jid,payload,opts)=>{chamadas++;assert.equal(payload.ptt,true);assert.equal(typeof opts.upload,'function');return {key:{id:'id-sintetico'}}}};
  const r=await slot.sendCanonicalVoiceNote({chatId:'111111111111@s.whatsapp.net',oggBuffer:Buffer.from('ogg sintético')});
  assert.equal(r.key.id,'id-sintetico');assert.equal(chamadas,1);
 });
} finally {slot.sock=null;clearInterval(whatsappManager.followUpTimer);if(storage.saveTimer)clearTimeout(storage.saveTimer);}

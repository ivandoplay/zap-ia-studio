import assert from 'node:assert/strict';
assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Somente em cópia isolada');
process.env.VERCEL='1'; process.env.SUPABASE_URL='http://127.0.0.1:1'; process.env.SUPABASE_ANON_KEY='teste';
const {localStorageInstance: store,Storage}=await import('../src/storage.js');
const {whatsappManager}=await import('../src/whatsappManager.js');
store.inMemory=true;store.onMutate=null;store.data.contacts={};store.data.settings.deletedChatTombstones={};
const slot=whatsappManager.slots.slot_2;const raw='5511998765432@s.whatsapp.net',key=`slot_2::${raw}`;
const oldTime=Math.floor(Date.now()/1000)-120;
try {
 store.upsertContact(key,{phone:'5511998765432',name:'Sintético'}, {deferSave:true});
 assert.equal(store.deleteContact(key),true);
 const cutoff=store.getDeletedChatTombstoneMs(key,'5511998765432');assert(cutoff>0);
 store.upsertContact(key,{phone:'5511998765432',name:'Restaurado manualmente',forceName:true,savedContact:true},{deferSave:true});
 slot.ingestHistorySyncPayload({syncType:6,messages:[{key:{remoteJid:raw,fromMe:false,id:'mensagem-antiga-falsa'},messageTimestamp:oldTime,message:{conversation:'conteúdo sintético antigo'}}]});
 assert.equal(store.data.contacts[key].messages.length,0,'Recriar ficha manualmente não deve ressuscitar mensagens anteriores à exclusão');
 assert((new Date(store.data.contacts[key].historyClearedAt||0)).getTime()>=cutoff,'Recriação deve preservar fronteira temporal da exclusão');
 const newTime=Math.ceil(cutoff/1000)+10;
 slot.ingestHistorySyncPayload({syncType:6,messages:[{key:{remoteJid:raw,fromMe:false,id:'mensagem-nova-falsa'},messageTimestamp:newTime,message:{conversation:'conteúdo sintético novo'}}]});
 assert.equal(store.data.contacts[key].messages.length,1,'Mensagens posteriores à exclusão continuam permitidas');
 const otherSlot=whatsappManager.slots.slot_1;
 otherSlot.ingestHistorySyncPayload({syncType:6,messages:[{key:{remoteJid:raw,fromMe:false,id:'outra-linha-falsa'},messageTimestamp:oldTime,message:{conversation:'outro chip'}}]});
 assert.equal(store.data.contacts[raw].messages.length,1,'Exclusão de chip 2 não afeta histórico do chip 1');
 const many=new Storage({inMemory:true,initialData:{contacts:{}}});
 for(let i=0;i<1200;i++)many.recordDeletedChatTombstone(`sintetico-${i}@lid`);
 assert(many.getDeletedChatTombstoneMs('sintetico-0@lid')>0,'Exclusões antigas não podem expirar silenciosamente ao passar de 800');
 assert(many.getDeletedChatTombstoneMs('sintetico-1199@lid')>0);
 assert.equal(many.getDeletedChatTombstoneMs('slot_2::sintetico-0@lid'),0,'Exclusão em um chip não deve afetar outro');
 console.log('OK: exclusão preservada após recriação manual, sem expiração arbitrária e com isolamento por chip.');
} finally {clearInterval(whatsappManager.followUpTimer); if(store.saveTimer)clearTimeout(store.saveTimer)}

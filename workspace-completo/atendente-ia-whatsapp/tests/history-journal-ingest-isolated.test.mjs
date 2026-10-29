import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import { DATA_DIR, localStorageInstance as store } from '../src/storage.js';
import { enableHistoryJournal,countJournalFiles,journalUserFolder } from '../src/historyJournal.js';
import { whatsappManager } from '../src/whatsappManager.js';
if(process.env.ZAPIA_ISOLATED_TEST!=='1' || !process.env.ZAPIA_TEST_ROOT || !DATA_DIR.startsWith(path.resolve(process.env.ZAPIA_TEST_ROOT)+path.sep)) throw new Error('Executar apenas em cópia isolada sem dados reais.');
store.userId='conta-falsa-'+crypto.randomUUID();store.data.contacts={};
store.saveSoon=()=>{};
const root=path.join(DATA_DIR,'history-journal');enableHistoryJournal(root,store.userId);
const slot=whatsappManager.slots.slot_2;
const payload={syncType:2,chats:[],contacts:[],messages:Array.from({length:125},(_,i)=>({
  key:{remoteJid:'5511999999999@s.whatsapp.net',fromMe:false,id:`fake-${i}`},
  message:{conversation:`fake-${i}`},messageTimestamp:1700000000+i
}))};
try {
 slot.ingestHistorySyncPayload(payload);
 assert.equal(countJournalFiles(root,store.userId,'slot_2'),1);
 const d=path.join(journalUserFolder(root,store.userId),'slot_2');
 const saved=JSON.parse(fs.readFileSync(path.join(d,fs.readdirSync(d)[0]),'utf8'));
 assert.equal(saved.payload.messages.length,125,'O diário precisa guardar o pacote antes do recorte.');
 assert.equal(Object.values(store.data.contacts)[0].messages.length,120,'O cache antigo ainda permanece limitado.');
 assert.equal(countJournalFiles(root,store.userId,'slot_1'),0);
 console.log('OK: lote realista de 125 gravado no diário antes do cache limitado, sem outros chips.');
}finally{clearInterval(whatsappManager.followUpTimer);if(store.saveTimer)clearTimeout(store.saveTimer);fs.rmSync(journalUserFolder(root,store.userId),{recursive:true,force:true})}

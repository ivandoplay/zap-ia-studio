import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {writeHistoryJournal,enableHistoryJournal,isHistoryJournalEnabled,countJournalFiles} from '../src/historyJournal.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zapia-journal-test-'));
try {
  assert.equal(isHistoryJournalEnabled(root,'a'),false);
  enableHistoryJournal(root,'a');enableHistoryJournal(root,'a');
  assert.equal(isHistoryJournalEnabled(root,'a'),true);assert.equal(isHistoryJournalEnabled(root,'b'),false);
  const payload={syncType:2,messages:Array.from({length:5000},(_,i)=>({key:{id:`m${i}`,remoteJid:'falso@lid'},message:{conversation:`fake ${i}`},messageTimestamp:1700000000n+BigInt(i)}))};
  const a=writeHistoryJournal({root,userId:'a',slotId:'slot_2',payload});
  const b=writeHistoryJournal({root,userId:'b',slotId:'slot_2',payload:{messages:[]}});
  assert.notEqual(path.dirname(a.file),path.dirname(b.file));
  const parsed=JSON.parse(fs.readFileSync(a.file,'utf8'));
  assert.equal(parsed.payload.messages.length,5000);assert.equal(parsed.payload.messages[0].messageTimestamp,'1700000000');
  assert.equal(parsed.payload.messages[4999].message.conversation,'fake 4999');
  assert.equal(countJournalFiles(root,'a','slot_2'),1);assert.equal(countJournalFiles(root,'a','slot_1'),0);
  assert.throws(()=>writeHistoryJournal({root,userId:'a',slotId:'../../',payload}),/inválido/);
  assert.throws(()=>writeHistoryJournal({root,userId:'',slotId:'slot_1',payload}),/inválido/);
  if(process.platform!=='win32') assert.equal(fs.statSync(a.file).mode&0o077,0);
  console.log('OK: diário local opcional, 5.000 mensagens, isolamento por conta/chip e permissões.');
}finally{fs.rmSync(root,{recursive:true,force:true})}

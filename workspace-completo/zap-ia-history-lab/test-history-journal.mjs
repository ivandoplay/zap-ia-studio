import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {writeHistoryJournal} from './historyJournal.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zapia-raw-lab-'));
try{
  const payload={syncType:2,messages:Array.from({length:5000},(_,i)=>({key:{id:`m${i}`,remoteJid:'fake@lid'},message:{conversation:`falso ${i}`},messageTimestamp:1700000000n+BigInt(i)}))};
  const a=writeHistoryJournal({root,userId:'a',slotId:'slot_2',payload});
  const b=writeHistoryJournal({root,userId:'b',slotId:'slot_2',payload:{messages:[]}});
  assert.notEqual(path.dirname(a.file),path.dirname(b.file));
  const parsed=JSON.parse(fs.readFileSync(a.file,'utf8'));
  assert.equal(parsed.payload.messages.length,5000);assert.equal(parsed.payload.messages[0].messageTimestamp,'1700000000');
  assert.equal(parsed.payload.messages[4999].message.conversation,'falso 4999');
  assert.throws(()=>writeHistoryJournal({root,userId:'a',slotId:'../../',payload}),/inválido/);
  if(process.platform!=='win32') assert.equal(fs.statSync(a.file).mode&0o077,0);
  console.log(`OK: diário bruto de 5000 mensagens, isolamento e permissões; ${a.bytes} bytes.`);
}finally{fs.rmSync(root,{recursive:true,force:true})}

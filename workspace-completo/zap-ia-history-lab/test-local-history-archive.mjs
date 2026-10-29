import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExperimentalLocalHistoryArchive } from './local-history-archive.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'zapia-lab-historico-'));
try {
  const a=new ExperimentalLocalHistoryArchive(root);
  const user='conta-teste-a', chip1='111111111111@s.whatsapp.net', chip2='slot_2::111111111111@s.whatsapp.net';
  const msgs=Array.from({length:5000},(_,i)=>({waMsgId:`m${String(i).padStart(6,'0')}`,role:'user',text:`teste-${i}`,timestamp:new Date(1700000000000+i*1000).toISOString()}));
  for(let i=0;i<msgs.length;i+=200) a.append(user,chip2,msgs.slice(i,i+200));
  a.append(user,chip2,[msgs[3],{...msgs[4],text:'texto editado'}]);
  a.append(user,chip1,[{...msgs[0],text:'chip-um'}]);
  a.append('conta-teste-b',chip2,[{...msgs[0],text:'outra-conta'}]);
  const restarted=new ExperimentalLocalHistoryArchive(root);
  assert.equal(restarted.readAll(user,chip2).length,5000);
  assert.equal(restarted.readAll(user,chip2)[4].text,'texto editado');
  assert.equal(restarted.readAll(user,chip1)[0].text,'chip-um');
  assert.equal(restarted.readAll('conta-teste-b',chip2)[0].text,'outra-conta');
  let cursor=null,ids=[];
  do { const p=restarted.page(user,chip2,{before:cursor,limit:100}); ids.unshift(...p.messages.map(m=>m.waMsgId)); cursor=p.nextBefore; } while(cursor);
  assert.deepEqual(ids,msgs.map(m=>m.waMsgId));
  restarted.clear(user,chip2,msgs[2499].timestamp);
  restarted.append(user,chip2,[msgs[0]]);
  assert.equal(restarted.readAll(user,chip2).length,2500,'Limpeza não pode ressuscitar mensagens antigas.');
  assert.throws(()=>restarted.append(user,chip2,[{text:'sem id'}]),/identificador/);
  const corrupt=restarted.filename(user,'slot_3::corrompido');
  fs.mkdirSync(path.dirname(corrupt),{recursive:true});
  fs.writeFileSync(corrupt,'{"kind":');
  assert.throws(()=>restarted.readAll(user,'slot_3::corrompido'),/incompleto/);
  console.log('OK: protótipo isolado: 5.000 mensagens, páginas, reinício, isolamento, deduplicação, limpeza e erro de arquivo incompleto.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }

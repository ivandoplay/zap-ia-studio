import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {SqliteHistoryLab} from './native-sqlite-history.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zapia-load-')),f=path.join(root,'hist.db'), start=Date.now();
try {
 const db=new SqliteHistoryLab(f);db.close();
 const children=Array.from({length:4},(_,i)=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','load-writer.mjs',f,String(i*25),'25'],{cwd:process.cwd()});
   let err='';child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',(code)=>code===0?resolve():reject(new Error(`writer ${i}: ${err}`)));
 }));
 await Promise.all(children);
 const verify=new SqliteHistoryLab(f);
 try {
   for(let i=0;i<100;i++)assert.equal(verify.count(`conta-${Math.floor(i/3)}`,`slot_${i%3+1}::simulado-${i}`),1000);
   assert.equal(verify.db.get('PRAGMA integrity_check').integrity_check,'ok');
   console.log(`OK: 100 números simulados, 100.000 mensagens, 4 processos concorrentes; todos os registros conferidos e integridade SQLite verificada; ${((Date.now()-start)/1000).toFixed(2)} s; ${(fs.statSync(f).size/1048576).toFixed(1)} MiB.`);
 }finally{verify.close();}
}finally{fs.rmSync(root,{recursive:true,force:true});}

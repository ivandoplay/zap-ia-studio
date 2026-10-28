import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createZipBuffer } from '../src/zipReader.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ienvia-update-integridade-'));
const target = 'ZAP-IA-Studio/sistema/arquivo-teste.txt';
const files = [
  { path: 'ZAP-IA-Studio/sistema/package.json', content: JSON.stringify({version:'99.0.0'}) },
  { path: target, content: 'TEXTO ORIGINAL' },
  ...Array.from({length:9}, (_,i)=>({path:`ZAP-IA-Studio/sistema/extra${i}.txt`,content:'ok'}))
];
const originalZip = createZipBuffer(files);
const zip = Buffer.from(originalZip);
let servedZip = zip;
const centralOffset = zip.readUInt32LE(zip.length-22+16);
let ptr=centralOffset, pos=-1;
for (let i=0;i<files.length;i++) {
  const n=zip.readUInt16LE(ptr+28), x=zip.readUInt16LE(ptr+30), c=zip.readUInt16LE(ptr+32);
  const name=zip.subarray(ptr+46,ptr+46+n).toString();
  if(name===target){const local=zip.readUInt32LE(ptr+42);assert.equal(zip.readUInt16LE(ptr+10),0);pos=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);break;}
  ptr+=46+n+x+c;
}
assert(pos>0); zip[pos]^=1;
const fake=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/public/version')){res.setHeader('content-type','application/json');res.end(JSON.stringify({version:'99.0.0'}));}
 else if(req.url.startsWith('/api/public/motor-update.zip')){res.setHeader('content-type','application/zip');res.end(servedZip);}
 else{res.statusCode=404;res.end();}
});
try {
 await fs.mkdir(path.join(root,'scripts'));await fs.mkdir(path.join(root,'src'));await fs.mkdir(path.join(root,'data'));
 await fs.copyFile(new URL('../scripts/auto_update_boot.mjs',import.meta.url),path.join(root,'scripts','auto_update_boot.mjs'));
 await fs.copyFile(new URL('../src/zipReader.js',import.meta.url),path.join(root,'src','zipReader.js'));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module',version:'1.0.0'}));
 await fs.writeFile(path.join(root,'arquivo-teste.txt'),'MANTER ORIGINAL');
 await fs.writeFile(path.join(root,'data','database.json'),'DADOS SINTÉTICOS');
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const runUpdate = async () => {
  const child=spawn(process.execPath,[path.join(root,'scripts','auto_update_boot.mjs')],{env:{...process.env,VERCEL:'',ZAPIA_SKIP_AUTO_UPDATE:'',ZAPIA_DEFER_NPM:'1',ZAPIA_BASE_URL:`http://127.0.0.1:${fake.address().port}`}});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
  assert.equal(exit,0);return output;
 };
 let output=await runUpdate();assert.match(output,/não foi possível concluir/i);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,'1.0.0');
 assert.equal(await fs.readFile(path.join(root,'arquivo-teste.txt'),'utf8'),'MANTER ORIGINAL');
 assert.equal(await fs.readFile(path.join(root,'data','database.json'),'utf8'),'DADOS SINTÉTICOS');
 servedZip=originalZip;
 output=await runUpdate();assert.match(output,/atualizado automaticamente/i);
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,'99.0.0');
 assert.equal(await fs.readFile(path.join(root,'arquivo-teste.txt'),'utf8'),'TEXTO ORIGINAL');
 assert.equal(await fs.readFile(path.join(root,'data','database.json'),'utf8'),'DADOS SINTÉTICOS');
 console.log('OK: pacote corrompido recusado; pacote íntegro atualiza preservando dados.');
} finally {await new Promise(r=>fake.listening?fake.close(r):r());await fs.rm(root,{recursive:true,force:true});}

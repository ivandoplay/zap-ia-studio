import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractZipBuffer } from '../src/zipReader.js';
const expectedVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='dados-sinteticos';
const {app}=await import('../src/server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const url of ['/','/painel','/manifest.json']){
  const res=await fetch(base+url);assert.equal(res.status,200);const text=await res.text();assert.match(text,/Ienvia/);assert.doesNotMatch(text,/>\s*ZAP-IA(?: Studio)?\s*</i);
 }
 const res=await fetch(base+'/api/public/motor-update.zip');assert.equal(res.status,200);assert(res.headers.get('content-disposition').includes(`Ienvia-v${expectedVersion}.zip`));
 const archive=extractZipBuffer(Buffer.from(await res.arrayBuffer()));assert.equal(archive.rootFolderName,'ZAP-IA-Studio','Atualizadores antigos precisam da raiz técnica original');
 const get=(p)=>archive.files.find(f=>f.relPath===p)?.buffer;
 assert(get('sistema/public/ienvia-logo-v2.png'));assert.equal(JSON.parse(get('sistema/package.json').toString()).version,expectedVersion);
 assert.match(get('MANUAL_OFICIAL.html').toString(),/Ienvia/);
 const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');assert.match(source,/collectCleanMotorZipEntries\(Boolean\(isMasterCaller\), 'Ienvia'\)/);
 console.log('OK: marca Ienvia, instalação e compatibilidade do pacote automático.');
} finally {await new Promise(r=>server.close(r));}

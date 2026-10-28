import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {extractZipBuffer} from '../src/zipReader.js';import {verifySignedManifest} from '../src/updateSignature.js';import {UPDATE_PUBLIC_KEY} from '../src/updatePublicKey.js';
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const {app,collectCleanMotorZipEntries}=await import('../src/server.js');
const zip=fs.readFileSync(path.join(root,'release/motor-update.zip'));const files=extractZipBuffer(zip).files;
const mp='ZAP-IA-Studio/sistema/release/update-manifest.json',sp='ZAP-IA-Studio/sistema/release/update-manifest.sig';
const manifest=files.find(f=>f.path===mp).buffer,signature=files.find(f=>f.path===sp).buffer;
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
verifySignedManifest(files.filter(f=>f.path!==mp&&f.path!==sp).map(f=>({zipPath:f.path,content:f.buffer})),manifest,signature,UPDATE_PUBLIC_KEY,version);
verifySignedManifest(collectCleanMotorZipEntries(false).map(e=>({zipPath:e.path,content:e.content})),manifest,signature,UPDATE_PUBLIC_KEY,version);
assert(!files.some(f=>/chave-privada|\.agents|data\/training_packs/i.test(f.path)));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const endpoint=`http://127.0.0.1:${server.address().port}/api/public/motor-update.zip`;
 let res=await fetch(endpoint);assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),zip);
 if(process.env.ZAPIA_ISOLATED_TEST==='1'){
  const config=path.join(root,'vercel.json'),asset=path.join(root,'release/motor-update.zip');const configBytes=fs.readFileSync(config);
  try{
   fs.writeFileSync(config,'alteração sintética do ambiente de build');
   res=await fetch(endpoint);assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),zip);
   const broken=Buffer.from(zip);broken[100]^=1;fs.writeFileSync(asset,broken);
   res=await fetch(endpoint);assert.equal(res.status,500,'artefato corrompido não pode ser servido');
  } finally {fs.writeFileSync(config,configBytes);fs.writeFileSync(asset,zip);}
 }
}finally{await new Promise(r=>server.close(r));}
console.log('OK: ZIP pronto, assinatura e arquivos atuais conferem; endpoint serve exatamente o artefato.');

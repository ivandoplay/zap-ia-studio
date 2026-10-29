import assert from 'node:assert/strict';
import {extractZipBuffer} from '/home/user/atendente-ia-whatsapp/src/zipReader.js';
import {verifySignedManifest} from '/home/user/atendente-ia-whatsapp/src/updateSignature.js';
import {UPDATE_PUBLIC_KEY} from '/home/user/atendente-ia-whatsapp/src/updatePublicKey.js';
const base='https://zap-ia-studio.vercel.app';
let r=await fetch(base+'/api/public/version',{cache:'no-store'});assert.equal(r.status,200);let v=await r.json();assert.equal(v.version,'5.8.19');
r=await fetch(base+'/api/public/motor-update.zip',{cache:'no-store'});if(r.status!==200){console.error('ZIP HTTP',r.status, (await r.text()).slice(0,500));process.exit(1)}
let all=extractZipBuffer(Buffer.from(await r.arrayBuffer())).files.map(f=>({zipPath:f.path,content:f.buffer}));let paths=['ZAP-IA-Studio/sistema/release/update-manifest.json','ZAP-IA-Studio/sistema/release/update-manifest.sig'];let a=all.find(f=>f.zipPath===paths[0]),b=all.find(f=>f.zipPath===paths[1]);assert(a&&b);verifySignedManifest(all.filter(f=>!paths.includes(f.zipPath)),a.content,b.content,UPDATE_PUBLIC_KEY,v.version);assert(!all.some(f=>f.zipPath.includes('.agents')||f.zipPath.includes('chave-privada')));console.log('OK: versão, ZIP e assinatura Ed25519 em produção; chave privada ausente; arquivos:',all.length);

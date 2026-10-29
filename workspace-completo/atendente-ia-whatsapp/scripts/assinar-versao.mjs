#!/usr/bin/env node
// Assina uma versão após finalizar todos os arquivos. A chave privada fica fora do Git.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSignedManifest, verifySignedManifest } from '../src/updateSignature.js';
import { UPDATE_PUBLIC_KEY } from '../src/updatePublicKey.js';
import { createZipBuffer, extractZipBuffer } from '../src/zipReader.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const keyPath=process.env.IENVIA_CHAVE_ASSINATURA || path.join(root,'.agents','ienvia-assinatura','chave-privada.pem');
if(!fs.existsSync(keyPath))throw new Error('Chave privada indisponível; não gerar nem publicar pacote sem assinatura.');
process.env.VERCEL='1';
const {collectCleanMotorZipEntries}=await import('../src/server.js');
const entries=collectCleanMotorZipEntries(false).map(e=>({zipPath:e.path,content:e.content}));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const {manifest,signature}=makeSignedManifest(entries,version,fs.readFileSync(keyPath));
verifySignedManifest(entries,manifest,signature,UPDATE_PUBLIC_KEY,version);
const dir=path.join(root,'release');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'update-manifest.json'),manifest);
fs.writeFileSync(path.join(dir,'update-manifest.sig'),signature);
const manifestPath='ZAP-IA-Studio/sistema/release/update-manifest.json';
const signaturePath='ZAP-IA-Studio/sistema/release/update-manifest.sig';
const zip=createZipBuffer([...entries.map(e=>({path:e.zipPath,content:e.content})),{path:manifestPath,content:manifest},{path:signaturePath,content:signature}]);
const extracted=extractZipBuffer(zip).files;
verifySignedManifest(extracted.filter(f=>f.path!==manifestPath&&f.path!==signaturePath).map(f=>({zipPath:f.path,content:f.buffer})),manifest,signature,UPDATE_PUBLIC_KEY,version);
fs.writeFileSync(path.join(dir,'motor-update.zip'),zip);
console.log(`Versão ${version} assinada (${entries.length} arquivos); chave privada não incluída.`);

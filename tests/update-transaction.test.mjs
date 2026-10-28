import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import { spawnSync } from 'node:child_process';
import { applyUpdateTransaction, recoverInterruptedUpdate } from '../src/updateTransaction.js';
const base=fs.mkdtempSync(path.join(os.tmpdir(),'ienvia-transacao-'));const root=path.join(base,'sistema');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.mkdirSync(path.join(root,'data','wa_auth'),{recursive:true});
const original=path.join(root,'src','arquivo.txt');fs.writeFileSync(original,'ANTES');fs.writeFileSync(path.join(root,'data','database.json'),'BANCO');fs.writeFileSync(path.join(root,'data','wa_auth','sessao'),'SESSAO');
const entries=[{zipPath:'ZAP-IA-Studio/sistema/src/arquivo.txt',content:Buffer.from('DEPOIS')},{zipPath:'ZAP-IA-Studio/sistema/src/novo.txt',content:Buffer.from('NOVO')},{zipPath:'ZAP-IA-Studio/sistema/data/database.json',content:Buffer.from('ERRADO')}];
try {
 assert.throws(()=>applyUpdateTransaction({rootDir:root,entries,onApplied:()=>{throw new Error('falha simulada')}}),/falha simulada/);
 assert.equal(fs.readFileSync(original,'utf8'),'ANTES');assert.equal(fs.existsSync(path.join(root,'src','novo.txt')),false);assert.equal(fs.readFileSync(path.join(root,'data','database.json'),'utf8'),'BANCO');
 const mod=new URL('../src/updateTransaction.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {applyUpdateTransaction} from ${JSON.stringify(mod)};applyUpdateTransaction({rootDir:${JSON.stringify(root)},entries:[{zipPath:'ZAP-IA-Studio/sistema/src/arquivo.txt',content:Buffer.from('INTERROMPIDO')}],onApplied:()=>process.exit(77)});`]);
 assert.equal(child.status,77);assert.equal(fs.readFileSync(original,'utf8'),'INTERROMPIDO');
 assert.equal(recoverInterruptedUpdate(root),true);assert.equal(fs.readFileSync(original,'utf8'),'ANTES');assert.equal(fs.readFileSync(path.join(root,'data','wa_auth','sessao'),'utf8'),'SESSAO');
 assert.equal(applyUpdateTransaction({rootDir:root,entries}),2);assert.equal(fs.readFileSync(original,'utf8'),'DEPOIS');assert.equal(fs.readFileSync(path.join(root,'src','novo.txt'),'utf8'),'NOVO');assert.equal(recoverInterruptedUpdate(root),false);
 if(process.platform!=='win32') {const outside=path.join(base,'fora');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'link'),'dir');assert.throws(()=>applyUpdateTransaction({rootDir:root,entries:[{zipPath:'ZAP-IA-Studio/sistema/link/mal.txt',content:Buffer.from('NÃO')}]}),/link|simbólico/i);assert.equal(fs.existsSync(path.join(outside,'mal.txt')),false);}
 console.log('OK: falha e interrupção recuperam arquivos, dados protegidos permanecem e links são bloqueados.');
} finally {fs.rmSync(base,{recursive:true,force:true});}

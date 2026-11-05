#!/usr/bin/env node
// Executa testes numa cópia descartável, sem sessões locais nem .env de produção.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// A suíte cresceu; ajuste explícito só do prazo do harness, nunca das asserções.
const testTimeout=Number(process.env.ZAPIA_TEST_TIMEOUT_MS||240000);
if(!Number.isSafeInteger(testTimeout)||testTimeout<1000||testTimeout>900000)throw new Error('ZAPIA_TEST_TIMEOUT_MS deve estar entre 1000 e 900000.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ienvia-tests-')),copy=path.join(temp,'project');
const filter=process.argv[2] ? new RegExp(process.argv[2]) : null;
try {
 fs.mkdirSync(copy);
 for(const name of fs.readdirSync(root)) {
   if(['node_modules','.git','.agents','.vercel','.runtime','.env','data','uploads','screenshots','docs','auditoria'].includes(name)||name.startsWith('.env.')&&name!=='.env.example'||name.endsWith('.log'))continue;
   fs.cpSync(path.join(root,name),path.join(copy,name),{recursive:true});
 }
 fs.mkdirSync(path.join(copy,'data'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(copy,'node_modules'),'dir');
 const tests=fs.readdirSync(path.join(copy,'tests')).filter(f=>f.endsWith('.test.mjs')&&(!filter||filter.test(f))).sort().map(f=>path.join('tests',f));
 if(!tests.length)throw new Error('Nenhum teste selecionado.');
 // Não herdar tokens de Supabase, Evolution, IA ou outros serviços.
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','TEMP','SystemRoot','PLAYWRIGHT_BROWSERS_PATH','LD_LIBRARY_PATH','PREVIEW_ARTIFACTS'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 Object.assign(env,{ZAPIA_ISOLATED_TEST:'1',ZAPIA_TEST_ROOT:temp,ZAPIA_PLAYWRIGHT_REQUIRE:path.join(root,'package.json'),ZAPIA_NO_TTY_PROMPT:'1'});
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests],{cwd:copy,env,stdio:'inherit',timeout:testTimeout});
 if(result.error)console.error(result.error.message);
 process.exitCode=result.status??1;
} finally { fs.rmSync(temp,{recursive:true,force:true}); }

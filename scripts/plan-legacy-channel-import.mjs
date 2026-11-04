#!/usr/bin/env node
// SOMENTE PLANEJAMENTO LOCAL. Não carrega .env, não usa credenciais e não executa RPC/SQL.
import {readFileSync} from 'node:fs';
import {buildLegacyImportPlan} from '../src/channels/legacyBridge.js';
try{
 if(process.argv.length!==3||process.argv[2].startsWith('--'))throw Error('Uso: node scripts/plan-legacy-channel-import.mjs arquivo-de-revisao.json. Não existe opção de aplicação.');
 const bytes=readFileSync(process.argv[2]);if(bytes.length>65536)throw Error('Arquivo de revisão excede 64 KiB.');
 const plan=buildLegacyImportPlan(JSON.parse(bytes.toString('utf8')));process.stdout.write(JSON.stringify(plan,null,2)+'\n');
}catch(error){console.error(error.code==='ENOENT'?'Arquivo de revisão não encontrado.':error instanceof SyntaxError?'JSON de revisão inválido.':error.message);process.exitCode=2;}

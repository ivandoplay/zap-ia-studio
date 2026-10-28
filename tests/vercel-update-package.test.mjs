import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const glob=config.functions['api/index.js'].includeFiles;
assert.match(glob,/(?:^|[,{])vercel\.json(?:[,}]|$)/,'vercel.json é distribuído pelo coletor: deve ser incluído na função da Vercel');
assert.match(glob,/(?:^|[,{])release\/\*\*(?:[,}]|$)/,'manifesto e assinatura precisam estar na função da Vercel');
assert(glob.length<=256,'includeFiles excede limite da Vercel');
console.log('OK: configuração inclui o manifesto e o arquivo vercel.json no pacote da função.');

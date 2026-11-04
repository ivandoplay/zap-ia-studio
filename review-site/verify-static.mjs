import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'public');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(manifest.visualOnly!==true)throw new Error('Expected visual-only manifest');
const expected=new Set(Object.keys(manifest.publicHashes));let count=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),rel=path.relative(out,file).replaceAll('\\','/');if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed');if(entry.isDirectory()){if(['api','functions','data','uploads'].includes(entry.name))throw new Error('Runtime folders are forbidden');walk(file);}else {if(!expected.has(rel)||/(^|\/)\.env|session-client\.js$|(^|\/)(app|connections-app|channels-app|history-app|conversations-app)\.js$/.test(rel))throw new Error('Unexpected public asset: '+rel);const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==manifest.publicHashes[rel])throw new Error('Asset changed: '+rel);count++;}}}
walk(out);if(count!==expected.size)throw new Error('Missing public assets');
if(fs.existsSync(path.join(root,'api')))throw new Error('API is forbidden in the review project');
console.log(`Verified ${count} static assets. No functions or runtime APIs.`);

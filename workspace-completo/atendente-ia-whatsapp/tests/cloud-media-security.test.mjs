import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');process.env.VERCEL='1';process.env.SUPABASE_URL='https://supabase-sintetico.invalid';process.env.SUPABASE_ANON_KEY='teste';
const {localStorageInstance:store,tenantCloudMediaCachePath}=await import('../src/storage.js');const cloud=await import('../src/supabaseCloud.js');const {ensureLocalMediaCached}=cloud;
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',file=`teste-${crypto.randomUUID()}.bin`;store.userId=user;let calls=[];const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),options});return new Response(Buffer.from('conteúdo sintético'),{status:200,headers:{'content-type':'application/octet-stream'}})};
try{
 const publicBase='https://supabase-sintetico.invalid/storage/v1/object/public/zapia-media';
 assert.equal(await ensureLocalMediaCached(file,'http://127.0.0.1:9876/segredo'),null,'IP local não pode ser consultado');assert.equal(calls.length,0);
 assert.equal(await ensureLocalMediaCached(file,`${publicBase}/${other}/${file}`),null,'Mídia de outra conta não pode ser recuperada');assert.equal(calls.length,0);
 assert.equal(await ensureLocalMediaCached(file,`${publicBase}/${user}/outro.bin`),null,'URL e nome do arquivo devem coincidir');assert.equal(calls.length,0);
 const ok=await ensureLocalMediaCached(file,`${publicBase}/${user}/${file}`);assert.equal(ok,tenantCloudMediaCachePath(file,user));assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');assert.equal(fs.readFileSync(ok,'utf8'),'conteúdo sintético');
 assert.equal(typeof cloud.fetchCloudMediaBuffer,'function');assert.equal(await cloud.fetchCloudMediaBuffer('http://169.254.169.254/segredo'),null,'Encaminhamento não pode atingir metadados internos');assert.equal(calls.length,1);
 assert.equal(await cloud.fetchCloudMediaBuffer(`${publicBase}/${user}/a%2Fb.bin`),null,'Nome com barra codificada é recusado');
 globalThis.fetch=async()=>new Response('x',{status:200,headers:{'content-length':String(35*1024*1024+1)}});
 assert.equal(await cloud.fetchCloudMediaBuffer(`${publicBase}/${user}/grande.bin`),null,'Content-Length acima do limite é recusado');
 let n=0;globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){if(n++<36)controller.enqueue(new Uint8Array(1024*1024));else controller.close()}}));
 assert.equal(await cloud.fetchCloudMediaBuffer(`${publicBase}/${user}/fluxo.bin`),null,'Fluxo sem Content-Length também tem limite');
 globalThis.fetch=async()=>{throw new Error('redirecionamento recusado')};
 assert.equal(await cloud.fetchCloudMediaBuffer(`${publicBase}/${user}/redirecionado.bin`),null);
 console.log('OK: downloads aceitam apenas Storage da própria conta; recusam rede interna, redirecionamento e arquivos excessivos.');
}finally{globalThis.fetch=oldFetch;try{fs.unlinkSync(tenantCloudMediaCachePath(file,user))}catch{}}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=code.indexOf('const trackedCrmCommands = new Set();');
const end=code.indexOf('\nasync function apiBlobDownload',start);
assert(start>=0 && end>start);
async function run(outcomes, input={queued:true,commandId:'cmd'}) {
 const alerts=[],urls=[],delays=[];let i=0,refreshes=0;
 const ctx={showToast:(...args)=>alerts.push(args),api:async url=>{urls.push(url);const v=outcomes[Math.min(i++,outcomes.length-1)];if(v instanceof Error)throw v;return v},refreshLiveStateOnly:async()=>{refreshes++},setTimeout:(f,ms)=>{delays.push(ms);queueMicrotask(f)}};
 vm.createContext(ctx);vm.runInContext(code.slice(start,end)+'\nthis.watch=watchQueuedCrmSend;',ctx);await ctx.watch(input);
 return {alerts,urls,delays,refreshes};
}
let r=await run([{status:'pending'},{status:'processing'},{status:'done',confirmed:true}]);
assert.equal(r.alerts[0][0],'Um envio foi confirmado pelo motor WhatsApp.');assert.equal(r.urls.length,3);assert.equal(r.refreshes,1);assert.deepEqual(r.delays,[3000,6000,9000]);assert(r.urls.every(u=>u==='/api/cloud/commands/cmd/status'));
r=await run([{status:'done',confirmed:false}]);assert.match(r.alerts[0][0],/não confirmou/);assert.equal(r.alerts[0][1],true);
r=await run([{status:'error',error:'dados'}]);assert.match(r.alerts[0][0],/Confira a conversa antes de reenviar/);assert(!r.alerts[0][0].includes('dados'));
r=await run([new Error('rede')]);assert.equal(r.urls.length,21);assert.match(r.alerts[0][0],/não foi possível confirmar/);assert(r.delays.every(ms=>ms<=10000));
r=await run([{status:'done',confirmed:true}],{queued:false,commandId:'cmd'});assert.equal(r.urls.length,0);assert.equal(r.alerts.length,0);
console.log('OK: confirmação, falha ambígua, timeout e backoff sem reenviar.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function renderMotorDownloadStatus()');
const end=source.indexOf('\n// ======================== CENTRAL DE TREINAMENTO',start);
assert(start>=0 && end>start);
function setup(waState, version='5.8.15') {
 const nodes=Object.fromEntries(['dashMotorVersionBadge','sheetMotorVersionHint','btnDashDownloadMotorLabel','dashMotorVersionStatus','btnRemoteUpdateMotor'].map(id=>[id,{textContent:'',innerHTML:'',className:'',disabled:false}]));
 const toasts=[];let result={ok:true,queued:true};let refreshes=0;
 const ctx={window:{},state:{appVersion:version,waState,runtimeMode:'vercel_cloud'},document:{getElementById:id=>nodes[id]},escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),showToast:(...x)=>toasts.push(x),api:async()=>result,refreshLiveStateOnly:async()=>{refreshes++},setTimeout:()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return {ctx,nodes,toasts,setResult:x=>result=x};
}
let x=setup({workerOnline:true,workerVersion:'5.8.15',workerPlatform:'Computador'});x.ctx.renderMotorDownloadStatus();assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/Site.*5\.8\.15/s);assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/Motor.*5\.8\.15/s);assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/atualizado/i);
x=setup({workerOnline:false,workerVersion:null});x.ctx.renderMotorDownloadStatus();assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/offline/i);assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/Site.*5\.8\.15/s);
x=setup({workerOnline:true,workerVersion:null,workerPlatform:'PC'});x.ctx.renderMotorDownloadStatus();assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/não informada|desconhecida/i);assert.doesNotMatch(x.nodes.dashMotorVersionStatus.innerHTML,/nova versão disponível/i);
x=setup({workerOnline:true,workerVersion:'5.8.11',workerPlatform:'PC'});x.ctx.renderMotorDownloadStatus();assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/5\.8\.11/);assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/5\.8\.15/);assert.match(x.nodes.dashMotorVersionStatus.innerHTML,/atualiza/i);
await x.ctx.window.triggerRemoteMotorUpdate();assert.match(x.toasts[0][0],/solicitad|processamento/i);assert.doesNotMatch(x.toasts[0][0],/atualizado remotamente/i);
console.log('OK: status do site e motor, offline, versão desconhecida e confirmação sem falso sucesso.');

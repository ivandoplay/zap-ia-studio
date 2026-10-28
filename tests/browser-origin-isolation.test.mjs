import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import {once} from 'node:events';import WebSocket from 'ws';
import {localStorageInstance as storage} from '../src/storage.js';import {whatsappManager} from '../src/whatsappManager.js';import {cloudWorker} from '../src/supabaseCloud.js';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Execute somente na cópia isolada, sem dados nem sessões reais');
storage.inMemory=true;storage.data.contacts={};storage.data.settings.securityPin='';cloudWorker.getStatus=()=>({configured:false,loggedIn:false});cloudWorker.tryRestoreSavedLogin=async()=>false;cloudWorker.promptTerminalLoginIfInteractive=async()=>{};whatsappManager.autoRestoreIfSessionExists=async()=>{};
let sends=0;const slot=whatsappManager.slots.slot_1;slot.waitUntilConnected=async()=>true;slot.sendManualOwnerMessage=async(chat)=>{sends++;storage.upsertContact(chat,{name:'sintético'},{deferSave:true});};
let server;const originalListen=http.Server.prototype.listen;http.Server.prototype.listen=function(_p,_h,callback){server=this;return originalListen.call(this,0,'127.0.0.1',callback)};await import('../src/server.js');http.Server.prototype.listen=originalListen;if(!server.listening)await once(server,'listening');const p=server.address().port,base=`http://127.0.0.1:${p}`;
const send=(headers)=>fetch(`${base}/api/crm/${encodeURIComponent('111111111111@s.whatsapp.net')}/send`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',connection:'close',...headers},body:'text=teste-sintetico'});
async function wsCheck(origin,expectClosed){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${p}/ws`,{headers:{origin}});const timer=setTimeout(()=>{ws.terminate();reject(Error('websocket sem resposta'))},3000);ws.on('message',()=>{if(!expectClosed){clearTimeout(timer);ws.close();resolve();}else {clearTimeout(timer);ws.close();reject(Error('origem não confiável recebeu evento'));}});ws.on('close',code=>{if(expectClosed){clearTimeout(timer);try{assert.equal(code,4003);resolve()}catch(e){reject(e)}}});ws.on('error',reject);});}
try{
 const hostile=await fetch(`${base}/api/bootstrap`,{headers:{origin:'https://site-de-terceiros.vercel.app',connection:'close'}});assert.equal(hostile.status,403,'origem de outro projeto Vercel não pode ler o motor');
 const form=await send({origin:'https://site-de-terceiros.vercel.app'});assert.equal(form.status,403,'origem não confiável não pode executar ação via formulário');assert.equal(sends,0);
 const form2=await send({origin:'https://site-fora.example'});assert.equal(form2.status,403,'bloqueio deve impedir processamento, não apenas omitir cabeçalho CORS');assert.equal(sends,0);
 const noOrigin=await send({'sec-fetch-site':'cross-site'});assert.equal(noOrigin.status,403);assert.equal(sends,0);
 const own=await send({origin:base});assert.equal(own.status,200);assert.equal(sends,1);
 const direct=await send({});assert.equal(direct.status,200);assert.equal(sends,2);
 const previewStatus=await new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:p,path:'/api/auth/status',headers:{origin:'https://3000-sandbox.e2b.app',host:'3000-sandbox.e2b.app'}},r=>{r.resume();resolve(r.statusCode)});q.on('error',reject);q.end();});assert.equal(previewStatus,200,'prévia na mesma origem permanece funcional');
 await wsCheck('https://outro-projeto.e2b.app',true);await wsCheck(base,false);
 console.log('OK: HTTP e WebSocket restringem origens; ações entre origens, inclusive formulário simples, são bloqueadas.');
}catch(error){console.error(error);process.exitCode=1;}finally{await new Promise(r=>server.close(r));clearInterval(whatsappManager.followUpTimer);}

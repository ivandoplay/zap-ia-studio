import {test} from 'node:test';
import assert from 'node:assert/strict';
const {cloudWorker}=await import('../src/supabaseCloud.js');
test('mutações sucessivas não adiam indefinidamente a primeira sincronização',async()=>{
 const saved={client:cloudWorker.client,user:cloudWorker.user,timer:cloudWorker.syncTimer};
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 let timers=0,cancelados=0;
 try {
  cloudWorker.client={};cloudWorker.user={id:'teste'};cloudWorker.syncTimer=null;
  globalThis.setTimeout=()=>({id:++timers});globalThis.clearTimeout=()=>{cancelados++};
  cloudWorker.scheduleLocalToCloudSync();const primeiro=cloudWorker.syncTimer;
  cloudWorker.scheduleLocalToCloudSync();cloudWorker.scheduleLocalToCloudSync();
  assert.equal(cloudWorker.syncTimer,primeiro,'deve preservar o prazo da primeira mutação');
  assert.equal(timers,1);assert.equal(cancelados,0);
 }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;Object.assign(cloudWorker,{client:saved.client,user:saved.user,syncTimer:saved.timer});}
});

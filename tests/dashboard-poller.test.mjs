import test from 'node:test';import assert from 'node:assert/strict';
import {createSummaryPoller} from '../public/v2/assets/poller.js';
const tick=()=>new Promise(r=>setImmediate(r));
test('não consulta oculto; não sobrepõe requests e descarta resposta após troca de conta',async()=>{
 let visible=false,scope='A',calls=0,resolve,changes=0;const data=[];
 const poll=createSummaryPoller({load:()=>{calls++;return new Promise(r=>resolve=r);},getScope:()=>scope,isVisible:()=>visible,onData:v=>data.push(v),onScopeChanged:()=>changes++,schedule:()=>1,cancel:()=>{}});
 poll.refresh();await tick();assert.equal(calls,0);visible=true;poll.refresh();poll.refresh();await tick();assert.equal(calls,1);
 scope='B';resolve({secret:'A'});await tick();assert.deepEqual(data,[]);assert.equal(changes,1);poll.stop();
});
test('aborta e ignora resposta tardia ao ocultar; erro não vira dados falsos',async()=>{
 let visible=true,signal,resolve;const data=[],errors=[];
 const poll=createSummaryPoller({load:({signal:s})=>{signal=s;return new Promise(r=>resolve=r);},getScope:()=> 'A',isVisible:()=>visible,onData:v=>data.push(v),onError:e=>errors.push(e),schedule:()=>1,cancel:()=>{}});
 poll.refresh();await tick();visible=false;poll.visibilityChanged();assert.equal(signal.aborted,true);resolve({count:900});await tick();assert.deepEqual(data,[]);assert.deepEqual(errors,[]);poll.stop();
});

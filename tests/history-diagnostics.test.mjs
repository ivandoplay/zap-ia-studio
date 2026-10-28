import assert from 'node:assert/strict';
import { cloudWorker } from '../src/supabaseCloud.js';
import { localStorageInstance as store } from '../src/storage.js';
store.inMemory=true;store.data.contacts={
  'demo-a':{messages:[{text:'segredo simulado'}]},
  'slot_2::x@lid':{messages:[{text:'segredo simulado'},{text:'outro'}]},
  'slot_2::y@lid':{messages:[]}
};
let written;
cloudWorker.deviceIdentity={deviceId:'dev-teste'};
cloudWorker.client={rpc:async()=>({data:[{id:'simulado'}],error:null}),from(){return {update(x){written=x;return {eq:async()=>({error:null})}}}}};
cloudWorker.whatsappManager={getSlot(id){return {status:id==='slot_3'?'disconnected':'connected',hasSavedSession:()=>true,hasCompletedHistoryBootstrap:()=>false,sock:{authState:{creds:{processedHistoryMessages:[{},{}]}}}}}};
await cloudWorker.executeCommandRow({id:'simulado',target_device_id:'dev-teste',action:'history_runtime_diagnostics'});
assert.equal(written.status,'done');
assert.equal(written.result.slots[1].contacts,2);
assert.equal(written.result.slots[1].contactsWithMessages,1);
assert.equal(written.result.slots[1].messagesInCache,2);
assert.equal(written.result.slots[0].contacts,1);
assert.equal(JSON.stringify(written).includes('segredo simulado'),false);
console.log('OK: diagnóstico local por chip sem incluir texto das conversas.');

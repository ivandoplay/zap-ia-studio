import assert from 'node:assert/strict';
import {cloudWorker} from '../src/supabaseCloud.js';
let written;cloudWorker.deviceIdentity={deviceId:'teste'};cloudWorker.user={id:'user-a'};
cloudWorker.client={rpc:async()=>({data:[{id:'teste'}],error:null}),from(){return {update(x){written=x;return {eq:async()=>({error:null})}}}}};
cloudWorker.whatsappManager={getSlot(){return {status:'connected',connectedUser:{phone:'5511111111111'},authDir:'/nao-usar'}}};
await cloudWorker.executeCommandRow({id:'teste',target_device_id:'teste',slot_id:'slot_2',action:'wa_backup_slot_auth',payload:{expectedPhone:'5522222222222'}});
assert.equal(written.status,'error');assert.match(written.error_text,/nada foi desconectado/);
console.log('OK: número diferente bloqueia a operação antes do acesso ao cofre.');

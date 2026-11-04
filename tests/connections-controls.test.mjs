import test from 'node:test';import assert from 'node:assert/strict';
import {validateConnectionControl,privatePairing} from '../src/connections/controls.js';
test('controles: chip explícito, cota, identidade e booleanos estritos antes de operar',()=>{
 for(const slotId of [undefined,null,{},['slot_1'],'slot_0','slot_4','SLOT_1'])assert.throws(()=>validateConnectionControl('/wa/connect',{slotId},{maxSlots:3}),{statusCode:400});
 assert.throws(()=>validateConnectionControl('/wa/connect',{slotId:'slot_2'},{maxSlots:1}),{statusCode:403});
 assert.throws(()=>validateConnectionControl('/wa/connect',{slotId:'slot_1'},{support:true,maxSlots:3}),{statusCode:403});
 for(const clearSession of [undefined,null,'false',0])assert.throws(()=>validateConnectionControl('/wa/disconnect',{slotId:'slot_1',clearSession},{maxSlots:1}),{statusCode:400});
 assert.equal(validateConnectionControl('/wa/disconnect',{slotId:'slot_1',clearSession:false},{maxSlots:1}),true);
 assert.throws(()=>validateConnectionControl('/wa/slot-config',{slotId:'slot_1',aiEnabled:'false'},{maxSlots:1}),{statusCode:400});
 assert.equal(validateConnectionControl('/wa/slot-config',{slotId:'slot_1',aiEnabled:false,label:'Loja'},{maxSlots:1}),true);
 assert.throws(()=>validateConnectionControl('/wa/connect',{slotId:'slot_1',pairingPhone:123},{maxSlots:1}),{statusCode:400});
 assert.throws(()=>validateConnectionControl('/wa/connect',{slotId:'slot_1',targetDeviceId:'x'.repeat(129)},{maxSlots:1}),{statusCode:400});
});
test('pareamento privado: expira, distingue QR de código e nunca devolve telefone, segredo ou URL externa',()=>{
 const now=Date.parse('2026-11-03T12:00:00Z'),at=new Date(now).toISOString();
 const valid=privatePairing({status:'qr_ready',qrDataUrl:'data:image/png;base64,YWJj',pairingCode:'ABCD-1234',generatedAt:at,phone:'privado'},now);
 assert.equal(valid.pairingCode,'ABCD1234');assert.equal(valid.qrDataUrl,'data:image/png;base64,YWJj');assert.equal(JSON.stringify(valid).includes('privado'),false);
 for(const changes of [{generatedAt:new Date(now-46000).toISOString()},{generatedAt:new Date(now+6000).toISOString()},{status:'connected'},{status:'unknown'}]){const p=privatePairing({status:'qr_ready',qrDataUrl:'data:image/png;base64,YWJj',pairingCode:'ABCD1234',generatedAt:at,...changes},now);assert.equal(p.qrDataUrl,null);assert.equal(p.pairingCode,null);}
 assert.equal(privatePairing({status:'qr_ready',qrDataUrl:'https://evil.invalid/qr',pairingCode:'2@raw-qr',generatedAt:at},now).qrDataUrl,null);
});

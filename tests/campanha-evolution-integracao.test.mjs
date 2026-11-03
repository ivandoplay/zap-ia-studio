import test from 'node:test';import assert from 'node:assert/strict';import {conectarMotorCampanhas} from '../src/campanhaIntegracaoMotor.js';
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',bid='33333333-3333-4333-8333-333333333333',did='44444444-4444-4444-8444-444444444444',wid='55555555-5555-4555-8555-555555555555';
const bloco={id:bid,tipo:'texto',modo:'fixo',textos:['Olá {{nome}}']},plano={nome:'Misto',chips:['slot_1','slot_2'],modoChips:'rodizio',retomada:'manual',blocos:[bloco]};
function fixture({slots,evoSlots,owner=uid}={}){
 let sent=0,local=0,providerAtReservation='';
 const wa={slots:slots||{},isAnyOwnSlotPhone:()=>false};
 const client={from(t){return {select(){return this},eq(){return this},async maybeSingle(){return {data:t==='ienvia_campanhas_controle'?{owner_id:owner,campanha_id:cid,revisao:1,plano}:{owner_id:owner,campanha_id:cid,revisao:1,destinatario_id:did,telefone:'5586981234567',nome:'Bia',campos:{},ordem:1,etapa:0,bloco_config:bloco},error:null}}}},async rpc(n,a){if(n==='ienvia_reservar_worker_campanha'){providerAtReservation=a.p_material.provedor;return {data:[{campanha_id:cid,destinatario_id:did,etapa:0,tentativa_id:a.p_tentativa,status:'em_envio',material:a.p_material}],error:null}}if(n==='ienvia_confirmar_etapa')return {data:[{campanha_id:cid,destinatario_id:did,etapa:0,tentativa_id:a.p_tentativa,status:'confirmada'}],error:null};if(n==='ienvia_registrar_falha_campanha')return {data:[{owner_id:owner,campanha_id:cid}],error:null};throw Error('RPC inesperada')}};
 const proxyEvolution={async status(){return {ok:true,available:true,slots:evoSlots||{}}},async send(){sent++;return {key:{id:'evo-synthetic'}}}};
 const motor=conectarMotorCampanhas({client,userId:owner,workerId:wid,deviceId:'teste',whatsapp:wa,storage:{isContactIgnored:()=>false},sessaoAtiva:()=>true,maxWaSlots:()=>3,proxyEvolution});
 return {motor,stats:()=>({sent,local,providerAtReservation}),wa};
}
test('campanha escolhe Evolution somente no slot Evolution e persiste o provedor na reserva',async()=>{
 const f=fixture({evoSlots:{slot_1:{status:'connected'}},slots:{slot_2:{slotId:'slot_2',status:'connected',sock:{async sendMessage(){f.local++;return {key:{id:'local'}}}}}}});
 const r=await f.motor.processar(cid);assert.equal(r.status,'confirmada');assert.deepEqual(f.stats(),{sent:1,local:0,providerAtReservation:'evolution_api'});f.motor.parar();
});
test('duas conexões para o mesmo chip pausam sem chamar qualquer provedor',async()=>{
 let pause='';const f=fixture({evoSlots:{slot_1:{status:'connected'}},slots:{slot_1:{slotId:'slot_1',status:'connected',sock:{async sendMessage(){throw Error('não enviar')}}}}});
 const r=await f.motor.processar(cid);assert.deepEqual(r,{status:'erro_reserva',codigo:'chip_provedor_ambiguo'});assert.equal(f.stats().sent,0);f.motor.parar();
});
test('chip indisponível pausa mesmo com outro chip conectado, sem rotação entre números',async()=>{
 const f=fixture({evoSlots:{},slots:{slot_2:{slotId:'slot_2',status:'connected',sock:{async sendMessage(){throw Error('não deve ser chamado')}}}}});
 const r=await f.motor.processar(cid);assert.deepEqual(r,{status:'erro_reserva',codigo:'chip_indisponivel'});assert.equal(f.stats().sent,0);f.motor.parar();
});

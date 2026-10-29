import assert from 'node:assert/strict';
import test from 'node:test';
import {limparHistoricoSlot,mesclarContatoComEpoca,visivelNaCaixa} from '../src/slotHistorico.js';

const antigo='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', atual='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const contato=(slot,historyEpoch=antigo)=>({chatId:slot==='slot_1'?'1@s.whatsapp.net':`${slot}::1@s.whatsapp.net`,slotId:slot,historyEpoch,messages:[{id:'um',text:'Mensagem sintética',timestamp:'2026-01-01T00:00:00Z'}],notes:'Nota CRM',tasks:[{id:'t'}],unreadCount:2});
test('limpar somente o chip escolhido preserva CRM e demais chips',()=>{
 const a=contato('slot_1'),b=contato('slot_2'),c=contato('slot_3');const cards={a,b,c};
 assert.equal(limparHistoricoSlot(cards,'slot_2',atual),1);assert.deepEqual(cards.b.messages,[]);assert.equal(cards.b.historyEpoch,atual);assert.equal(cards.b.disconnectedHidden,true);assert.equal(cards.b.notes,'Nota CRM');assert.equal(cards.b.tasks.length,1);assert.equal(cards.a.messages.length,1);assert.equal(cards.c.messages.length,1);assert(!visivelNaCaixa(cards.b));
});
test('uma cópia local anterior à geração da nuvem não ressuscita mensagens',()=>{
 const remoto={...contato('slot_2',atual),messages:[],disconnectedHidden:true},local=contato('slot_2',antigo);
 assert.deepEqual(mesclarContatoComEpoca(remoto,local,atual).messages,[]);
});
test('um histórico recebido na geração atual volta a aparecer',()=>{
 const remoto={...contato('slot_2',atual),messages:[],disconnectedHidden:true},local={...contato('slot_2',atual),disconnectedHidden:false};
 const mesclado=mesclarContatoComEpoca(remoto,local,atual);assert.equal(mesclado.messages.length,1);assert(visivelNaCaixa(mesclado));
});

test('somente sessão comprovadamente desautorizada autoriza apagar',async()=>{
 const {deveLimparAposDesconexao}=await import('../src/slotHistorico.js');
 assert.equal(deveLimparAposDesconexao({motivo:'logout_confirmado',outroDispositivoAtivo:false}),true);
 assert.equal(deveLimparAposDesconexao({motivo:'desconexao_manual',outroDispositivoAtivo:false}),true);
 assert.equal(deveLimparAposDesconexao({motivo:'qr_novo',outroDispositivoAtivo:false}),true);
 for(const motivo of ['offline','reconectando','erro_rede','conflito','inicio'])assert.equal(deveLimparAposDesconexao({motivo,outroDispositivoAtivo:false}),false,motivo);
 assert.equal(deveLimparAposDesconexao({motivo:'qr_novo',outroDispositivoAtivo:true}),false);
});

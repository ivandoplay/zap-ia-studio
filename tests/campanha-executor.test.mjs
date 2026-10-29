import test from 'node:test';
import assert from 'node:assert/strict';
import { executarPassoCampanha } from '../src/campanhaExecutor.js';

function repositorio(){
 const db={estado:'pendente',tentativa:null,confirmacoes:0,incertezas:0,failConfirma:false,failIncerteza:false};
 return {db,async reservar({tentativaId}){
  if(db.estado!=='pendente')return null;
  db.estado='em_envio';db.tentativa=tentativaId;
  return {tentativaId,campanhaId:'campanha-sintetica',destinatarioId:'contato-sintetico',telefone:'5586981234567',nome:'Teste',etapa:0,slotId:'slot_1',material:{tipo:'texto',texto:'Mensagem sintética'}};
 },async confirmar({tentativaId}){
  if(db.failConfirma)throw Error('banco indisponível');
  if(db.estado!=='em_envio'||tentativaId!==db.tentativa)return false;
  db.estado='confirmada';db.confirmacoes++;return true;
 },async marcarIncerta({tentativaId}){
  if(db.failIncerteza)throw Error('banco indisponível');
  if(db.estado!=='em_envio'||tentativaId!==db.tentativa)return false;
  db.estado='incerta';db.incertezas++;return true;
 }};
}
test('reserva antes de enviar e confirma apenas depois da aceitação do motor',async()=>{
 const repo=repositorio();let chamadas=0;
 const resultado=await executarPassoCampanha({repositorio:repo,campanhaId:'campanha-sintetica',enviar:async acao=>{
  assert.equal(repo.db.estado,'em_envio');assert.equal(acao.material.texto,'Mensagem sintética');chamadas++;
  return {status:'aceita'};
 }});
 assert.equal(resultado.status,'confirmada');assert.equal(chamadas,1);assert.equal(repo.db.estado,'confirmada');
});
test('dois workers concorrentes nunca chamam o envio duas vezes quando a reserva é exclusiva',async()=>{
 const repo=repositorio();let chamadas=0;
 const enviar=async()=>{chamadas++;await new Promise(r=>setTimeout(r,15));return {status:'aceita'};};
 const args={repositorio:repo,campanhaId:'campanha-sintetica',enviar};
 const out=await Promise.all([executarPassoCampanha(args),executarPassoCampanha(args)]);
 assert.equal(chamadas,1);assert.deepEqual(out.map(x=>x.status).sort(),['confirmada','indisponivel']);
});
test('resultado incerto ou erro do motor bloqueia reenvio automático',async()=>{
 for(const enviar of [async()=>{throw Error('tempo esgotado')},async()=>({status:'incerta'}),async()=>({status:'nao_enviada'})]){
  const repo=repositorio();let chamadas=0;const args={repositorio:repo,campanhaId:'campanha-sintetica',enviar:async(...a)=>{chamadas++;return enviar(...a)}};
  assert.equal((await executarPassoCampanha(args)).status,'incerta');
  assert.equal((await executarPassoCampanha(args)).status,'indisponivel');
  assert.equal(repo.db.estado,'incerta');assert.equal(chamadas,1);
 }
});
test('falha ao registrar confirmação ou incerteza nunca libera uma nova tentativa',async()=>{
 for(const qual of ['confirma','incerteza']){
  const repo=repositorio();repo.db.failConfirma=qual==='confirma';repo.db.failIncerteza=qual==='incerteza';let chamadas=0;
  const args={repositorio:repo,campanhaId:'campanha-sintetica',enviar:async()=>{chamadas++;if(qual==='incerteza')throw Error('timeout');return {status:'aceita'}}};
  const r=await executarPassoCampanha(args);assert.equal(r.status,'incerta');assert.equal(repo.db.estado,'em_envio');
  assert.equal((await executarPassoCampanha(args)).status,'indisponivel');assert.equal(chamadas,1);
 }
});
test('reserva que não corresponde ao identificador é barrada antes de enviar',async()=>{
 const repo=repositorio(),original=repo.reservar;repo.reservar=async v=>({...await original(v),tentativaId:'outra'});let chamadas=0;
 const r=await executarPassoCampanha({repositorio:repo,campanhaId:'campanha-sintetica',enviar:async()=>{chamadas++}});
 assert.equal(r.status,'incerta');assert.equal(chamadas,0);
});

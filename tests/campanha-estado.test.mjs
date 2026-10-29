import test from 'node:test';
import assert from 'node:assert/strict';
import { criarEstado, iniciarProximo, confirmarEnvio, recuperarInterrupcao, resolverIncerteza, pausar, retomar, pularPausa } from '../src/campanhaEstado.js';

const config={loteMin:2,loteMax:2,intervaloMinMs:1000,intervaloMaxMs:1000,pausaLoteMinMs:5000,pausaLoteMaxMs:5000};
const criado=()=>criarEstado(['pessoa-1','pessoa-2','pessoa-3'],config,()=>0);

test('lote conta pessoas e pausa depois do número sorteado',()=>{
 let s=criado();s=iniciarProximo(s,0);assert.equal(s.emEnvio,'pessoa-1');s=confirmarEnvio(s,100,()=>0);assert.equal(s.proximaAcaoEm,1100);
 s=iniciarProximo(s,1100);s=confirmarEnvio(s,1200,()=>0);assert.equal(s.pausaTipo,'lote');assert.equal(s.proximaAcaoEm,6200);assert.equal(s.enviados,2);
 assert.throws(()=>iniciarProximo(s,6199),/aguard/i);s=iniciarProximo(s,6200);s=confirmarEnvio(s,6300,()=>0);assert.equal(s.status,'concluida');
});

test('interrupção durante envio gera incerteza e nunca reenvia automaticamente',()=>{
 let s=iniciarProximo(criado(),0);s=recuperarInterrupcao(s);assert.equal(s.status,'incerta');assert.throws(()=>retomar(s),/incert/i);assert.throws(()=>iniciarProximo(s,100000),/incert/i);
 const confirmada=resolverIncerteza(s,'confirmada',100,()=>0);assert.equal(confirmada.enviados,1);assert.equal(confirmada.emEnvio,null);
 const naoEnviada=resolverIncerteza(s,'nao-enviada',100,()=>0);assert.equal(naoEnviada.status,'pausada');assert.equal(naoEnviada.pendentes[0],'pessoa-1');
});

test('pausa e retomada preservam prazo e pular pausa exige espera ativa',()=>{
 let s=confirmarEnvio(iniciarProximo(criado(),0),100,()=>0);s=pausar(s);assert.throws(()=>iniciarProximo(s,1100),/pausad/i);s=retomar(s);assert.throws(()=>iniciarProximo(s,1099),/aguard/i);s=pularPausa(s,200);assert.equal(s.proximaAcaoEm,200);s=iniciarProximo(s,200);assert.throws(()=>pularPausa(s,200),/pausa/i);
});

test('estado imutável, duplicados e parâmetros inválidos não são aceitos',()=>{
 const original=criado();const novo=iniciarProximo(original,0);assert.equal(original.emEnvio,null);assert.notEqual(original,novo);
 assert.throws(()=>criarEstado(['a','a'],config),/duplic/i);
 assert.throws(()=>criarEstado(['a'],{...config,loteMin:0}),/lote/i);
 assert.throws(()=>criarEstado(['a'],{...config,intervaloMinMs:3000,intervaloMaxMs:1000}),/interval/i);
});

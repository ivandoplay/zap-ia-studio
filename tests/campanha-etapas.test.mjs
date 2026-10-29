import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSequencia, iniciarEtapa, confirmarEtapa, interromperSequencia, resolverEtapaIncerta, pausarSequencia, retomarSequencia } from '../src/campanhaEtapas.js';

test('interrupção em áudio nunca reenvia o texto confirmado', () => {
 let s=criarSequencia(['texto','audio','imagem']);
 s=iniciarEtapa(s,{texto:'Olá'});s=confirmarEtapa(s);
 s=iniciarEtapa(s,{arquivo:'audio-3'});s=interromperSequencia(s);
 assert.equal(s.status,'incerta');assert.equal(s.indice,1);assert.deepEqual(s.concluidas,['texto']);
 assert.throws(()=>iniciarEtapa(s,{arquivo:'audio-4'}),/incert/i);
 s=resolverEtapaIncerta(s,'nao-enviada');assert.equal(s.status,'pausada');s=retomarSequencia(s);
 s=iniciarEtapa(s);assert.deepEqual(s.emEnvio.material,{arquivo:'audio-3'});
 s=confirmarEtapa(s);assert.deepEqual(s.concluidas,['texto','audio']);
 s=iniciarEtapa(s,{arquivo:'imagem-2'});s=confirmarEtapa(s);assert.equal(s.status,'concluida');
});

test('confirmação de etapa incerta exige retomada manual e conserva progresso',()=>{
 let s=iniciarEtapa(criarSequencia(['texto','audio']),{texto:'Oi'});
 s=interromperSequencia(s);s=resolverEtapaIncerta(s,'confirmada');
 assert.equal(s.status,'pausada');assert.equal(s.indice,1);assert.deepEqual(s.concluidas,['texto']);
 assert.throws(()=>iniciarEtapa(s,{arquivo:'a'}),/pausad/i);
 s=retomarSequencia(s);s=iniciarEtapa(s,{arquivo:'a'});s=confirmarEtapa(s);assert.equal(s.status,'concluida');
});

test('pausa solicitada durante o envio entra em vigor após confirmação',()=>{
 let s=iniciarEtapa(criarSequencia(['texto','audio']),{texto:'Oi'});s=pausarSequencia(s);assert.equal(s.status,'em_envio');
 s=confirmarEtapa(s);assert.equal(s.status,'pausada');assert.equal(s.indice,1);
});

test('listas inválidas, opções inválidas e alterações do material escolhido são rejeitadas',()=>{
 assert.throws(()=>criarSequencia([]),/etapas/i);assert.throws(()=>criarSequencia(['a','a']),/duplic/i);
 let material={arquivo:'voz-1'};let s=iniciarEtapa(criarSequencia(['audio']),material);material.arquivo='modificado';assert.equal(s.emEnvio.material.arquivo,'voz-1');
 s=resolverEtapaIncerta(interromperSequencia(s),'nao-enviada');s=retomarSequencia(s);
 assert.throws(()=>iniciarEtapa(s,{arquivo:'voz-2'}),/material/i);
});

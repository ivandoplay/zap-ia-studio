import test from 'node:test';
import assert from 'node:assert/strict';
import { expandirMensagem, escolherItem, sortearInteiro } from '../src/campanhaVariacoes.js';

test('Spintax, campos e variações aninhadas não interpretam conteúdo dos contatos', () => {
  assert.equal(expandirMensagem('{Olá|Oi}, {{nome}}! {Tudo {bem|ótimo}?|Como vai?}', {nome:'Ana {não|alterar}'}, () => 0), 'Olá, Ana {não|alterar}! Tudo bem?');
  assert.equal(expandirMensagem('{Olá|Oi} {{nome}}', {nome:'Jefferson'}, () => 0.999), 'Oi Jefferson');
});

test('Spintax inválido é rejeitado antes do envio, sem estourar pilha', () => {
  for (const s of ['{oi}', '{oi|}', '{|oi}', '{oi|olá', 'oi}', '{{nome}', '{{}}', '{a|{b|c}']) {
    assert.throws(() => expandirMensagem(s, {nome:'Ana'}), /inválid|limite/i, s);
  }
  assert.throws(() => expandirMensagem('{a|'.repeat(40)+'b'+'}'.repeat(40)), /limite/i);
});

test('campos ausentes são identificados e não substituídos silenciosamente', () => {
  assert.throws(() => expandirMensagem('Oi {{nome}}', {}), /nome/i);
  assert.equal(expandirMensagem('Oi {{Nome}}', {nome: 'Davi'}), 'Oi Davi');
});

test('alternância sequencial e sorteio preservam índices válidos', () => {
  assert.deepEqual(escolherItem(['a','b','c'], 'sequencial', 4), {item:'b', indice:1});
  assert.deepEqual(escolherItem(['a','b','c'], 'aleatorio', 0, () => 0.999), {item:'c', indice:2});
  assert.throws(() => escolherItem([], 'aleatorio', 0), /vazi/i);
  assert.throws(() => escolherItem(['a'], 'invalido', 0), /modo/i);
});

test('sorteio inclusivo de lote e intervalo valida os limites', () => {
  assert.equal(sortearInteiro(8,12,() => 0),8);
  assert.equal(sortearInteiro(8,12,() => 0.99999),12);
  assert.throws(() => sortearInteiro(12,8), /limite/i);
  assert.throws(() => sortearInteiro(-1,8), /limite/i);
  assert.throws(() => sortearInteiro(1,5,() => 1), /aleatóri/i);
});

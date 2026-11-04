import test from 'node:test';
import assert from 'node:assert/strict';
import { getNavigation, findPages } from '../public/assets/navigation.js';

test('titular encontra Conexões em uma página própria e não vê Contas master', () => {
  const pages = getNavigation('titular').flatMap(group => group.items);
  assert.equal(pages.find(page => page.id === 'conexoes')?.href, '/conexoes/');
  assert.equal(pages.some(page => page.id === 'contas'), false);
  assert.equal(pages.find(page => page.id === 'dashboard')?.label, 'Visão geral');
});

test('perfil master de demonstração encontra a área de contas', () => {
  const result = findPages('contas', 'master');
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'Contas');
  assert.equal(findPages('contas', 'titular').length, 0);
});

test('busca de navegação ignora caixa, acentos e espaços extras', () => {
  assert.deepEqual(findPages('  CONEXOES  ', 'titular').map(page => page.id), ['conexoes']);
  assert.deepEqual(findPages('assunto inexistente', 'titular'), []);
});

test('papel desconhecido não recebe navegação privilegiada', () => {
  assert.deepEqual(getNavigation('papel-invalido'), []);
});

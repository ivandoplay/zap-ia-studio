import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyTags, migrateLegacyContacts } from '../scripts/migrate-crm-tags-legacy.mjs';

test('CRM migração tags: converte nomes, cores e ids válidos do painel antigo', () => {
  const data = { business: { customTags: [
    { id: 'tag_quente', name: 'Quente', color: '#ef4444' },
    { id: 'tag_orcamento', name: 'Orçamento', color: '#f59e0b' },
    { name: 'VIP', color: '#8b5cf6' },
    { name: '', color: '#ffffff' },
    { name: 'Muito longa...'.repeat(10), color: 'vermelho' },
  ] } };
  const m = migrateLegacyTags(data);
  assert.equal(m.format, 'ienvia-tag-migration-v1');
  assert.equal(m.total, 4);
  const names = m.items.map(i => i.name);
  assert.ok(names.includes('Quente'));
  assert.ok(names.includes('VIP'));
  assert.equal(m.items.find(i => i.name === 'Quente').color, '#ef4444');
  const longa = m.items.find(i => i.name.startsWith('Muito longa...'));
  assert.ok(longa);
  assert.equal(longa.name.length, 32);
  assert.ok(longa.id);
  assert.ok(m.warnings.length >= 1);
});

test('CRM migração tags: não cria duplicados por nome (case-insensitive)', () => {
  const data = { business: { customTags: [
    { name: 'Quente', color: '#ef4444' },
    { name: 'quente', color: '#ffffff' },
  ] } };
  const m = migrateLegacyTags(data);
  assert.equal(m.total, 1);
  assert.equal(m.warnings.length, 1);
});

test('CRM migração contatos: extrai identificação, tags e metadados', () => {
  const data = {
    contacts: {
      '5511999999999': { id: 'c1', name: 'João', phone: '5511999999999', stage: 'qualificando', dealValue: 1500, tags: ['Quente', 'VIP'], saved: true, unread: 2 },
      '5511888888888': { name: 'Maria', phone: '5511888888888', tags: [] },
    },
  };
  const m = migrateLegacyContacts(data);
  assert.equal(m.total, 2);
  const joao = m.contacts.find(c => c.name === 'João');
  assert.ok(joao);
  assert.equal(joao.stage, 'qualificando');
  assert.equal(joao.dealValue, 1500);
  assert.deepEqual(joao.tags, ['Quente', 'VIP']);
  assert.equal(joao.saved, true);
  assert.equal(joao.unread, 2);
  assert.equal(joao.source, 'legado');
  assert.ok(joao.migratedAt);
});

test('CRM migração contatos: ignora entradas sem identificação', () => {
  const data = { contacts: { 'x': { name: '', phone: '' } } };
  const m = migrateLegacyContacts(data);
  assert.equal(m.total, 0);
  assert.equal(m.warnings.length, 1);
});

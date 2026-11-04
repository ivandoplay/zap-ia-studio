import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppearance, saveAppearance, resolveAppearanceSubject } from '../public/assets/appearance-preferences.js';

test('primeiro acesso sem preferência usa escuro', () => {
  assert.equal(readAppearance(null, 'viewer-a'), 'dark');
});

function memoryStorage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key,value) => items.set(key,value) }; }
test('usuário escolhe claro sem mudar a preferência de outro usuário', () => {
  const storage=memoryStorage(); assert.equal(saveAppearance(storage,'viewer-a','light'),true);
  assert.equal(readAppearance(storage,'viewer-a'),'light'); assert.equal(readAppearance(storage,'viewer-b'),'dark');
  saveAppearance(storage,'viewer-b','dark'); assert.equal(readAppearance(storage,'viewer-a'),'light');
});
test('é possível voltar ao escuro e reabrir com a preferência preservada', () => {
  const storage=memoryStorage(); saveAppearance(storage,'viewer-a','light'); saveAppearance(storage,'viewer-a','dark');
  assert.equal(readAppearance(storage,'viewer-a'),'dark');
});
test('valor armazenado inválido não vira atributo de tema nem conteúdo HTML', () => {
  const storage={getItem:()=>'<img src=x onerror=alert(1)>'}; assert.equal(readAppearance(storage,'viewer-a'),'dark');
});
test('armazenamento bloqueado não impede leitura padrão ou mudança na aba', () => {
  const storage={getItem(){throw new Error('SecurityError');},setItem(){throw new Error('QuotaExceededError');}};
  assert.equal(readAppearance(storage,'viewer-a'),'dark'); assert.equal(saveAppearance(storage,'viewer-a','light'),false);
});
test('sem identidade válida não lê nem grava a preferência de outro sujeito', () => {
  const storage={getItem(){throw new Error('não deveria acessar');},setItem(){throw new Error('não deveria acessar');}};
  for(const id of [null,undefined,'','../viewer-a','a b',12]) { assert.equal(readAppearance(storage,id),'dark'); assert.equal(saveAppearance(storage,id,'light'),false); }
});
test('tema desconhecido não sobrescreve a última preferência válida', () => {
  const storage=memoryStorage(); saveAppearance(storage,'viewer-a','light');
  assert.equal(saveAppearance(storage,'viewer-a','system'),false); assert.equal(readAppearance(storage,'viewer-a'),'light');
});
test('suporte mantém aparência do operador, não do cliente acessado', () => {
  assert.equal(resolveAppearanceSubject({id:'customer-a',impersonating:true,impersonatedBy:{id:'operator-a'}}),'operator-a');
  assert.equal(resolveAppearanceSubject({id:'customer-a',impersonating:true}),null);
  assert.equal(resolveAppearanceSubject({id:'viewer-a',impersonating:false}),'viewer-a');
  assert.equal(resolveAppearanceSubject(null),null);
});
test('preferência global do legado não é atribuída indevidamente ao usuário novo', () => {
  const storage=memoryStorage(); storage.setItem('zapia_theme','light');
  assert.equal(readAppearance(storage,'viewer-new'),'dark'); assert.equal(storage.getItem('zapia_theme'),'light');
});

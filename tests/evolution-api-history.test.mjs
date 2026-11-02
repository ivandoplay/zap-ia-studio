import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage } from '../src/storage.js';
import { mergeEvolutionApiHistoryPage } from '../src/evolutionApiHistory.js';
import { normalizeEvolutionApiHistoryRecords } from '../src/evolutionApiCloud.js';

const jid = '5586999998888@s.whatsapp.net';
const firstPage = {
  messages: {
    total: 3, pages: 2, currentPage: 1,
    records: [
      { id: 'm-2', key: { id: 'm-2', remoteJid: jid, fromMe: true }, message: { extendedTextMessage: { text: 'Resposta do atendente' } }, messageTimestamp: 1700000002, pushName: 'Cliente' },
      { id: 'm-1', key: { id: 'm-1', remoteJid: jid, fromMe: false }, message: { conversation: 'Olá, preciso de ajuda' }, messageTimestamp: 1700000001, pushName: 'Ana' },
      { id: 'm-media', key: { id: 'm-media', remoteJid: jid, fromMe: false }, message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Foto do produto' } }, messageTimestamp: 1700000003, pushName: 'Ana' },
    ]
  }
};

test('Evolution API v2.3.7 history rows normalize into chronological CRM messages and media placeholders', () => {
  const normalized = normalizeEvolutionApiHistoryRecords(firstPage, `slot_2::${jid}`);
  assert.deepEqual(normalized.map((m) => m.waMsgId), ['m-2', 'm-1', 'm-media']);
  assert.equal(normalized[0].role, 'owner');
  assert.equal(normalized[0].text, 'Resposta do atendente');
  assert.equal(normalized[1].role, 'user');
  assert.equal(normalized[1].contactName, 'Ana');
  assert.equal(normalized[1].timestamp, '2023-11-14T22:13:21.000Z');
  assert.equal(normalized[2].text, 'Foto do produto');
  assert.equal(normalized[2].mediaMime, 'image/jpeg');
  assert.equal(normalized[2].historyMediaUnavailable, true);
});

test('history pages persist in CRM, deduplicate by WhatsApp ID, remain chronological and do not increment unread', () => {
  const storage = new Storage({ inMemory: true, initialData: { contacts: {} } });
  const imported = mergeEvolutionApiHistoryPage(storage, `slot_2::${jid}`, firstPage, { page: 1, pageSize: 2 });
  assert.equal(imported.countAdded, 3);
  assert.equal(imported.hasMore, true);
  assert.equal(imported.nextPage, 2);
  assert.equal(imported.contact.unreadCount, 0);
  assert.deepEqual(imported.contact.messages.map((m) => m.waMsgId), ['m-1', 'm-2', 'm-media']);

  const repeated = mergeEvolutionApiHistoryPage(storage, `slot_2::${jid}`, firstPage, { page: 1, pageSize: 2 });
  assert.equal(repeated.countAdded, 0, 'repetir a mesma página não duplica mensagens');
  assert.equal(repeated.contact.messages.length, 3);

  const second = mergeEvolutionApiHistoryPage(storage, `slot_2::${jid}`, {
    messages: { total: 3, pages: 2, currentPage: 2, records: [
      { id: 'm-0', key: { id: 'm-0', remoteJid: jid, fromMe: false }, message: { conversation: 'Mensagem antiga' }, messageTimestamp: 1699999999 }
    ] }
  }, { page: 2, pageSize: 2 });
  assert.equal(second.countAdded, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.contact.evolutionApiHistoryComplete, true);
  assert.deepEqual(second.contact.messages.map((m) => m.waMsgId), ['m-0', 'm-1', 'm-2', 'm-media']);
  assert.equal(second.contact.unreadCount, 0);
});

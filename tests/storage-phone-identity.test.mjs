import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage, phonesMatch } from '../src/storage.js';
import { flushTenantStoreToCloud } from '../src/supabaseCloud.js';

const olderJid = '558612345678@s.whatsapp.net';
const mobileJid = '5586912345678@s.whatsapp.net';

function contact(chatId, patch = {}) {
  return {
    chatId,
    slotId: 'slot_1',
    phone: '',
    name: '+558612345678',
    messages: [],
    tags: [],
    tasks: [],
    scheduledMessages: [],
    ...patch
  };
}

function fakeCloudClient(calls) {
  return {
    from(table) {
      return {
        delete() {
          return {
            eq(_column, userId) {
              return {
                in(_key, ids) {
                  calls.push({ kind: 'delete', table, userId, ids });
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        },
        select() {
          return {
            eq() {
              return {
                in() {
                  return Promise.resolve({ data: [], error: null });
                }
              };
            }
          };
        },
        upsert(rows) {
          calls.push({ kind: 'upsert', table, rows });
          return Promise.resolve({ error: null });
        }
      };
    }
  };
}

test('nono dígito brasileiro só unifica quando o telefone canônico é exatamente igual', () => {
  assert.equal(phonesMatch('558612345678', '5586912345678'), true);
  assert.equal(phonesMatch('8612345678', '558612345678'), true, 'DDI opcional deve ser tolerado');
  assert.equal(phonesMatch('5586912345678', '5586812345678'), false, 'não usar apenas DDD + últimos oito dígitos');
});

test('rótulos de autoidentidade não substituem o nome ou telefone de um contato', () => {
  const lid = '203869363691598@lid';
  const phone = '5588999991111';
  const storage = new Storage({ inMemory: true, initialData: { contacts: {
    [lid]: contact(lid, { name: 'Você', phone: '187359475818564' })
  } } });
  assert.equal(storage.isGenericContactName('Você'), true);
  const updated = storage.upsertContact(lid, { phone }, { deferSave: true });
  assert.equal(updated.phone, phone);
  assert.equal(updated.name, `+${phone}`);
});

test('contatos legados duplicados são consolidados preservando ambos os históricos e a ficha salva', () => {
  const storage = new Storage({ inMemory: true, initialData: { contacts: {
    [olderJid]: contact(olderJid, {
      name: '+558612345678',
      messages: [{ id: 'old-msg', waMsgId: 'old-msg', role: 'user', text: 'Histórico antigo', timestamp: '2025-01-01T00:00:00.000Z' }]
    }),
    [mobileJid]: contact(mobileJid, {
      phone: '5586912345678',
      name: 'Nome salvo',
      savedContact: true,
      company: 'Empresa',
      messages: [{ id: 'new-msg', waMsgId: 'new-msg', role: 'owner', text: 'Histórico recente', timestamp: '2025-02-01T00:00:00.000Z' }]
    })
  } } });

  const records = Object.values(storage.data.contacts);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'Nome salvo');
  assert.equal(records[0].savedContact, true);
  assert.equal(records[0].company, 'Empresa');
  assert.deepEqual(records[0].messages.map((m) => m.waMsgId), ['old-msg', 'new-msg']);
  assert.ok(storage.deletedContactIds.has(mobileJid), 'o JID redundante deve ser removido da nuvem');
  assert.ok(storage.dirtyContactIds.has(olderJid), 'a ficha mesclada deve ser gravada com histórico agregado');
  assert.equal(storage.initialContactKeys.size, 2, 'comparação de flush deve usar os dois IDs de origem');
});

test('flush da nuvem remove o JID redundante e grava a ficha com histórico agregado', async () => {
  const storage = new Storage({ inMemory: true, userId: 'user-1', initialData: { contacts: {
    [olderJid]: contact(olderJid, {
      messages: [{ id: 'old-msg', waMsgId: 'old-msg', role: 'user', text: 'Histórico antigo', timestamp: '2025-01-01T00:00:00.000Z' }]
    }),
    [mobileJid]: contact(mobileJid, {
      phone: '5586912345678', name: 'Nome salvo', savedContact: true,
      messages: [{ id: 'new-msg', waMsgId: 'new-msg', role: 'owner', text: 'Histórico recente', timestamp: '2025-02-01T00:00:00.000Z' }]
    })
  } } });
  const calls = [];
  await flushTenantStoreToCloud(fakeCloudClient(calls), 'user-1', storage);
  const deletion = calls.find((call) => call.kind === 'delete');
  const update = calls.find((call) => call.kind === 'upsert');
  assert.deepEqual(deletion.ids, [mobileJid]);
  assert.equal(update.rows.length, 1);
  assert.equal(update.rows[0].chat_id, olderJid);
  assert.deepEqual(update.rows[0].data.messages.map((m) => m.waMsgId), ['old-msg', 'new-msg']);
  assert.equal(storage.initialContactKeys.size, 1);
});

test('fichas de chips diferentes nunca são consolidadas por telefone', () => {
  const storage = new Storage({ inMemory: true, initialData: { contacts: {
    [olderJid]: contact(olderJid),
    [`slot_2::${mobileJid}`]: contact(`slot_2::${mobileJid}`, { slotId: 'slot_2', phone: '5586912345678' })
  } } });
  assert.equal(Object.keys(storage.data.contacts).length, 2);
  assert.ok(storage.data.contacts[olderJid]);
  assert.ok(storage.data.contacts[`slot_2::${mobileJid}`]);
});

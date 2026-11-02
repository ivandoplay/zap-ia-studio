import test from 'node:test';
import assert from 'node:assert/strict';
import { runReadOnlyEvolutionDiagnostics } from '../src/crmV2/readOnlyEvolutionDiagnostics.js';

const repeated = (count, factory) => Array.from({ length: count }, (_, index) => factory(index));

test('diagnóstico agrega contatos/conversas, testa offsets e nunca devolve payloads pessoais', async () => {
  const pageCalls = [];
  const result = await runReadOnlyEvolutionDiagnostics({
    slots: ['slot_1', 'slot_2'],
    readConnection: async () => ({ ok: true, instanceFound: true, state: 'open' }),
    readContactsPage: async (slot, { take, skip }) => {
      pageCalls.push(['contacts', slot, take, skip]);
      const rows = skip === 0 && slot === 'slot_1'
        ? repeated(take, (i) => ({ remoteJid: `${i}@s.whatsapp.net`, pushName: `PERSONAL_NAME_${i}`, profilePictureUrl: `https://private/${i}` }))
        : [{ remoteJid: 'same-jid@s.whatsapp.net', pushName: 'PRIVATE_NAME' }];
      return { ok: true, data: rows };
    },
    readChatsPage: async (slot, { take, skip }) => {
      pageCalls.push(['chats', slot, take, skip]);
      const rows = skip === 0 && slot === 'slot_1'
        ? repeated(take, (i) => ({ remoteJid: `${i}@s.whatsapp.net`, pushName: `CHAT_NAME_${i}` }))
        : [{ remoteJid: 'same-jid@s.whatsapp.net', name: 'PRIVATE_CHAT_NAME' }];
      return { ok: true, data: rows };
    },
    readMessageSample: async (slot, jid, { take, skip }) => {
      if (slot === 'slot_1') assert.equal(jid, '0@s.whatsapp.net');
      assert.equal(take, 10);
      assert.equal(skip, 0);
      return { ok: true, data: { messages: { records: [{ key: { id: 'PRIVATE_MESSAGE_ID', fromMe: false }, messageTimestamp: 1730000000, message: { conversation: 'PRIVATE_MESSAGE_BODY' } }] } } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.slots.length, 2);
  assert.equal(result.slots[0].contacts.recordsRead, 1001);
  assert.equal(result.slots[0].contacts.complete, true);
  assert.equal(result.slots[0].chats.recordsRead, 201);
  assert.equal(result.slots[0].historySample.sampleSize, 1);
  assert.ok(pageCalls.some(([, slot, , skip]) => slot === 'slot_1' && skip === 1000));
  assert.ok(pageCalls.some(([, slot, , skip]) => slot === 'slot_1' && skip === 200));
  const serialized = JSON.stringify(result);
  for (const forbidden of ['PERSONAL_NAME_', 'PRIVATE_NAME', 'PRIVATE_CHAT_NAME', 'PRIVATE_MESSAGE_ID', 'PRIVATE_MESSAGE_BODY', 'https://private/']) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic response must omit ${forbidden}`);
  }
});

test('diagnóstico classifica falha de endpoint e mantém resposta redigida', async () => {
  const result = await runReadOnlyEvolutionDiagnostics({
    slots: ['slot_1'],
    readConnection: async () => ({ ok: true, instanceFound: true, state: 'open' }),
    readContactsPage: async () => ({ ok: false, errorCategory: 'endpoint_not_found', statusCode: 404, message: 'must not leak' }),
    readChatsPage: async () => ({ ok: true, data: [] }),
    readMessageSample: async () => ({ ok: true, data: { messages: { records: [] } } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.slots[0].contacts.errorCategory, 'endpoint_not_found');
  assert.equal(result.slots[0].contacts.statusCode, 404);
  assert.equal(JSON.stringify(result).includes('must not leak'), false);
});

test('conexão offline não dispara consultas de contatos, chats ou histórico', async () => {
  let reads = 0;
  const result = await runReadOnlyEvolutionDiagnostics({
    slots: ['slot_3'],
    readConnection: async () => ({ ok: true, instanceFound: true, state: 'close' }),
    readContactsPage: async () => { reads += 1; return { ok: true, data: [] }; },
    readChatsPage: async () => { reads += 1; return { ok: true, data: [] }; },
    readMessageSample: async () => { reads += 1; return { ok: true, data: { messages: { records: [] } } }; },
  });
  assert.equal(reads, 0);
  assert.equal(result.slots[0].connection, 'disconnected');
  assert.equal(result.slots[0].contacts.errorCategory, 'instance_not_connected');
});

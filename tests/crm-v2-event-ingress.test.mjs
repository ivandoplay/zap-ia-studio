import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvolutionEvent } from '../src/crmV2/evolutionEvent.js';
import { ingestEvolutionWebhook } from '../src/crmV2/eventIngress.js';

const sample = {
  event: 'messages.upsert',
  instance: 'zap-ia-slot_1',
  data: {
    key: { remoteJid: '5586981638438@s.whatsapp.net', id: 'msg-01', fromMe: false },
    pushName: 'Pessoa de teste',
    message: { conversation: 'Oi' },
    messageTimestamp: 1793625400,
  },
};

test('normaliza mensagens em formato Evolution sem perder identidade, direção ou evento', () => {
  const [event] = normalizeEvolutionEvent(sample);
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.instanceName, 'zap-ia-slot_1');
  assert.equal(event.eventName, 'MESSAGES_UPSERT');
  assert.equal(event.kind, 'message.upsert');
  assert.equal(event.chatId, '5586981638438@s.whatsapp.net');
  assert.equal(event.messageId, 'msg-01');
  assert.equal(event.fromMe, false);
  assert.equal(event.message.conversation, 'Oi');
  assert.equal(event.timestamp, new Date(1793625400 * 1000).toISOString());
  assert.match(event.dedupeKey, /^[a-f0-9]{64}$/);
});

test('chaves idempotentes não dependem da ordem de propriedades nem do timestamp reemitido', () => {
  const [first] = normalizeEvolutionEvent(sample);
  const secondPayload = structuredClone(sample);
  secondPayload.data = {
    messageTimestamp: 1793625401,
    message: { conversation: 'Oi' },
    pushName: 'Pessoa de teste',
    key: { fromMe: false, id: 'msg-01', remoteJid: '5586981638438@s.whatsapp.net' },
  };
  const [second] = normalizeEvolutionEvent(secondPayload);
  assert.equal(first.dedupeKey, second.dedupeKey);
});

test('expande histórico por conversa e preserva o JID associado a cada mensagem', () => {
  const events = normalizeEvolutionEvent({
    event: 'history_sync', instance: 'zap-ia-slot_1',
    data: { conversations: [{ id: '5511999990001@s.whatsapp.net', messages: [{ key: { id: 'old-1' }, message: { conversation: 'Anterior' } }] }] },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'message.snapshot');
  assert.equal(events[0].chatId, '5511999990001@s.whatsapp.net');
  assert.equal(events[0].messageId, 'old-1');
});

test('atualizações de recibo da mesma mensagem usam chaves distintas por status', () => {
  const delivered = normalizeEvolutionEvent({
    event: 'messages.update', instance: 'zap-ia-slot_1',
    data: { key: { remoteJid: '5586981638438@s.whatsapp.net', id: 'msg-01' }, update: { status: 'DELIVERED' } },
  })[0];
  const read = normalizeEvolutionEvent({
    event: 'MESSAGES_UPDATE', instance: 'zap-ia-slot_1',
    data: { key: { remoteJid: '5586981638438@s.whatsapp.net', id: 'msg-01' }, update: { status: 'READ' } },
  })[0];
  assert.equal(delivered.kind, 'message.update');
  assert.notEqual(delivered.dedupeKey, read.dedupeKey);
});

test('lotes de mensagens produzem eventos independentes', () => {
  const events = normalizeEvolutionEvent({
    event: 'MESSAGES_UPSERT', instance: 'zap-ia-slot_2',
    data: [
      { key: { remoteJid: '5511999990001@s.whatsapp.net', id: 'a' }, message: { conversation: 'A' } },
      { key: { remoteJid: '5511999990002@s.whatsapp.net', id: 'b' }, message: { conversation: 'B' } },
    ],
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.messageId), ['a', 'b']);
  assert.notEqual(events[0].dedupeKey, events[1].dedupeKey);
});

test('webhook grava evento e outbox antes de confirmar; repetição é idempotente', async () => {
  const saved = new Map();
  const repository = {
    async persistEventAndOutbox(tenantId, event) {
      const key = `${tenantId}:${event.dedupeKey}`;
      if (saved.has(key)) return { inserted: false, eventId: saved.get(key) };
      saved.set(key, `event-${saved.size + 1}`);
      return { inserted: true, eventId: saved.get(key), outboxId: `outbox-${saved.size}` };
    },
  };
  const options = { resolveTenant: async (name) => name === 'zap-ia-slot_1' ? 'tenant-test' : null, repository };
  assert.deepEqual(await ingestEvolutionWebhook(sample, options), { ok: true, accepted: 1, inserted: 1, duplicates: 0 });
  assert.deepEqual(await ingestEvolutionWebhook(sample, options), { ok: true, accepted: 1, inserted: 0, duplicates: 1 });
  assert.equal(saved.size, 1);
});

test('instância sem mapeamento é rejeitada antes de qualquer persistência', async () => {
  let writes = 0;
  await assert.rejects(
    ingestEvolutionWebhook(sample, {
      resolveTenant: async () => null,
      repository: { persistEventAndOutbox: async () => { writes += 1; } },
    }),
    (error) => error.code === 'UNKNOWN_INSTANCE',
  );
  assert.equal(writes, 0);
});

test('falha de persistência impede ACK de sucesso', async () => {
  await assert.rejects(
    ingestEvolutionWebhook(sample, {
      resolveTenant: async () => 'tenant-test',
      repository: { persistEventAndOutbox: async () => { throw new Error('db unavailable'); } },
    }),
    /db unavailable/,
  );
});

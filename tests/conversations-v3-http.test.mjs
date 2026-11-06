// Conversas reais na navegação nova (/api/conversations-v3).
// Cobrem o contrato que a caixa de entrada consome: instâncias, threads e mensagens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationsV3Router, instanceIdFor, slotFromInstance, splitChatId, maskPhone} from '../src/crm/conversationsV3.js';

const OWNER = '28f17e53-1ab8-4ec7-8556-666df0d4add6';

function fixture() {
  return {
    mode: 'local_worker',
    viewer: { id: OWNER, role: 'master', displayName: 'Jefferson Ivan' },
    tenant: { id: OWNER, displayName: 'Jefferson Ivan' },
    permissions: { master: true },
    runtime: { slots: { slot_1: { label: 'Chip 1', status: 'connected', aiEnabled: true } } },
    data: {
      business: { name: 'Ienvia' },
      contacts: {
        '5511999990001@s.whatsapp.net': {
          name: 'Ana Souza', slotId: 'slot_1', stage: 'em_atendimento', tags: ['Cliente'],
          unreadCount: 2, lastMessageAt: '2026-11-04T12:00:00.000Z', company: 'Autocon', city: 'Fortaleza',
          dealStatus: 'hot', dealValue: 25000,
          messages: [
            { id: 'm1', role: 'user', text: 'Bom dia, tenho interesse no carro', timestamp: '2026-11-04T11:59:00.000Z', waMessageType: 'text' },
            { id: 'm2', role: 'owner', text: 'Bom dia! Qual modelo?', timestamp: '2026-11-04T12:00:00.000Z', ack: 2 }
          ]
        },
        '8827364615@lid': {
          name: '', slotId: 'slot_1', unreadCount: 0,
          lastMessageAt: '2026-11-03T09:00:00.000Z',
          messages: [{ id: 'n1', role: 'user', text: 'Oi', timestamp: '2026-11-03T09:00:00.000Z' }]
        },
        '5511977770002@s.whatsapp.net': {
          name: 'Arquivado', slotId: 'slot_1', archived: true, unreadCount: 0,
          lastMessageAt: '2026-11-01T10:00:00.000Z',
          messages: [{ id: 'a1', role: 'user', text: 'Tchau', timestamp: '2026-11-01T10:00:00.000Z' }]
        }
      }
    }
  };
}

// Sobe o router num servidor efêmero, sem tocar no servidor principal.
async function withServer(ctx, fn) {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.dashboardContext = ctx; next(); });
  app.use('/api/conversations-v3', createConversationsV3Router({ getLocalContext: () => ctx }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, error: error.message }));
  const server = app.listen(0);
  const port = server.address().port;
  try { return await fn(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

test('mapeamento chip → instância é determinístico e reversível', () => {
  assert.equal(instanceIdFor('slot_1'), '00000000-0000-4000-8000-000000000001');
  assert.equal(instanceIdFor('slot_2'), '00000000-0000-4000-8000-000000000002');
  assert.equal(slotFromInstance(instanceIdFor('slot_3')), 'slot_3');
  assert.equal(slotFromInstance('nao-e-uuid'), null);
  assert.equal(slotFromInstance('00000000-0000-4000-8000-000000000099'), null, 'fora do teto de chips');
  assert.equal(slotFromInstance('00000000-0000-4000-8000-000000000000'), null, 'zero não é chip');
});

test('chat_id com e sem prefixo de chip é separado corretamente', () => {
  assert.deepEqual(splitChatId('slot_2::5511999990001@s.whatsapp.net'), { slotId: 'slot_2', chatId: '5511999990001@s.whatsapp.net' });
  assert.deepEqual(splitChatId('5511999990001@s.whatsapp.net'), { slotId: null, chatId: '5511999990001@s.whatsapp.net' });
});

test('telefone na lista vai mascarado', () => {
  assert.equal(maskPhone('5511999990001@s.whatsapp.net'), '+5511****01');
  assert.equal(maskPhone(''), null);
});

test('GET /instances devolve os chips reais com contagem de conversas', async () => {
  await withServer(fixture(), async base => {
    const res = await fetch(`${base}/api/conversations-v3/instances`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.source, 'legacy_contacts');
    assert.equal(body.items.length, 1);
    const [slot] = body.items;
    assert.equal(slot.id, instanceIdFor('slot_1'));
    assert.equal(slot.name, 'Chip 1');
    assert.equal(slot.threads, 3);
    assert.equal(slot.connection, 'connected');
    assert.equal(slot.aiEnabled, true);
  });
});

test('GET /threads não carrega histórico e respeita arquivadas', async () => {
  await withServer(fixture(), async base => {
    const inst = instanceIdFor('slot_1');
    const res = await fetch(`${base}/api/conversations-v3/instances/${inst}/threads?limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.counts.total, 3);
    assert.equal(body.counts.archived, 1);
    // A caixa padrão esconde arquivadas.
    assert.equal(body.total, 2);
    assert.ok(!body.items.some(i => i.archived));
    for (const item of body.items) {
      assert.equal(item.messages, undefined, 'lista não pode trazer mensagens');
      assert.ok(item.preview.length <= 120, 'prévia é curta');
      assert.ok(!('phone' in item), 'lista não expõe telefone completo');
    }
    const ana = body.items.find(i => i.name === 'Ana Souza');
    assert.ok(ana);
    assert.equal(ana.unread, 2);
    assert.equal(ana.identityKind, 'verified_pn');
    assert.equal(ana.preview, 'Bom dia! Qual modelo?');
    assert.deepEqual(ana.tags, ['Cliente']);
  });
});

test('GET /threads: contato sem nome legível mostra o telefone, não "Contato WhatsApp"', async () => {
  await withServer(fixture(), async base => {
    const inst = instanceIdFor('slot_1');
    const body = await (await fetch(`${base}/api/conversations-v3/instances/${inst}/threads?limit=10`)).json();
    const semNome = body.items.find(i => i.chatId === '8827364615@lid');
    assert.ok(semNome);
    assert.equal(semNome.name, '+8827364615');
    assert.equal(semNome.identityKind, 'provisional_lid');
  });
});

test('GET /threads aplica busca e pílula no servidor', async () => {
  await withServer(fixture(), async base => {
    const inst = instanceIdFor('slot_1');
    const busca = await (await fetch(`${base}/api/conversations-v3/instances/${inst}/threads?q=autocon`)).json();
    assert.equal(busca.total, 1);
    assert.equal(busca.items[0].name, 'Ana Souza');

    const naoLidas = await (await fetch(`${base}/api/conversations-v3/instances/${inst}/threads?pill=unread`)).json();
    assert.equal(naoLidas.total, 1);

    const arquivadas = await (await fetch(`${base}/api/conversations-v3/instances/${inst}/threads?visibility=archived`)).json();
    assert.equal(arquivadas.total, 1);
    assert.equal(arquivadas.items[0].name, 'Arquivado');
  });
});

test('GET /messages devolve histórico completo da conversa com a ficha real', async () => {
  await withServer(fixture(), async base => {
    const inst = instanceIdFor('slot_1');
    const thread = encodeURIComponent('5511999990001@s.whatsapp.net');
    const res = await fetch(`${base}/api/conversations-v3/instances/${inst}/threads/${thread}/messages`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.conversation.name, 'Ana Souza');
    assert.equal(body.conversation.company, 'Autocon');
    assert.equal(body.conversation.stage, 'em_atendimento');
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.messages[1].fromMe, true);
    assert.equal(body.messages[1].ack, 2);
    assert.equal(body.total, 2);
  });
});

test('conversa de outra conta responde 404, nunca uma conversa alternativa', async () => {
  await withServer(fixture(), async base => {
    const inst = instanceIdFor('slot_1');
    const res = await fetch(`${base}/api/conversations-v3/instances/${inst}/threads/${encodeURIComponent('nao-existe@lid')}/messages`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'CONVERSATION_NOT_FOUND');
  });
});

test('sem contexto de conta a API responde 401 em vez de lista vazia', async () => {
  const ctx = null;
  const express = (await import('express')).default;
  const app = express();
  app.use((req, _res, next) => { req.dashboardContext = ctx; next(); });
  app.use('/api/conversations-v3', createConversationsV3Router({ getLocalContext: () => null }));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations-v3/instances`);
    assert.equal(res.status, 401);
  } finally { server.close(); }
});

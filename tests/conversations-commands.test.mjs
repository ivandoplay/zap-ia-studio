// Comandos reais da caixa de Conversas (/api/conversations-v3 → zapia_contacts).
//
// Cobrem o que antes não existia: envio pelo chip conectado, marcar lida/não lida,
// fixar, arquivar, nota interna, pausa da IA e edição da ficha. Nenhuma chamada real
// ao WhatsApp: o transporte é injetado e o teste confere o que o provedor recebeu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationsCommandsRouter} from '../src/crm/conversationsCommands.js';

const OWNER = '28f17e53-1ab8-4ec7-8556-666df0d4add6';
const INSTANCE = '00000000-0000-4000-8000-000000000001';
const CHAT = '5511999990001@s.whatsapp.net';

// Armazenamento mínimo com a mesma superfície que o servidor usa (storage legado).
function storageFixture(seed) {
  const contacts = structuredClone(seed);
  return {
    contacts,
    upsertContact(key, patch = {}) {
      const current = contacts[key];
      if (!current) return null;
      Object.assign(current, structuredClone(patch));
      return current;
    },
    markContactRead(key) { contacts[key].unreadCount = 0; contacts[key].unreadAlert = false; return contacts[key]; },
    markContactUnread(key) { contacts[key].unreadCount = Math.max(1, contacts[key].unreadCount || 0); return contacts[key]; },
    addInternalNote(key, {text, author}) {
      const note = {id: 'inote_1', text, author, createdAt: '2026-11-06T12:00:00.000Z'};
      contacts[key].internalNotesList = [...(contacts[key].internalNotesList || []), note];
      return contacts[key];
    },
    pauseContact(key, minutes, reason) { contacts[key].pausedUntil = minutes === 'forever' ? 'forever' : '2026-11-06T13:00:00.000Z'; contacts[key].pauseReason = reason; return contacts[key]; },
    resumeContact(key) { contacts[key].pausedUntil = null; contacts[key].pauseReason = ''; return contacts[key]; },
    appendContactMessage(key, message) { contacts[key].messages.push({...message, id: 'local_' + contacts[key].messages.length}); return contacts[key]; }
  };
}

function context() {
  const storage = storageFixture({
    [`slot_1::${CHAT}`]: {
      name: 'Ana Souza', slotId: 'slot_1', unreadCount: 3, messages: [
        {id: 'm1', role: 'user', text: 'Oi', timestamp: '2026-11-04T11:00:00.000Z', waMsgId: 'wamid_1'}
      ]
    },
    '5511988880002@s.whatsapp.net': {
      name: 'Sem chip explícito', slotId: 'slot_1', unreadCount: 0, messages: []
    },
    '5511977770003@s.whatsapp.net': {
      name: 'Outro chip', slotId: 'slot_2', unreadCount: 0, messages: []
    }
  });
  return {
    mode: 'vercel_cloud',
    viewer: {id: OWNER, role: 'master', displayName: 'Jefferson Ivan'},
    tenant: {id: OWNER, displayName: 'Jefferson Ivan'},
    data: {contacts: storage.contacts},
    storage
  };
}

async function withServer(handler, fn, {allowSend = true, ctx = context()} = {}) {
  const express = (await import('express')).default;
  const app = express();
  app.use((req, _res, next) => { req.dashboardContext = ctx; next(); });
  app.use('/api/conversations-v3', createConversationsCommandsRouter({
    getLocalContext: () => ctx,
    allowSend,
    transport: {
      sendText: handler.sendText,
      markRead: handler.markRead
    }
  }));
  const server = app.listen(0);
  try { return await fn(`http://127.0.0.1:${server.address().port}`, ctx); } finally { server.close(); }
}

const url = (base, suffix) => `${base}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent(`slot_1::${CHAT}`)}${suffix}`;

test('envio usa o chip da conversa, guarda o id do provedor e zera as não lidas', async () => {
  const sent = [];
  const handler = {
    sendText: async (userId, chatId, text) => { sent.push({userId, chatId, text}); return {key: {id: 'wamid_novo'}}; }
  };
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: '  Olá, tudo bem?  '})});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sent, true);
    assert.equal(body.providerMessageId, 'wamid_novo');
    // O provedor recebeu o número sem o prefixo do chip.
    assert.deepEqual(sent, [{userId: OWNER, chatId: CHAT, text: 'Olá, tudo bem?'}]);
    const stored = ctx.storage.contacts[`slot_1::${CHAT}`];
    const last = stored.messages.at(-1);
    assert.equal(last.role, 'owner');
    assert.equal(last.text, 'Olá, tudo bem?');
    assert.equal(last.waMsgId, 'wamid_novo');
    assert.equal(stored.unreadCount, 0);
  });
}, {allowSend: true});

test('envio sem confirmação do provedor não grava nada', async () => {
  const handler = {sendText: async () => { throw Object.assign(new Error('Chip desconectado'), {statusCode: 503}); }};
  await withServer(handler, async (base, ctx) => {
    const before = structuredClone(ctx.storage.contacts[`slot_1::${CHAT}`].messages);
    const res = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'Teste'})});
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'WHATSAPP_SEND_FAILED');
    assert.deepEqual(ctx.storage.contacts[`slot_1::${CHAT}`].messages, before);
  });
});

test('texto vazio ou campo extra é recusado antes de tocar no WhatsApp', async () => {
  let called = 0;
  const handler = {sendText: async () => { called += 1; return {key: {id: 'x'}}; }};
  await withServer(handler, async base => {
    const empty = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: '   '})});
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).code, 'MESSAGE_EMPTY');
    const extra = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'oi', to: 'outro'})});
    assert.equal(extra.status, 400);
    assert.equal((await extra.json()).code, 'MESSAGE_INVALID');
    assert.equal(called, 0);
  });
});

test('conversa de outro chip não é alcançada pela instância informada', async () => {
  const handler = {sendText: async () => { throw Error('não deveria enviar'); }};
  await withServer(handler, async base => {
    const res = await fetch(`${base}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent('slot_2::5511977770003@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'oi'})
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'CONVERSATION_NOT_FOUND');
  });
});

test('marcar lida envia os ids ao provedor; não lida é só local', async () => {
  const reads = [];
  const handler = {markRead: async (userId, chatId, ids) => { reads.push({userId, chatId, ids}); return {ok: true}; }};
  await withServer(handler, async (base, ctx) => {
    const read = await fetch(url(base, '/read'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({})});
    assert.equal(read.status, 200);
    assert.deepEqual(reads, [{userId: OWNER, chatId: CHAT, ids: ['wamid_1']}]);
    assert.equal(ctx.storage.contacts[`slot_1::${CHAT}`].unreadCount, 0);
    const unread = await fetch(url(base, '/read'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({unread: true})});
    assert.equal(unread.status, 200);
    assert.equal(ctx.storage.contacts[`slot_1::${CHAT}`].unreadCount > 0, true);
    assert.equal(reads.length, 1, 'marcar não lida não chama o provedor');
  });
});

test('fixar, arquivar e IA usam apenas booleanos e devolvem o estado salvo', async () => {
  const handler = {};
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(url(base, ''), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pinned: true, aiEnabled: false})});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pinned, true);
    assert.equal(body.aiEnabled, false);
    const stored = ctx.storage.contacts[`slot_1::${CHAT}`];
    assert.equal(stored.pinned, true);
    assert.equal(stored.aiIgnored, true, 'IA desligada grava o campo do CRM legado');
    const bad = await fetch(url(base, ''), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pinned: 'sim'})});
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'CONVERSATION_PATCH_INVALID');
    const unknown = await fetch(url(base, ''), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({slotId: 'slot_1'})});
    assert.equal(unknown.status, 400);
  });
});

test('nota interna fica só na conversa, com autor da sessão', async () => {
  const handler = {};
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(url(base, '/notes'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'Cliente pediu retorno amanhã'})});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.note.text, 'Cliente pediu retorno amanhã');
    assert.equal(body.note.author, 'Jefferson Ivan');
    const empty = await fetch(url(base, '/notes'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: ''})});
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).code, 'NOTE_EMPTY');
  });
});

test('pausa e retomada da IA respeitam o limite de tempo', async () => {
  const handler = {};
  await withServer(handler, async (base, ctx) => {
    const paused = await fetch(url(base, '/pause'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({minutes: 'forever', reason: 'Aguardando aprovação'})});
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).paused, 'forever');
    assert.equal(ctx.storage.contacts[`slot_1::${CHAT}`].pauseReason, 'Aguardando aprovação');
    const clamped = await fetch(url(base, '/pause'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({minutes: 999999})});
    assert.equal(clamped.status, 200);
    const resumed = await fetch(url(base, '/resume'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({})});
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).paused, null);
  });
});

test('ficha aceita somente campos do CRM e recusa nome vazio', async () => {
  const handler = {};
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(url(base, '/profile'), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({company: 'Autocon', city: 'Fortaleza'})});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.profile.company, 'Autocon');
    const stored = ctx.storage.contacts[`slot_1::${CHAT}`];
    assert.equal(stored.city, 'Fortaleza');
    const bad = await fetch(url(base, '/profile'), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({docNumber: '123'})});
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'PROFILE_PATCH_INVALID');
    const blank = await fetch(url(base, '/profile'), {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: '   '})});
    assert.equal(blank.status, 400);
  });
});

test('suporte master não escreve na conta do cliente', async () => {
  const handler = {sendText: async () => ({key: {id: 'x'}})};
  const ctx = context();
  ctx.viewer = {id: '99999999-9999-4999-8999-999999999999', role: 'master', displayName: 'Suporte'};
  await withServer(handler, async base => {
    const res = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'oi'})});
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'CONVERSATIONS_SUPPORT_READ_ONLY');
  }, {ctx});
});

test('envio desligado responde 503 explícito em vez de fingir sucesso', async () => {
  const handler = {sendText: async () => ({key: {id: 'x'}})};
  await withServer(handler, async base => {
    const res = await fetch(url(base, '/messages'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'oi'})});
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'CONVERSATION_SEND_DISABLED');
  }, {allowSend: false});
});

test('conversa sem prefixo de chip é encontrada pelo slotId do contato', async () => {
  const handler = {sendText: async () => ({key: {id: 'y'}})};
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(`${base}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent('5511988880002@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'oi'})
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.storage.contacts['5511988880002@s.whatsapp.net'].messages.at(-1).text, 'oi');
  });
});

// Regressão do envio pelo Chip 1: o front manda a thread prefixada
// ("slot_1::<jid>"), mas o chip 1 grava o contato SEM prefixo. Antes, a busca só
// tentava a forma prefixada e a rota devolvia 404 CONVERSATION_NOT_FOUND —
// mesmo com a conversa existindo no armazenamento.
test('thread prefixada do chip 1 acha o contato gravado sem prefixo', async () => {
  const sent = [];
  const handler = {sendText: async (userId, chatId) => { sent.push({userId, chatId}); return {key: {id: 'wamid_bare'}}; }};
  await withServer(handler, async (base, ctx) => {
    const res = await fetch(`${base}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent('slot_1::558681638438@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'teste interno'})
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sent, true);
    assert.equal(body.providerMessageId, 'wamid_bare');
    assert.equal(sent[0].chatId, '558681638438@s.whatsapp.net');
    assert.equal(ctx.storage.contacts['558681638438@s.whatsapp.net'].messages.at(-1).waMsgId, 'wamid_bare');
  }, {ctx: (() => {
    const base = context();
    base.storage.contacts['558681638438@s.whatsapp.net'] = {name: 'Chip 2 - teste interno', slotId: 'slot_1', unreadCount: 0, messages: []};
    base.data.contacts = base.storage.contacts;
    return base;
  })()});
});

test('thread do chip 1 não é alcançada pela instância do chip 2', async () => {
  const handler = {sendText: async () => ({key: {id: 'nunca'}})};
  await withServer(handler, async base => {
    const res = await fetch(`${base}/api/conversations-v3/instances/00000000-0000-4000-8000-000000000002/threads/${encodeURIComponent('slot_1::558681638438@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'nao deveria sair'})
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'CONVERSATION_NOT_FOUND');
  });
});

// Regressão do envio real do Chip 1: o WhatsApp moderno identifica o contato por
// @lid, então a conversa fica gravada em "<números>@lid" e o front pode pedir o
// número. Antes, o 404 vinha porque nenhuma das formas testadas era o @lid.
test('thread pedida pelo número acha a conversa gravada no @lid do mesmo chip', async () => {
  const sent = [];
  const handler = {sendText: async (userId, chatId) => { sent.push({userId, chatId}); return {key: {id: 'wamid_lid'}}; }};
  const base = context();
  base.storage.contacts['263762531643591@lid'] = {
    name: 'Jefferson Ivan', slotId: 'slot_1', phone: '558681638438', unreadCount: 1,
    lastMessageAt: '2026-11-06T23:13:10.000Z',
    messages: [{role: 'user', text: 'oi', timestamp: '2026-11-06T23:13:10.000Z'}]
  };
  base.data.contacts = base.storage.contacts;
  await withServer(handler, async (url) => {
    const res = await fetch(`${url}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent('558681638438@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'teste interno'})
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).providerMessageId, 'wamid_lid');
    // O envio vai para o JID da thread, não para o número pedido.
    assert.equal(sent[0].chatId, '263762531643591@lid');
    assert.equal(base.storage.contacts['263762531643591@lid'].messages.at(-1).waMsgId, 'wamid_lid');
  }, {ctx: base});
});

test('número de outro chip continua bloqueado na instância do chip 1', async () => {
  const handler = {sendText: async () => ({key: {id: 'nunca'}})};
  const base = context();
  base.storage.contacts['slot_2::999888777@lid'] = {name: 'Outro', slotId: 'slot_2', phone: '5511999888777', messages: []};
  base.data.contacts = base.storage.contacts;
  await withServer(handler, async (url) => {
    const res = await fetch(`${url}/api/conversations-v3/instances/${INSTANCE}/threads/${encodeURIComponent('5511999888777@s.whatsapp.net')}/messages`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: 'nao deveria sair'})
    });
    assert.equal(res.status, 404);
  }, {ctx: base});
});

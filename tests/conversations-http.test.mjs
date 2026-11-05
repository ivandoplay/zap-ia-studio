// Conversas: contrato da API nova, isolamento por conta e o mínimo de dados pessoais na lista.
import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {createConversationsRouter} from '../src/crm/conversations.js';
import {conversationSummary, publicMessage} from '../src/crm/conversations.js';

const now = new Date();
const iso = d => new Date(d).toISOString();

function fakeStore(contacts) {
  return {
    data: { contacts },
    findSiblingContactKey: chatId => (contacts[chatId] ? chatId : null)
  };
}

const CONTACTS = {
  'slot_1::5586900000001@s.whatsapp.net': {
    slotId: 'slot_1', name: 'Ana Paula', phone: '5586900000001', stage: 'aguardando_humano',
    tags: ['Loja', 'VIP'], pinned: true, unreadCount: 3, unreadAlert: true,
    lastMessageAt: iso(now), summary: 'Quer o catálogo', notes: 'Nota privada do dono',
    aiIgnored: false, pausedUntil: null, dealStatus: 'open', dealValue: 1500,
    messages: [
      { id: 'm1', role: 'user', text: 'Bom dia, tem o produto?', timestamp: iso(now.getTime() - 60000), waMsgId: 'w1', waMsgKey: { remoteJid: 'x', id: 'w1', fromMe: false } },
      { id: 'm2', role: 'owner', text: 'Bom dia! Temos sim.', timestamp: iso(now), waMsgId: 'w2', waMsgKey: { remoteJid: 'x', id: 'w2', fromMe: true }, ack: 3 }
    ]
  },
  'slot_2::5586900000002@s.whatsapp.net': {
    slotId: 'slot_2', name: '...', phone: '5586900000002', stage: 'novo',
    tags: [], pinned: false, unreadCount: 0, archived: true, lastMessageAt: iso(now.getTime() - 86400000),
    pausedUntil: 'forever', pauseReason: 'Cliente pediu pausa', messages: [{ id: 'm3', role: 'user', text: 'ok', timestamp: iso(now.getTime() - 86400000) }]
  },
  'slot_3::5586900000003@s.whatsapp.net': {
    slotId: 'slot_3', name: 'Carlos', phone: '5586900000003', stage: 'concluido',
    tags: ['Campanhas'], pinned: false, unreadCount: 0, lastMessageAt: iso(now.getTime() - 3600000),
    messages: [{ id: 'm4', role: 'user', text: '', timestamp: iso(now.getTime() - 3600000), mediaFiles: [{ name: 'audio.ogg', mime: 'audio/ogg', url: 'https://exemplo/audio.ogg' }] }]
  }
};

async function makeServer(ctxFactory) {
  const app = express();
  app.use('/api/conversations', createConversationsRouter({ getLocalContext: ctxFactory }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const contextFor = (contacts, extra = {}) => () => ({
  mode: 'local_worker',
  viewer: { id: 'user-1', displayName: 'Titular' },
  tenant: { id: 'user-1' },
  permissions: { master: false },
  store: fakeStore(contacts),
  data: { contacts },
  ...extra
});

test('conversas: lista não expõe mensagens, notas internas nem chaves do WhatsApp', async () => {
  const { server, base } = await makeServer(contextFor(CONTACTS));
  try {
    const res = await fetch(`${base}/api/conversations?limit=10`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store, private');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.schemaVersion, 1);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('Nota privada do dono'), false, 'nota interna não pode vazar na lista');
    assert.equal(raw.includes('waMsgKey'), false, 'chave interna do WhatsApp não vai para a lista');
    // A lista traz só a prévia curta da última mensagem, nunca o array de mensagens.
    assert.equal(raw.includes('"messages"'), false, 'lista não carrega o histórico');
    const preview = body.items.find(i => i.name === 'Ana Paula').lastMessage.preview;
    assert.ok(preview.length <= 120, 'prévia é curta');
    for (const item of body.items) {
      assert.deepEqual(Object.keys(item).sort(), [
        'aiIgnored', 'archived', 'channelKey', 'chatId', 'dealStatus', 'dealValue', 'lastMessage',
        'lastMessageAt', 'name', 'paused', 'phone', 'pinned', 'slotId', 'stage', 'tags', 'unread', 'unreadAlert'
      ]);
    }
  } finally { await new Promise(r => server.close(r)); }
});

test('conversas: contagem global, filtros no servidor e ordem com fixadas primeiro', async () => {
  const { server, base } = await makeServer(contextFor(CONTACTS));
  try {
    const all = await (await fetch(`${base}/api/conversations?visibility=all`)).json();
    assert.equal(all.total, 3);
    assert.deepEqual(all.counts, { total: 3, inbox: 2, archived: 1, unread: 1, pinned: 1, human: 1, paused: 0, awaiting: 1 });

    const inbox = await (await fetch(`${base}/api/conversations`)).json();
    assert.equal(inbox.total, 2, 'arquivada fica fora da caixa de entrada');
    assert.equal(inbox.items[0].name, 'Ana Paula', 'fixada vem primeiro');

    const human = await (await fetch(`${base}/api/conversations?pill=human`)).json();
    assert.equal(human.total, 1);
    assert.equal(human.items[0].stage, 'aguardando_humano');

    const slot = await (await fetch(`${base}/api/conversations?slot=slot_3`)).json();
    assert.equal(slot.total, 1);

    const archived = await (await fetch(`${base}/api/conversations?visibility=archived`)).json();
    assert.equal(archived.total, 1);
    assert.equal(archived.items[0].paused, 'forever');

    const search = await (await fetch(`${base}/api/conversations?visibility=all&q=VIP`)).json();
    assert.equal(search.total, 1, 'busca por etiqueta');

    const phoneSearch = await (await fetch(`${base}/api/conversations?visibility=all&q=900000002`)).json();
    assert.equal(phoneSearch.total, 1, 'busca por telefone');

    const accented = await (await fetch(`${base}/api/conversations?visibility=all&q=carlos`)).json();
    assert.equal(accented.total, 1, 'busca ignora caixa');
  } finally { await new Promise(r => server.close(r)); }
});

test('conversas: paginação por offset não repete nem perde itens', async () => {
  const many = {};
  for (let i = 0; i < 47; i++) {
    many[`slot_1::5586900000${String(i).padStart(3, '0')}@s.whatsapp.net`] = {
      slotId: 'slot_1', name: `Contato ${i}`, stage: 'novo', unreadCount: 0,
      lastMessageAt: iso(now.getTime() - i * 60000), messages: []
    };
  }
  const { server, base } = await makeServer(contextFor(many));
  try {
    const seen = new Set();
    let offset = 0;
    for (;;) {
      const page = await (await fetch(`${base}/api/conversations?limit=10&offset=${offset}`)).json();
      assert.equal(page.total, 47);
      for (const item of page.items) {
        assert.equal(seen.has(item.chatId), false, 'item repetido entre páginas');
        seen.add(item.chatId);
      }
      if (!page.hasMore) break;
      offset += page.items.length;
    }
    assert.equal(seen.size, 47);
  } finally { await new Promise(r => server.close(r)); }
});

test('conversas: detalhe entrega mensagens sem dados internos e 404 fora da conta', async () => {
  const { server, base } = await makeServer(contextFor(CONTACTS));
  try {
    const chatId = encodeURIComponent('slot_1::5586900000001@s.whatsapp.net');
    const res = await fetch(`${base}/api/conversations/${chatId}?limit=50`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[1].role, 'owner');
    assert.equal(body.messages[1].ack, 3);
    assert.equal(body.conversation.summary, 'Quer o catálogo');
    assert.equal(JSON.stringify(body).includes('waMsgKey'), false, 'chave interna não vaza');

    const media = await (await fetch(`${base}/api/conversations/${encodeURIComponent('slot_3::5586900000003@s.whatsapp.net')}`)).json();
    assert.equal(media.messages[0].text, '');
    assert.equal(media.messages[0].media.mime, 'audio/ogg');
    assert.equal(media.messages[0].media.url, 'https://exemplo/audio.ogg');

    const missing = await fetch(`${base}/api/conversations/${encodeURIComponent('slot_1::5599999999999@s.whatsapp.net')}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'CONVERSATION_NOT_FOUND');
  } finally { await new Promise(r => server.close(r)); }
});

test('conversas: sem sessão dá 401 e nunca lista de outra conta', async () => {
  const { server, base } = await makeServer(() => null);
  try {
    const res = await fetch(`${base}/api/conversations`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.items, undefined, 'não devolve lista vazia como se fosse dado');
  } finally { await new Promise(r => server.close(r)); }
});

test('conversas: nome inválido cai para o telefone; mídia vira prévia legível', () => {
  const summary = conversationSummary('slot_2::5586900000002@s.whatsapp.net', CONTACTS['slot_2::5586900000002@s.whatsapp.net']);
  assert.equal(summary.name, '+5586900000002', 'nome "..." não identifica ninguém');
  assert.equal(summary.paused, 'forever');
  const audio = publicMessage({ role: 'user', mediaFiles: [{ name: 'audio.ogg', mime: 'audio/ogg' }] });
  assert.equal(audio.media.mime, 'audio/ogg');
  assert.equal(audio.text, '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Somente cópia isolada');
process.env.VERCEL = '1';
process.env.SUPABASE_URL = 'https://supabase-sintetico.invalid';
process.env.SUPABASE_ANON_KEY = 'sintetico';
const { localStorageInstance: store, UPLOADS_DIR } = await import('../src/storage.js');
const { cloudWorker } = await import('../src/supabaseCloud.js');

const file = `latencia-${crypto.randomUUID()}.png`;
const filePath = path.join(UPLOADS_DIR, file);
const chatId = '5586981234567@s.whatsapp.net';
const order = [];
const original = {
  client: cloudWorker.client,
  user: cloudWorker.user,
  syncInFlight: cloudWorker.syncInFlight,
  pendingFlush: cloudWorker.pendingFlush,
  currentFlushPromise: cloudWorker.currentFlushPromise
};

const query = {
  select() { return this; },
  eq() { return this; },
  in() { return Promise.resolve({ data: [], error: null }); },
  upsert() { order.push('conversation-write'); return Promise.resolve({ error: null }); }
};
const client = {
  from() { return query; },
  storage: {
    from() {
      return {
        async upload() {
          order.push('media-upload-start');
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { error: null };
        },
        getPublicUrl(storagePath) {
          return { data: { publicUrl: `https://supabase-sintetico.invalid/storage/${storagePath}` } };
        }
      };
    }
  }
};

try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('imagem sintética'));
  store.inMemory = true;
  store.onMutate = null;
  store.data.contacts = {
    [chatId]: {
      chatId,
      phone: '5586981234567',
      name: 'Contato sintético',
      messages: [{ role: 'user', text: '[Imagem]', waMsgId: 'msg-media-fast', mediaUrl: `/uploads/${file}`, mediaMime: 'image/png' }],
      lastMessageAt: new Date().toISOString()
    }
  };
  store.dirtyContactIds = new Set([chatId]);
  store.deletedContactIds = new Set();
  store.workspaceDirty = false;
  cloudWorker.client = client;
  cloudWorker.user = { id: '11111111-1111-4111-8111-111111111111' };
  cloudWorker.syncInFlight = false;
  cloudWorker.pendingFlush = false;
  cloudWorker.currentFlushPromise = null;

  await test('sincroniza a mensagem antes de aguardar upload de mídia', async () => {
    await cloudWorker.flushLocalToCloud();
    assert.ok(order.indexOf('conversation-write') >= 0);
    assert.ok(order.indexOf('media-upload-start') > order.indexOf('conversation-write'), order.join(' -> '));
    assert.match(store.data.contacts[chatId].messages[0].mediaUrl, /^https:\/\//);
  });
} finally {
  try { fs.unlinkSync(filePath); } catch {}
  Object.assign(cloudWorker, original);
  store.data.contacts = {};
  store.dirtyContactIds.clear();
  store.deletedContactIds.clear();
  store.workspaceDirty = false;
}

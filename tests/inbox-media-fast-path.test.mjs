import test from 'node:test';
import assert from 'node:assert/strict';
assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Somente cópia isolada');
process.env.VERCEL = '1';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
const { localStorageInstance: store } = await import('../src/storage.js');
const { whatsappManager } = await import('../src/whatsappManager.js');

store.inMemory = true;
store.onMutate = null;
store.data.contacts = {};
store.data.settings.botEnabled = false;
const slot = whatsappManager.slots.slot_1;
const chatId = '5586981234567@s.whatsapp.net';
let resolveDownload;
let downloadStarted = false;
let broadcastCount = 0;
const pendingDownload = new Promise((resolve) => { resolveDownload = resolve; });
slot.broadcastFn = (event) => { if (event === 'crm_updated') broadcastCount++; };

try {
  await test('exibe mensagem recebida antes de terminar download de mídia', async () => {
    const msg = {
      key: { remoteJid: chatId, fromMe: false, id: 'msg-media-sintetica' },
      message: { imageMessage: { mimetype: 'image/png', caption: 'imagem sintética' } },
      messageTimestamp: Math.floor(Date.now() / 1000)
    };
    const processing = slot.handleIncomingRawMessage(msg, {
      mediaDownloader: () => { downloadStarted = true; return pendingDownload; }
    });

    assert.equal(downloadStarted, true, 'o downloader injetado deve ser usado');
    assert.equal(store.data.contacts[chatId]?.messages?.some((m) => m.waMsgId === 'msg-media-sintetica'), true,
      'a mensagem precisa entrar no CRM antes de aguardar o binário');
    assert.equal(broadcastCount, 1, 'o painel deve receber o sinal assim que o texto/metadado estiver disponível');

    resolveDownload(Buffer.from('conteúdo sintético'));
    await processing;
    const saved = store.data.contacts[chatId].messages.find((m) => m.waMsgId === 'msg-media-sintetica');
    assert.equal(saved.mediaMime, 'image/png');
    assert.match(saved.mediaUrl, /^\/uploads\//);
    assert.equal(broadcastCount, 2, 'a conclusão do upload atualiza os metadados sem duplicar a mensagem');
    assert.equal(store.data.contacts[chatId].messages.filter((m) => m.waMsgId === 'msg-media-sintetica').length, 1);
  });
} finally {
  clearInterval(whatsappManager.followUpTimer);
  if (store.saveTimer) clearTimeout(store.saveTimer);
}

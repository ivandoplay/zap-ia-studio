import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';

assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Executar somente na cópia isolada');
const { chromium } = createRequire(process.env.ZAPIA_PLAYWRIGHT_REQUIRE)('playwright');
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.ZAPIA_NO_TTY_PROMPT = '1';

const { localStorageInstance: store } = await import('../src/storage.js');
const { whatsappManager } = await import('../src/whatsappManager.js');
const { cloudWorker } = await import('../src/supabaseCloud.js');
store.inMemory = true;
store.onMutate = null;
store.data.contacts = {};
store.data.settings.securityPin = '';
cloudWorker.getStatus = () => ({ configured: false, loggedIn: false });
cloudWorker.tryRestoreSavedLogin = async () => false;
cloudWorker.promptTerminalLoginIfInteractive = async () => {};
whatsappManager.autoRestoreIfSessionExists = async () => {};

const chatId = '5586999998888@s.whatsapp.net';
store.upsertContact(chatId, { name: 'Cliente Histórico Sintético', phone: '5586999998888' }, { deferSave: true });
store.appendContactMessage(chatId, { role: 'user', text: 'Mensagem recente já no CRM', waMsgId: 'live-1' });
whatsappManager.fetchOlderMessagesForChat = async (requestedChatId) => {
  const contact = store.appendContactMessage(requestedChatId, {
    role: 'user', text: 'Mensagem antiga importada do histórico', waMsgId: 'history-1', historical: true,
    timestamp: '2024-01-02T10:00:00.000Z'
  }, { historical: true });
  return { ok: true, addedCount: 1, contact };
};

let server;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  server = this;
  return originalListen.call(this, 0, '127.0.0.1');
};
await import('../src/server.js');
http.Server.prototype.listen = originalListen;
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

test('CRM mostra no fio da conversa a mensagem antiga carregada do histórico', async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.request().url().startsWith(`${base}/`) ? route.continue() : route.abort());
    await page.goto(`${base}/painel`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.contacts?.length === 1);
    await page.locator('.nav-btn[data-tab="crm"]').click();
    await page.locator('#crmInboxList .crm-inbox-item').filter({ hasText: 'Cliente Histórico Sintético' }).click();
    await page.locator('#crmInboxMessages').getByText('Mensagem recente já no CRM').waitFor();
    const historyButton = page.locator('#crmInboxMessages .btn-fetch-older-history');
    await historyButton.waitFor({ state: 'visible', timeout: 5000 });
    await historyButton.click();
    await page.locator('#crmInboxMessages').getByText('Mensagem antiga importada do histórico').waitFor({ timeout: 8000 });
    assert.equal(store.data.contacts[chatId].unreadCount, 0, 'importar mensagens antigas não aumenta o contador de não lidas');
    assert.deepEqual(errors, [], 'sem erros de JavaScript no painel');
    console.log('OK: mensagem histórica aparece na conversa existente sem gerar não lidas; interface em navegador real, dados sintéticos.');
    await page.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    clearInterval(whatsappManager.followUpTimer);
    if (store.saveTimer) clearTimeout(store.saveTimer);
  }
});

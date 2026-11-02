import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';

assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1', 'Executar apenas na cópia isolada');
const { chromium } = createRequire(process.env.ZAPIA_PLAYWRIGHT_REQUIRE)('playwright');
for (const key of ['VERCEL', 'VERCEL_ENV']) delete process.env[key];
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.ZAPIA_NO_TTY_PROMPT = '1';
process.env.EVOLUTION_API_URL = 'https://evolution.synthetic.invalid';
process.env.EVOLUTION_API_KEY = 'synthetic-only-key';
process.env.EVOLUTION_DEFAULT_USER_ID = 'synthetic-user';
process.env.EVOLUTION_INSTANCE_USERS = '{}';

const originalFetch = globalThis.fetch;
let connectionOpen = false;
let connectPayload = { pairingCode: null, code: '2@synthetic-raw-qr-payload', base64: null, count: 1 };
const evolutionRequests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin === 'https://evolution.synthetic.invalid') {
    evolutionRequests.push({ url: url.href, options });
    let body = {};
    if (url.pathname.endsWith('/instance/fetchInstances')) body = [];
    else if (url.pathname.endsWith('/instance/create')) {
      const parsed = JSON.parse(options.body || '{}');
      body = { instance: { instanceName: parsed.instanceName, instanceId: 'synthetic-instance-id' } };
    } else if (url.pathname.includes('/instance/connect/')) body = connectPayload;
    else if (url.pathname.includes('/instance/connectionState/')) body = { instance: { state: connectionOpen ? 'open' : 'connecting' } };
    else if (url.pathname.includes('/webhook/set/')) body = { webhook: { enabled: true } };
    return { ok: true, status: 201, text: async () => JSON.stringify(body) };
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return originalFetch(input, options);
  throw new Error(`Rede externa bloqueada no teste local: ${url.origin}`);
};

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
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', (route) => route.request().url().startsWith(`${base}/`) ? route.continue() : route.abort());
  await page.goto(`${base}/painel`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.business && Array.isArray(state.contacts));

  // Cenário ponta a ponta: botão real → rota local → mock isolado da API → QR exibido pelo painel.
  await page.locator('#btnConnectQr').click();
  const qr = page.locator('#qrStage img.qr-image');
  await qr.waitFor({ state: 'visible', timeout: 15000 });
  const image = await qr.evaluate((el) => ({ src: el.src, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, alt: el.alt }));
  assert.match(image.src, /^data:image\/png;base64,/);
  assert(image.naturalWidth > 100 && image.naturalHeight > 100, `QR deve ser imagem decodificável: ${JSON.stringify(image)}`);
  assert.match(image.alt, /Chip 1/);
  assert.equal(await page.locator('#qrStage .pairing-code-display').count(), 0, '`code` cru da Evolution não pode aparecer como código numérico');
  assert.doesNotMatch(await page.locator('#qrStage').innerText(), /2@synthetic-raw-qr-payload/);
  assert.match(await page.locator('#qrStage').innerText(), /Aponte a câmera do WhatsApp/);
  assert.equal(await page.locator('#waStatusText').innerText(), 'Pareando');
  await page.locator('.conn-panel').screenshot({ path: '/home/user/evolution-qr-ui-synthetic.png' });
  const webhookRequest = evolutionRequests.find((item) => item.url.includes('/webhook/set/'));
  assert(webhookRequest, 'configura webhook antes de conectar');
  assert.equal(JSON.parse(webhookRequest.options.body).webhook.enabled, true);
  const connectRequest = evolutionRequests.find((item) => item.url.includes('/instance/connect/'));
  assert(connectRequest, 'chama o endpoint de conexão da Evolution');

  // Código numérico só aparece quando a API entrega explicitamente pairingCode.
  connectPayload = { pairingCode: '12345678', code: '2@different-raw-qr-payload', base64: null, count: 1 };
  await page.locator('#pairingPhoneInput').fill('5586999998888');
  await page.locator('#btnConnectCode').click();
  await page.locator('#qrStage .pairing-code-display').getByText('12345678', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('#qrStage img.qr-image').count(), 0, 'modo código numérico não deve mostrar payload cru como QR');
  assert.match(await page.locator('#qrStage').innerText(), /Digite este código no WhatsApp/);
  assert.match(await page.locator('#toastStack').innerText(), /Código de pareamento gerado/);
  assert(evolutionRequests.some((item) => item.url.includes('/instance/connect/zap-ia-slot_1?number=5586999998888')));

  // Ao confirmar conexão, a próxima consulta limpa os dados transitórios e atualiza a UI para online.
  connectionOpen = true;
  await page.locator('#qrStage .stage-connected').waitFor({ state: 'visible', timeout: 12000 });
  assert.equal(await page.locator('#qrStage img.qr-image').count(), 0);
  assert.equal(await page.locator('#qrStage .pairing-code-display').count(), 0);
  assert.match(await page.locator('#waStatusText').innerText(), /Online/);
  assert.deepEqual(pageErrors, [], 'sem erros JS no navegador');
  console.log('OK: browser real exibiu QR decodificável; separou QR de pairingCode; enviou telefone; limpou QR/código após conectar; sem requisições ou mensagens reais.');
  await page.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  clearInterval(whatsappManager.followUpTimer);
  if (store.saveTimer) clearTimeout(store.saveTimer);
  globalThis.fetch = originalFetch;
}

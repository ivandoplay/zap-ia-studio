// Teste manual somente com sessão dedicada e expressamente autorizada.
// Refresh pode invalidar a sessão original; não use a sessão de um motor ativo.
// ZAPIA_PLAYWRIGHT_REQUIRE=/.../package.json IENVIA_TEST_SESSION_FILE=/.../sessao.json \
// IENVIA_TEST_ORIGIN=https://... IENVIA_EXPECT_USER_ID=... node tests/playwright-conta-leitura.manual.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {ZAPIA_PLAYWRIGHT_REQUIRE, IENVIA_TEST_SESSION_FILE, IENVIA_TEST_ORIGIN, IENVIA_EXPECT_USER_ID} = process.env;
if (!ZAPIA_PLAYWRIGHT_REQUIRE || !IENVIA_TEST_SESSION_FILE || !IENVIA_TEST_ORIGIN || !IENVIA_EXPECT_USER_ID) {
  throw new Error('Informe o ambiente Playwright, origem, arquivo de sessão dedicada e ID da conta autorizada.');
}
const origin = new URL(IENVIA_TEST_ORIGIN).origin;
if (!origin.startsWith('https://') && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) {
  throw new Error('Use HTTPS ou um servidor local de teste.');
}
const raw = JSON.parse(fs.readFileSync(IENVIA_TEST_SESSION_FILE, 'utf8'));
const workerSession = raw.items?.zapia_worker_auth;
const s = workerSession ? JSON.parse(workerSession) : raw;
const session = {
  accessToken: s.accessToken || s.access_token,
  refreshToken: s.refreshToken || s.refresh_token,
  expiresAt: s.expiresAt || s.expires_at,
  user: {id: s.user?.id}
};
assert.equal(session.user.id, IENVIA_EXPECT_USER_ID, 'A sessão não corresponde à conta autorizada.');
assert(session.accessToken && session.refreshToken, 'Sessão dedicada incompleta.');

const {chromium} = createRequire(ZAPIA_PLAYWRIGHT_REQUIRE)('playwright');
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  let refreshes = 0;
  const errors = [];
  page.on('pageerror', () => errors.push('Erro JavaScript não tratado'));
  await page.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== origin) return route.abort();
    if (['GET','HEAD'].includes(req.method())) return route.continue();
    if (u.pathname === '/api/auth/refresh' && req.method() === 'POST' && refreshes++ === 0) return route.continue();
    return route.abort();
  });
  await page.addInitScript(({value}) => {
    if (!localStorage.getItem('zapia_cloud_auth')) localStorage.setItem('zapia_cloud_auth', JSON.stringify(value));
  }, {value:session});
  const response = await page.goto(`${origin}/painel`, {waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(response.status(),200);
  await page.waitForFunction(() => {
    try { return (typeof state !== 'undefined' && Boolean(state.business)) || Boolean(document.querySelector('#cloudLoginScreen.open')); }
    catch { return false; }
  },null,{timeout:30000});
  const meta = await page.evaluate(() => {
    const current = typeof state !== 'undefined' ? state : {};
    return {
      logged: Boolean(current.business) && !document.querySelector('#cloudLoginScreen.open'),
      userId: current.currentUser?.id,
      version: current.appVersion,
      online: Boolean(current.waState?.workerOnline),
      contacts: Array.isArray(current.contacts) ? current.contacts.length : null
    };
  });
  assert(meta.logged, 'Sessão não autenticada; o teste não executou operações de conta.');
  assert.equal(meta.userId, IENVIA_EXPECT_USER_ID, 'O painel retornou outra conta.');
  for (const tab of ['dashboard','crm','treinamento','audios','catalogo','simulador','ia','seguranca']) {
    await page.locator(`.nav-btn[data-tab="${tab}"]`).click();
    assert(await page.locator(`#tab-${tab}`).evaluate(el => el.classList.contains('active')), `Falha na aba ${tab}`);
    console.log(`OK: ${tab}`);
  }
  assert.deepEqual(errors, [], 'O navegador apresentou erro JavaScript não tratado.');
  console.log(`Conta correta; versão ${meta.version}; motor online: ${meta.online}; contatos carregados: ${meta.contacts}.`);
  console.log('Teste somente leitura; solicitações de alteração foram bloqueadas, exceto a renovação de sessão.');
  await page.close();
} finally {
  if (browser) await browser.close();
}

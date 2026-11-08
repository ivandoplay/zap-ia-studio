// Laboratório reproduzível, não RUM de produção: serve o HTML/JS/CSS reais do painel,
// simula auth/bootstrap sem dados reais e emula celular (390x844, 1.6Mbps, 150ms RTT).
// Rode `npm run perf:lab`; o resultado é a mediana aproximada de 3 cargas sem cache.
import express from 'express';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { compressionMiddleware, sendStaticFile, staticCacheHeaders } from '../src/shared/perf.js';

const app = express();
app.use(compressionMiddleware({ threshold: 1024 }));
app.use(express.json());
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const file = (req.path || '/').replace(/^\/+/, '') || 'index.html';
  if (!/\.(?:js|mjs|css|json|html|svg|txt)$/i.test(file)) return next();
  if (sendStaticFile(req, res, process.cwd(), file)) return;
  next();
});
app.use(express.static(path.join(process.cwd(), 'public'), { setHeaders: staticCacheHeaders }));
app.get('/api/auth/status', (_req, res) => res.json({
  ok: true, mode: 'local_worker', cloudLoginRequired: false, pinRequired: false,
  currentUser: { id: 'perf', username: 'perf', displayName: 'Performance', role: 'user' },
  branding: { appName: 'Ienvia', appSubtitle: 'Performance test' }
}));
app.get('/api/bootstrap', (_req, res) => res.json({
  appVersion: 'perf', runtimeMode: 'local_worker',
  currentUser: { id: 'perf', username: 'perf', displayName: 'Performance', role: 'user' },
  waState: { status: 'disconnected', workerOnline: false, slots: {}, connectedUser: null },
  proactiveQueueState: { running: false }, audioEngineReady: true,
  settings: { ai: {}, branding: { appName: 'Ienvia' }, botEnabled: false, waSlots: {} },
  geminiPoolCount: 1,
  business: { name: 'Performance', companyName: 'Performance', catalog: [], voiceLibrary: [], faqs: [], knowledgeDocs: [], crmTags: [], trainingPackId: null },
  templates: [], trainingPacks: [], contacts: [], stats: {}, logs: [], simulatorHistory: []
}));
app.all('/api/*', (_req, res) => res.status(200).json({ ok: true, data: [], items: [], hasMore: false }));
const server = app.listen(0, '0.0.0.0');
await once(server, 'listening');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const results = [];
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      window.__lcp = 0;
      try { new PerformanceObserver((list) => { const e = list.getEntries().at(-1); if (e) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200 * 1024, uploadThroughput: 50 * 1024, connectionType: 'cellular3g' });
    await page.goto(`http://127.0.0.1:${server.address().port}/painel.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]));
      const resources = performance.getEntriesByType('resource').map((e) => ({
        name: new URL(e.name).pathname, transfer: e.transferSize, encoded: e.encodedBodySize, duration: e.duration
      }));
      const main = Object.fromEntries(['app.js','inbox-realtime.js','styles.css','utilities.css','campanhas.js','campanhas.css','perf.js','skeleton.css'].map((f) => {
        const r = resources.find((x) => x.name === `/${f}`); return [f, r || null];
      }));
      const lcp = window.__lcp || 0;
      return {
        document: { transfer: nav.transferSize, encoded: nav.encodedBodySize },
        fcp: paints['first-contentful-paint'] || 0,
        dcl: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        lcp,
        transferKB: Math.round(resources.reduce((n, r) => n + (r.transfer || 0), 0) / 1024),
        resources: main,
        resourceCount: resources.length
      };
    });
    results.push(result);
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}

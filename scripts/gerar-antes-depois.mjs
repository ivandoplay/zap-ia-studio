// Gera as duas imagens de aprovação da reformulação (antes / depois), com o MESMO
// dado de exemplo nas duas versões, para a comparação ser justa.
// Uso: node scripts/gerar-antes-depois.mjs <arquivo-antigo.html>
import { chromium } from 'playwright';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const antigoDash = fs.readFileSync(process.argv[2], 'utf8');

const settings = { botEnabled: true, ai: { geminiApiKey: 'demo', openrouterApiKey: '', primaryProvider: 'gemini' },
  antiBan: { simulateTyping: true, splitLongMessages: true, debounceSeconds: 6, minTypingMs: 1800, maxTypingMs: 5200, proactiveMinDelaySec: 45, proactiveMaxDelaySec: 110, dailyProactiveLimit: 25 },
  humanHandoff: { pauseOnOwnerReply: true, pauseDurationMinutes: 60, ownerPersonalWhatsapp: '5586988887777', notifyOwnerOnHandoff: true },
  schedule: { mode: 'business_hours_only', startHour: '08:00', endHour: '18:00', offHoursReplyMessage: 'Volto já' },
  branding: { systemName: 'Ienvia' }, waSlots: {} };
const waState = { status: 'connected', botEnabled: true, maxWaSlots: 3, connectedCount: 2, workerOnline: true, workerVersion: '5.8.28', workerPlatform: 'VPS Linux',
  slots: { slot_1: { id: 'slot_1', label: 'Comercial', status: 'connected', phone: '5586999998888', aiEnabled: true },
           slot_2: { id: 'slot_2', label: 'Suporte', status: 'connected', phone: '5586977776666', aiEnabled: true },
           slot_3: { id: 'slot_3', label: 'Chip 3', status: 'disconnected', aiEnabled: false } }, devices: [] };
const contacts = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: 'c' + i, phone: '5586999' + i, stage: 'aguardando_humano', name: 'Cliente ' + (i + 1), lastMessage: 'oi, ainda tem?' })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: 'd' + i, phone: '5587999' + i, stage: 'novo', name: 'Lead ' + (i + 1), lastMessage: 'quanto custa?' })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: 'e' + i, phone: '5588999' + i, stage: 'em_conversa', name: 'Conversa ' + (i + 1), lastMessage: 'fechado' })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: 'f' + i, phone: '5589999' + i, stage: 'negociando', name: 'Negociando ' + (i + 1), lastMessage: 'vou pensar' })),
  ...Array.from({ length: 1 }, (_, i) => ({ id: 'g' + i, phone: '5580999' + i, stage: 'fechado', name: 'Fechado ' + (i + 1), lastMessage: 'pago' }))];
const stats = { totalIncoming: 148, totalAiReplies: 96, totalAudiosProcessed: 24, totalImagesProcessed: 12, totalMediaSent: 31, totalPixSent: 8 };
const agora = Date.now();
const logs = ['IA respondeu Lizandro — chip Comercial', 'Follow-up automático enviado', 'Chave Gemini #2 em uso', 'Contato movido para Negociando',
  'Áudio transcrito em 1,2s', 'PIX enviado para Ana Paula', 'Novo lead salvo no CRM', 'Alerta de handoff no seu WhatsApp']
  .map((m, i) => ({ timestamp: new Date(agora - i * 180000).toISOString(), type: 'info', message: m }));
const campanhas = [{ campanha_id: '1', nome: 'Reativação outubro', status: 'ativa', proxima_acao_em: new Date(agora + 36e5).toISOString() },
  { campanha_id: '2', nome: 'Black Friday', status: 'ativa', proxima_acao_em: new Date(agora + 72e5).toISOString() },
  { campanha_id: '3', nome: 'Boas-vindas', status: 'ativa', proxima_acao_em: new Date(agora + 18e5).toISOString() },
  { campanha_id: '4', nome: 'Pós-venda', status: 'pausada' }];
const bootstrap = { appVersion: '5.8.28', runtimeMode: 'vercel_cloud',
  currentUser: { id: 'u1', name: 'Lizandro', role: 'master', email: 'l@ienvia.com' }, waState,
  proactiveQueueState: { running: true, paused: false, channelMode: 'auto_rotate', remaining: 42, sentSession: 18, dailySent: 18, dailyLimit: 25 },
  audioEngineReady: true, settings, geminiPoolCount: 3, business: { name: 'Ienvia' }, templates: [], trainingPacks: [], contacts, stats, logs, simulatorHistory: [] };

const app = express();
app.use(express.static(path.join(RAIZ, 'public')));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/bootstrap') return res.json(bootstrap);
  if (req.path === '/api/auth/status') return res.json({ authenticated: true, user: bootstrap.currentUser, pinRequired: false });
  if (req.path === '/api/public/version') return res.json({ version: '5.8.28' });
  if (req.path === '/api/campaigns') return res.json({ ok: true, campanhas });
  return res.json({ ok: true, settings, waState, saved: true });
});
const painel = fs.readFileSync(path.join(RAIZ, 'public', 'painel.html'), 'utf8');
const versaoAntiga = painel.replace(/<section id="tab-dashboard"[\s\S]*?<\/section>/, antigoDash);
app.get('/__antes', (_q, res) => res.type('html').send(versaoAntiga));

const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const destino = path.join(RAIZ, '..', 'antes-depois');
fs.mkdirSync(destino, { recursive: true });

async function foto(url, arquivo) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 2400 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('zapia_cloud_auth', JSON.stringify({ accessToken: 'S', user: { id: 'u1', name: 'Lizandro', role: 'master' } }));
    sessionStorage.setItem('zapia_pin', '1234');
    window.IENVIA_PAGINA = 'dashboard';
  });
  await ctx.route('**/*', (r) => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.locator('#tab-dashboard').screenshot({ path: path.join(destino, arquivo) });
  const altura = Math.round((await page.locator('#tab-dashboard').boundingBox()).height);
  await ctx.close();
  return altura;
}

const h1 = await foto(base + '/__antes', '1-antes-inicio-conexao.png');
const h2 = await foto(base + '/painel.html', '2-depois-visao-geral.png');
console.log('antes:', h1, 'px | depois:', h2, 'px');
await browser.close();
await new Promise((r) => server.close(r));

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3000';
const OUT = '/home/user/atendente-ia-whatsapp/screenshots';

const TABS = [
  { id: 'dashboard', label: '01-Inicio' },
  { id: 'crm', label: '02-Conversas' },
  { id: 'campanhas', label: '03-Campanhas' },
  { id: 'treinamento', label: '04-Treinamento' },
  { id: 'audios', label: '05-Audios' },
  { id: 'catalogo', label: '06-Catalogo-PIX' },
  { id: 'simulador', label: '07-Simulador' },
  { id: 'ia', label: '08-Motor-IA' },
  { id: 'seguranca', label: '09-Seguranca' },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shotDesktop(tab) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => { window.switchTab && window.switchTab(t); }, tab.id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${tab.label}-desktop.png`, fullPage: false });
  await ctx.close();
}

async function shotMobile(tab) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => { window.switchTab && window.switchTab(t); }, tab.id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${tab.label}-mobile.png`, fullPage: false });
  await ctx.close();
}

async function shotSidebar(tab) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => { window.switchTab && window.switchTab(t); }, tab.id);
  await page.waitForTimeout(1000);
  // Take screenshot with focus on sidebar by clipping
  const sidebar = await page.$('.sidebar') || await page.$('aside');
  if (sidebar) {
    await sidebar.screenshot({ path: `${OUT}/${tab.label}-sidebar.png` });
  }
  await ctx.close();
}

console.log('Starting screenshots...');
for (const tab of TABS) {
  console.log(`Capturing ${tab.label}...`);
  try { await shotSidebar(tab); } catch(e) { console.log('sidebar err', e.message); }
  try { await shotDesktop(tab); } catch(e) { console.log('desktop err', e.message); }
  try { await shotMobile(tab); } catch(e) { console.log('mobile err', e.message); }
}
console.log('Done!');
await browser.close();

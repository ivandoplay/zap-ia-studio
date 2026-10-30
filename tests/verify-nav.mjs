import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

const TABS = [
  { id: 'dashboard', expectedHub: 'dashboard', expectedTitle: 'Início' },
  { id: 'crm', expectedHub: 'crm', expectedTitle: 'Conversas' },
  { id: 'campanhas', expectedHub: 'config', expectedTitle: 'Ajustes' },
  { id: 'treinamento', expectedHub: 'cerebro', expectedTitle: 'Atendente' },
  { id: 'audios', expectedHub: 'cerebro', expectedTitle: 'Atendente' },
  { id: 'catalogo', expectedHub: 'cerebro', expectedTitle: 'Atendente' },
  { id: 'simulador', expectedHub: 'cerebro', expectedTitle: 'Atendente' },
  { id: 'ia', expectedHub: 'config', expectedTitle: 'Ajustes' },
  { id: 'seguranca', expectedHub: 'config', expectedTitle: 'Ajustes' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let allOK = true;

for (const tab of TABS) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.evaluate((t) => { window.switchTab && window.switchTab(t); }, tab.id);
  await page.waitForTimeout(800);

  const result = await page.evaluate((t) => {
    const activeNav = document.querySelector('.nav-btn.active');
    const activeNavTab = activeNav ? activeNav.dataset.tab : 'NONE';
    const activeNavText = activeNav ? activeNav.textContent.trim() : 'NONE';
    
    const mobTitle = document.getElementById('mobCurrentHubTitle');
    const mobTitleText = mobTitle ? mobTitle.textContent.trim() : 'NONE';
    
    const subCerebro = document.getElementById('hubSubNavCerebro');
    const subCerebroVisible = subCerebro ? subCerebro.classList.contains('visible') : false;
    const subConfig = document.getElementById('hubSubNavConfig');
    const subConfigVisible = subConfig ? subConfig.classList.contains('visible') : false;
    
    const activeSubBtn = document.querySelector('.hub-subnav-btn.active');
    const activeSubBtnTab = activeSubBtn ? activeSubBtn.dataset.subtab : 'NONE';
    
    // Get all sidebar nav buttons text
    const navBtns = Array.from(document.querySelectorAll('.nav-btn[data-tab]')).map(b => ({
      tab: b.dataset.tab,
      text: b.textContent.trim().replace(/\s+/g, ' '),
      active: b.classList.contains('active')
    }));
    
    // Get group labels
    const groupLabels = Array.from(document.querySelectorAll('.nav-group-label')).map(g => g.textContent.trim());
    
    // Get mob-nav-btn labels
    const mobBtns = Array.from(document.querySelectorAll('.mob-nav-btn[data-mobhub]')).map(b => ({
      hub: b.dataset.mobhub,
      text: b.textContent.trim().replace(/\s+/g, ' '),
      active: b.classList.contains('active'),
      visible: b.offsetParent !== null || getComputedStyle(b).display !== 'none'
    }));
    
    return { activeNavTab, activeNavText, mobTitleText, subCerebroVisible, subConfigVisible, activeSubBtnTab, navBtns, groupLabels, mobBtns };
  }, tab);

  const checks = [];
  const ok = (name, cond) => { checks.push(`${cond ? '✓' : '✗'} ${name}`); if (!cond) allOK = false; };

  ok('active tab = ' + tab.id, result.activeNavTab === tab.id);
  ok('hub-subnav cerebro visível = ' + (tab.expectedHub === 'cerebro'), result.subCerebroVisible === (tab.expectedHub === 'cerebro'));
  ok('hub-subnav config visível = ' + (tab.expectedHub === 'config'), result.subConfigVisible === (tab.expectedHub === 'config'));
  if (result.subCerebroVisible) ok('active sub-btn = ' + tab.id, result.activeSubBtnTab === tab.id);
  if (result.subConfigVisible && tab.id !== 'campanhas') ok('active sub-btn = ' + tab.id, result.activeSubBtnTab === tab.id);

  console.log(`\n=== ${tab.id} ===`);
  console.log('  Active nav: ' + result.activeNavTab + ' ("' + result.activeNavText + '")');
  console.log('  Mob title: ' + result.mobTitleText);
  console.log('  SubCerebro visible: ' + result.subCerebroVisible + ' | SubConfig visible: ' + result.subConfigVisible);
  console.log('  Active sub-btn: ' + result.activeSubBtnTab);
  checks.forEach(c => console.log('  ' + c));
}

// Print full sidebar structure once
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);
const sidebar = await page.evaluate(() => {
  const groups = [];
  const nav = document.querySelector('.nav-menu');
  if (!nav) return { error: 'no nav-menu' };
  const children = Array.from(nav.children);
  let currentGroup = null;
  for (const child of children) {
    if (child.classList.contains('nav-group-label')) {
      currentGroup = child.textContent.trim();
      groups.push({ type: 'label', text: currentGroup });
    } else if (child.classList.contains('nav-btn')) {
      groups.push({ type: 'btn', tab: child.dataset.tab, text: child.textContent.trim().replace(/\s+/g, ' '), title: child.getAttribute('title') || '' });
    }
  }
  return { groups };
});

console.log('\n\n=== ESTRUTURA COMPLETA DA SIDEBAR ===');
for (const g of sidebar.groups) {
  if (g.type === 'label') console.log(`\n  [${g.text}]`);
  else console.log(`    - ${g.text}  (tab: ${g.tab})`);
}

console.log('\n\n=== MOBILE NAV ===');
const mobNav = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.mob-nav-btn[data-mobhub]')).map(b => ({
    hub: b.dataset.mobhub,
    text: b.textContent.trim().replace(/\s+/g, ' '),
    visible: b.style.display !== 'none' && b.offsetParent !== null
  }));
});
mobNav.forEach(b => console.log(`  - ${b.text}  (hub: ${b.hub}) ${b.visible ? '' : '[hidden]'}`));

console.log('\n\n=== RESULTADO GERAL ===');
console.log(allOK ? '✅ TODOS OS CHECKS PASSARAM' : '❌ ALGUNS CHECKS FALHARAM');

await browser.close();

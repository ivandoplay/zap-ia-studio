import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{for(const width of [1440,320]){const page=await browser.newPage({viewport:{width,height:width===320?740:1000}}),errors=[],apiRequests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))apiRequests.push(r.url());});
await page.goto('http://127.0.0.1:4183/conversas/');await page.waitForLoadState('networkidle');await page.waitForSelector('.crm-row');
if(width<800)await page.getByRole('button',{name:'Abrir conversa com Marina Costa',exact:true}).click();
await page.waitForSelector('.crm-message');await page.getByRole('button',{name:'Buscar nesta conversa',exact:true}).click();await page.getByLabel('Buscar nas mensagens carregadas',{exact:true}).fill('conjunto');
await page.screenshot({path:`/home/user/auditoria/implantacao-gradual/conversas-paridade-${width}.png`});
console.log(JSON.stringify({width,messages:await page.locator('.crm-message').count(),marks:await page.locator('mark.crm-search-hit').count(),counter:await page.locator('.crm-search-count').textContent(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors,apiRequests}));await page.close();}}
finally{await browser.close();}

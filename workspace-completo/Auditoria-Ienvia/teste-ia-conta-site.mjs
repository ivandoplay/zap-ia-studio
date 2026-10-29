import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire('/home/user/zap-ia-site-tests/package.json')('playwright');
const origin = 'https://zap-ia-studio.vercel.app';
const password = process.env.IENVIA_TEST_PASSWORD;
assert(password, 'Senha deve ser fornecida apenas em memória');
let browser;
try {
 browser = await chromium.launch({headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 const pageErrors=[]; page.on('pageerror', e=>pageErrors.push(e.message));
 const allowed = new Set(['/api/auth/login','/api/auth/refresh','/api/ai/test','/api/simulator/send']);
 await page.route('**/*', r=>{ const req=r.request();const u=new URL(req.url()); if(u.origin!==origin) return r.abort(); if(['GET','HEAD'].includes(req.method())||allowed.has(u.pathname)) return r.continue(); return r.abort(); });
 const initial=await page.goto(origin+'/painel',{waitUntil:'domcontentloaded',timeout:30000}); assert.equal(initial.status(),200);
 await page.locator('#cloudLoginScreen.open').waitFor({timeout:30000});
 await page.locator('#cloudLoginUser').fill('jeffersonivan'); await page.locator('#cloudLoginPass').fill(password);
 const loginResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login' && r.request().method()==='POST',{timeout:30000});
 await page.locator('#btnCloudLoginSubmit').click(); const login=await loginResponse;
 if(!login.ok()){ console.log('Login não aceito; HTTP',login.status()); process.exitCode=1; }
 else {
  await page.waitForFunction(()=>typeof state!=='undefined' && !!state.business && !!state.currentUser && !document.querySelector('#btnCloudLoginSubmit')?.disabled, null, {timeout:60000});
  const info=await page.evaluate(()=>({expected:state.currentUser?.id==='28f17e53-1ab8-4ec7-8556-666df0d4add6',botEnabled:state.settings?.botEnabled,history:Array.isArray(state.simulatorHistory)?state.simulatorHistory.length:null,workerOnline:state.waState?.workerOnline}));
  assert(info.expected, 'Conta divergente'); console.log('Login na conta esperada: OK; IA geral:',info.botEnabled?'ligada':'desligada','; entradas prévias no simulador:',info.history,'; motor online:',info.workerOnline===true);
  await page.locator('.nav-btn[data-tab="ia"]').click();
  const testWait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/test' && r.request().method()==='POST',{timeout:90000});
  await page.locator('#btnTestAi').click(); const t=await testWait; const tj=await t.json().catch(()=>({}));
  console.log('Teste de conexão de IA pelo painel: HTTP',t.status(),'ok:',tj.ok===true,'provedor:',tj.provider||'não informado','modelo:',tj.model||'não informado','fallback:',tj.usedFallback===true,'latência ms:',tj.latencyMs??'não informada');
  if(!t.ok()||!tj.ok){console.log('Erro teste IA:',String(tj.error||'não informado').slice(0,350));process.exitCode=1;}
  if(t.ok() && tj.ok && info.history!==null && info.history<=38){
    await page.locator('.nav-btn[data-tab="simulador"]').click();
    await page.locator('#simTextInput').fill('Olá! Como funciona seu atendimento? Estou conhecendo seu serviço.');
    const simWait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/simulator/send'&&r.request().method()==='POST',{timeout:90000});
    await page.locator('#simSendBtn').click(); const s=await simWait;const sj=await s.json().catch(()=>({}));
    console.log('Simulador real no site: HTTP',s.status(),'ok:',sj.ok===true,'provedor:',sj.reply?.providerUsed||'não informado','modelo:',sj.reply?.modelUsed||'não informado','fallback:',sj.reply?.usedFallback===true,'resposta não vazia:',Boolean(sj.reply?.text),'silêncio:',Boolean(sj.reply?.silentPauseReason||sj.reply?.courtesySilence));
    if(sj.reply?.text)console.log('Resposta do simulador:',String(sj.reply.text).slice(0,1000));
    if(!s.ok()||!sj.ok){console.log('Erro simulador:',String(sj.error||'não informado').slice(0,350));process.exitCode=1;}
  } else console.log('Simulador não alterado para preservar histórico existente.');
  console.log('Erros JavaScript não tratados:',pageErrors.length);
  if(pageErrors.length)process.exitCode=1;
 }
 await page.close();
} catch(e){ console.log('Teste interrompido:',e.message);process.exitCode=1; }
finally { if(browser)await browser.close(); }

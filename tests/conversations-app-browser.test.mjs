import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import path from 'node:path';import {chromium} from 'playwright';
// Caixa de entrada nova ligada em DADOS REAIS (/api/conversations-v3).
// Mantém os invariantes de segurança da tela: GET-only, nada inventado, XSS neutro,
// troca de escopo derruba os dados e pagehide limpa a tela.
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');const app=express();app.get('/conversas/',(_q,r)=>{r.setHeader('Cache-Control','no-store, private');r.sendFile(path.resolve('public/v2/conversations.html'));});app.use(express.static('public'));const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,args:['--no-sandbox']});test.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});

const OWNER='11111111-1111-4111-8111-111111111111',INSTANCE='00000000-0000-4000-8000-000000000001';
const instances={ok:true,schemaVersion:1,viewer:{id:OWNER,role:'master',displayName:'Operador real'},tenant:{id:OWNER,displayName:'Conta real'},source:'legacy_contacts',features:{crmProfilesRead:false},items:[{id:INSTANCE,slotId:'slot_1',name:'Chip 1',transport:'local_worker',crmVisible:true,connection:'connected',aiEnabled:true,threads:1,unread:0,lastMessageAt:'2026-11-04T12:00:00Z'}],total:1,hasMore:false,nextCursor:null};
const thread={id:encodeURIComponent('558600000002@s.whatsapp.net'),chatId:'558600000002@s.whatsapp.net',name:'Contato Real',phoneMasked:'+5586****02',identityKind:'verified_pn',peerJid:'558600000002@s.whatsapp.net',createdAt:'2026-11-03T12:00:00Z',preview:'Mensagem real',previewRole:'user',messageCount:1,unread:0,pinned:false,archived:false,aiEnabled:true,needsHuman:false,paused:null,hot:false,followUp:false,stage:'em_atendimento',company:'Autocon',city:'Fortaleza',email:'',tags:[],dealStatus:'open',dealValue:0,lastMessageAt:'2026-11-04T12:00:00Z',originIds:[INSTANCE]};
const threads={ok:true,schemaVersion:1,instanceId:INSTANCE,slotId:'slot_1',source:'legacy_contacts',counts:{total:1,inbox:1,archived:0,unread:0,human:0,pinned:0},items:[thread],total:1,hasMore:false,nextCursor:null};
const message={id:'m1',role:'user',fromMe:false,text:'<img src=x onerror="window.__bad=true"> Histórico real',at:'2026-11-04T12:00:00Z',ack:null,media:null,internal:false,deleted:false,origins:[{instanceId:INSTANCE,name:'Chip 1',crmVisible:true}]};
const messages={ok:true,schemaVersion:1,source:'legacy_contacts',conversation:{...thread,name:'Contato Real',messageCount:1},messages:[message],total:1,hasMore:false,nextBefore:null};

async function open(handler,catalogHandler=null){const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage(),errors=[],calls=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('zapia_cloud_auth',JSON.stringify({accessToken:'synthetic-session'})));await p.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());calls.push({path:url.pathname,method:req.method(),auth:req.headers().authorization});const respond=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});if(url.pathname==='/api/auth/status')return respond({ok:true,cloudLoginRequired:false});if(url.pathname==='/api/conversations-v3/instances')return respond(catalogHandler?catalogHandler(url):instances);return handler(route,respond,url);});await p.goto(base+'/conversas/');await p.waitForSelector('select[aria-label="Instância para consultar conversas"]');return {p,calls,errors,async close(){await ctx.close();},async closeOk(){assert.deepEqual(errors,[]);assert.ok(calls.every(c=>c.method==='GET'&&c.auth==='Bearer synthetic-session'));await ctx.close();}};}

test('conversas reais: abre na instância da conta, GET-only, sem metadata inventada, XSS neutro',async()=>{const f=await open((_route,respond,url)=>respond(url.pathname.endsWith('/messages')?messages:threads));try{const p=f.p;await p.waitForSelector('.crm-row');
 // A primeira instância real é selecionada automaticamente: nenhuma caixa vazia sem explicação.
 assert.equal(await p.getByLabel('Instância para consultar conversas',{exact:true}).inputValue(),INSTANCE);
 assert.equal(await p.locator('.crm-row').count(),1);
 assert.match(await p.locator('.crm-row').textContent(),/Contato Real/);
 // Nada de contadores inventados quando a origem não manda "não lidas".
 assert.equal(await p.locator('.crm-row .crm-unread').count(),0);
 await p.locator('.crm-row').click();await p.waitForSelector('.crm-message');
 // A conversa real agora tem composer de envio, mas nenhuma simulação/anexo fictício.
 assert.equal(await p.locator('.crm-product,.crm-simulation-label').count(),0);
 assert.equal(await p.locator('textarea#crm-composer').count(),1);
 assert.equal(await p.getByRole('button',{name:'Enviar mensagem',exact:true}).count(),1);
 assert.match(await p.locator('.crm-messages').textContent(),/<img src=x/);
 assert.equal(await p.locator('img[src=x]').count(),0);
 assert.equal(await p.evaluate(()=>window.__bad),undefined);
 if(!await p.locator('.crm-profile').count())await p.getByRole('button',{name:'Dados do contato',exact:true}).click();
 // A ficha mostra o cadastro real que veio da API.
 assert.match(await p.locator('.crm-profile').textContent(),/Autocon/);
 await p.getByRole('button',{name:'Fechar dados do contato',exact:true}).click();
 await p.getByRole('button',{name:'Mais opções da conversa',exact:true}).click();
 // Escrita liberada na conversa real: o menu oferece os comandos reais.
 assert.equal(await p.getByRole('button',{name:'Fixar conversa',exact:true}).isDisabled(),false);
 assert.equal(await p.getByRole('button',{name:'Editar ficha do contato',exact:true}).count(),1);
 await p.keyboard.press('Escape');
 // Nenhuma rota proibida é chamada.
 const proibidas=/\/(contacts|bootstrap|evolution|whatsapp|send|connect)(\/|$|\?)/;
 assert.ok(!f.calls.some(c=>proibidas.test(c.path+'?')),'rotas proibidas: '+f.calls.map(c=>c.path).join(','));
 assert.ok(f.calls.every(c=>c.path.startsWith('/api/conversations-v3')||c.path==='/api/auth/status'),'somente a origem real de conversas');
 assert.ok(f.calls.every(c=>c.method==='GET'));
}finally{await f.close();}});

test('conversas reais: falha da origem é erro explícito, nunca caixa vazia',async()=>{const f=await open((_route,respond)=>respond({ok:false,error:'Origem de conversas indisponível agora.',code:'CONVERSATIONS_UNAVAILABLE'},503));try{const p=f.p;await p.getByRole('heading',{name:'Não foi possível abrir a caixa',exact:true}).waitFor();assert.match(await p.locator('.crm-list').textContent(),/indisponível agora/);assert.equal(await p.locator('.crm-row,.crm-message').count(),0);assert.doesNotMatch(await p.locator('.crm-list').textContent(),/Sua caixa está em dia/);}finally{await f.close();}});

test('conversas reais: troca de contexto derruba os dados e pagehide limpa a tela',async()=>{let release,notify;const ready=new Promise(r=>notify=r);const f=await open(async(_route,respond,url)=>{if(!url.pathname.endsWith('/messages'))return respond(threads);await new Promise(r=>{release=r;notify();});return respond(messages);});try{const p=f.p;await p.locator('.crm-row').click();await ready;await p.evaluate(()=>sessionStorage.setItem('zapia_pin','synthetic-new-context'));release();await p.getByRole('heading',{name:'Reabra as conversas pelo painel',exact:true}).waitFor();assert.equal(await p.locator('.crm-row,.crm-message,.crm-profile').count(),0);assert.doesNotMatch(await p.locator('body').textContent(),/Operador real|Conta real|Histórico real/);await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.doesNotMatch(await p.locator('body').textContent(),/Conta real/);}finally{release?.();await f.close();}});

test('conversas reais: pagina conversas e mensagens sem duplicar',async()=>{
 const uid=n=>`77777777-7777-4777-8777-${String(n).padStart(12,'0')}`;
 const allThreads=Array.from({length:23},(_,i)=>({...thread,id:uid(i+101),chatId:`558600000${String(i+2).padStart(3,'0')}@s.whatsapp.net`,name:`Conversa real ${i+1}`}));
 const allMessages=Array.from({length:26},(_,i)=>({...message,id:uid(i+201),text:'Mensagem preservada '+i}));
 const f=await open((_route,respond,url)=>{
  if(url.pathname.endsWith('/messages')){const more=url.searchParams.has('before');return respond({...messages,messages:more?allMessages.slice(0,6):allMessages.slice(6),hasMore:!more,nextBefore:more?null:allMessages[6].at});}
  const offset=Number(url.searchParams.get('offset')||0);return respond({...threads,items:allThreads.slice(offset,offset+20),total:allThreads.length,hasMore:offset+20<allThreads.length});
 });try{const p=f.p;await p.waitForSelector('.crm-row');
  assert.equal(await p.locator('.crm-row').count(),20);
  await p.getByRole('button',{name:'Carregar mais conversas',exact:true}).click();
  await p.waitForFunction(()=>document.querySelectorAll('.crm-row').length===23);
  await p.locator('.crm-row').first().click();await p.waitForSelector('.crm-message');
  assert.equal(await p.locator('.crm-message').count(),20);
  await p.getByRole('button',{name:'Carregar mais mensagens',exact:true}).click();
  await p.waitForFunction(()=>document.querySelectorAll('.crm-message').length===26);
  assert.equal(new Set(await p.locator('.crm-message').evaluateAll(rows=>rows.map(r=>r.dataset.messageId))).size,26);
 }finally{await f.close();}
});

test('paridade CRM autenticado: Contatos não inventa agenda quando a projeção é inválida',async()=>{
 const f=await open((_route,respond,url)=>respond(url.pathname.endsWith('/messages')?messages:threads));try{
  const p=f.p;await p.locator('.hub-tabs').getByRole('button',{name:'Contatos',exact:true}).click();
  await p.getByRole('heading',{name:'Agenda de contatos',exact:true}).waitFor({timeout:1500});
  await p.locator('.hub-alternate').getByText(/Não foi possível validar/).waitFor();
  assert.equal(await p.locator('.hub-contact-card, .crm-dialog, textarea').count(),0);
  await p.getByRole('button',{name:'Voltar às conversas',exact:true}).click();
  assert.equal(await p.locator('.hub-tabs [data-view=inbox]').getAttribute('aria-pressed'),'true');
 }finally{await f.close();}
});

test('paridade CRM autenticado: busca literal não revela corpo omitido/excluído nem faz consultas extras',async()=>{
 const privateMessages=[message,{...message,id:'66666666-6666-4666-8666-666666666666',text:'SEGREDO_OMITIDO_2026',media:{mime:'privacy_omitted/omitted'}},{...message,id:'77777777-7777-4777-8777-777777777777',text:'',deleted:true}];
 const f=await open((_route,respond,url)=>respond(url.pathname.endsWith('/messages')?{...messages,messages:privateMessages}:threads));try{
  const p=f.p;await p.waitForSelector('.crm-row');await p.locator('.crm-row').click();await p.waitForSelector('.crm-message');const calls=f.calls.length;
  await p.getByRole('button',{name:'Buscar nesta conversa',exact:true}).click();const input=p.getByLabel('Buscar nas mensagens carregadas',{exact:true});
  await input.fill('<img src=x');assert.equal(await p.locator('mark.crm-search-hit').count(),1);assert.equal(await p.locator('img[src=x]').count(),0);assert.equal(await p.evaluate(()=>window.__bad),undefined);
  for(const q of ['SEGREDO_OMITIDO_2026','.*']){await input.fill(q);assert.equal(await p.locator('mark.crm-search-hit').count(),0);assert.equal(await p.locator('.crm-message').count(),3);}
  assert.doesNotMatch(await p.locator('.crm-messages').textContent(),/SEGREDO_OMITIDO/);assert.equal(f.calls.length,calls);assert.equal(await p.locator('.crm-product').count(),0);
 }finally{await f.close();}
});

// Diagnóstico manual: nenhum segredo gravado ou impresso; sem conexão WhatsApp.
import assert from 'node:assert/strict';
process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';
const base='https://zap-ia-studio.vercel.app';
try {
 const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'jeffersonivan',password:process.env.IENVIA_PASSWORD}),signal:AbortSignal.timeout(25000)});
 const auth=await login.json();assert(login.ok&&auth.ok&&auth.user?.id==='28f17e53-1ab8-4ec7-8556-666df0d4add6','Login/identidade não confirmados');
 const bootstrap=await fetch(`${base}/api/bootstrap`,{headers:{Authorization:`Bearer ${auth.session.accessToken}`},signal:AbortSignal.timeout(45000)});
 const data=await bootstrap.json();assert(bootstrap.ok&&data.business&&data.settings?.ai?.geminiApiKey,'Configuração da conta não confirmada');
 const {generateSmartReply}=await import('/home/user/atendente-ia-whatsapp/src/aiEngine.js');
 const start=Date.now();const out=await generateSmartReply({profile:data.business,settings:data.settings,history:[],userText:'Olá! Explique brevemente como funciona seu atendimento.',contactName:'Teste de laboratório',allowDemoFallback:false});
 console.log('IA em laboratório, com configuração real: resposta não vazia:',Boolean(out.cleanText),'provedor:',out.providerUsed,'modelo:',out.modelUsed,'fallback:',Boolean(out.usedFallback),'tempo ms:',Date.now()-start);
 assert(out.cleanText && out.providerUsed !== 'demo_local','Não houve resposta generativa');
} catch(e) { console.log('Diagnóstico não concluiu: categoria',e?.name||'Error','; código/status:',String(e?.status||e?.code||'não informado'));process.exitCode=1; }

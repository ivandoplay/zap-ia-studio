import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL='1';
process.env.ZAPIA_ISOLATED_TEST='1';
const {storage}=await import('../src/storage.js');
const {generateSmartReply}=await import('../src/aiEngine.js');

test('motor usa o orçamento ampliado na chamada Gemini real mockada',async()=>{
 const originalFetch=globalThis.fetch, originalSetTimeout=globalThis.setTimeout, timers=[];
 globalThis.setTimeout=function(fn,ms,...rest){timers.push(ms);return originalSetTimeout(fn,ms,...rest)};
 globalThis.fetch=async (url)=>{
   assert.match(String(url),/generativelanguage\.googleapis\.com/);
   return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'Olá! Como posso ajudar?'}]},finishReason:'STOP'}]}),{status:200,headers:{'content-type':'application/json'}});
 };
 try {
  const profile=storage.getBusiness();
  const saida=await generateSmartReply({profile,settings:{ai:{provider:'gemini',geminiApiKey:'chave-ficticia-1234567890',geminiModel:'gemini-3.5-flash-lite',autoFallbackProvider:'none'}},history:[],userText:'Olá, quero entender o serviço',contactName:'Teste'});
  assert.equal(saida.providerUsed,'gemini');assert.ok(saida.cleanText);assert.ok(timers.includes(35000),`Tempo da tentativa deve permitir 35s; timers: ${timers.join(',')}`);
 } finally {globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;}
});

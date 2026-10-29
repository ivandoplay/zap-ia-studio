import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL='1';process.env.ZAPIA_ISOLATED_TEST='1';
const engine=await import('../src/aiEngine.js');
test('usa o provedor configurado para gerar o conjunto em uma chamada sintética',async()=>{
 assert.equal(typeof engine.gerarVariacoesParaCampanha,'function');
 const fetchOriginal=globalThis.fetch;let chamadas=0;
 globalThis.fetch=async url=>{chamadas++;assert.match(String(url),/generativelanguage\.googleapis\.com/);return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'["Oi {{nome}}","Olá, {{nome}}"]'}]},finishReason:'STOP'}]}),{status:200,headers:{'content-type':'application/json'}})};
 try{
  const out=await engine.gerarVariacoesParaCampanha({settings:{ai:{provider:'gemini',geminiApiKey:'chave-ficticia-1234567890',geminiModel:'gemini-3.5-flash-lite'}},texto:'Olá {{nome}}',quantidade:2});
  assert.equal(out.ok,true);assert.equal(out.variacoes.length,2);assert.equal(chamadas,1);
 }finally{globalThis.fetch=fetchOriginal;}
});

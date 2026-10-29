import test from 'node:test';
import assert from 'node:assert/strict';
import {gerarVariacoesCampanha} from '../src/campanhaIA.js';

test('gera todo o conjunto em uma única chamada e preserva campos personalizados',async()=>{
 let chamadas=0;const r=await gerarVariacoesCampanha({texto:'Olá {{nome}}, conheça {{produto}}.',quantidade:2,chamar:async({systemPrompt,userText})=>{
  chamadas++;assert.match(systemPrompt,/JSON/);assert.match(userText,/{{nome}}/);
  return '```json\n["Oi {{nome}}, veja {{produto}}.","Olá {{nome}}, conheça {{produto}} hoje."]\n```';
 }});
 assert.equal(chamadas,1);assert.deepEqual(r,{ok:true,variacoes:['Oi {{nome}}, veja {{produto}}.','Olá {{nome}}, conheça {{produto}} hoje.']});
});
test('prompt personalizado é incluído, mas a resposta continua sujeita às validações',async()=>{
 let recebido='';const r=await gerarVariacoesCampanha({texto:'Olá',quantidade:2,prompt:'Use tom cordial',chamar:async x=>{recebido=x.userText;return '["Bom dia","Olá, tudo bem?"]'}});
 assert.equal(r.ok,true);assert.match(recebido,/Use tom cordial/);
});
test('falha não usa original automaticamente: oferece tentativa ou uso consciente',async()=>{
 for(const chamar of [async()=>{throw Error('falha de provedor')},async()=>'{não é JSON}',async()=>'["Sem nome","Outra"]',async()=>'["Oi {{nome}}","Oi {{nome}}"]']){
  const r=await gerarVariacoesCampanha({texto:'Olá {{nome}}',quantidade:2,chamar});
  assert.equal(r.ok,false);assert.equal(r.codigo,'falha_geracao');assert.deepEqual(r.opcoes,['tentar_novamente','usar_original']);assert.equal(r.variacoes,undefined);
 }
});
test('rejeita parâmetros excessivos sem chamar serviço externo',async()=>{
 let chamadas=0;const chamar=async()=>{chamadas++;return '[]'};
 await assert.rejects(()=>gerarVariacoesCampanha({texto:'a',quantidade:0,chamar}),/quantidade/i);
 await assert.rejects(()=>gerarVariacoesCampanha({texto:'x'.repeat(5001),quantidade:2,chamar}),/texto/i);
 assert.equal(chamadas,0);
});

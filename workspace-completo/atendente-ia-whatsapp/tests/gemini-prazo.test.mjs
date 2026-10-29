import test from 'node:test';
import assert from 'node:assert/strict';
import { executarGeminiLimitado } from '../src/geminiPrazo.js';

test('permite resposta lenta de 31 segundos antes de abortar',async()=>{
 let agora=0;const saida=await executarGeminiLimitado({chaves:['segredo1'],modelos:['principal'],prazoMs:38000,agora:()=>agora,invocar:async({timeoutMs})=>{assert.equal(timeoutMs,35000);agora+=31000;return 'resposta';}});
 assert.equal(saida.texto,'resposta');assert.equal(saida.modelo,'principal');
});
test('troca de modelo rapidamente para erro recuperável e respeita o prazo restante',async()=>{
 let agora=0;const visitas=[];
 const out=await executarGeminiLimitado({chaves:['k'],modelos:['primeiro','segundo'],prazoMs:38000,agora:()=>agora,invocar:async({modelo,timeoutMs})=>{visitas.push([modelo,timeoutMs]);if(modelo==='primeiro'){agora+=32000;const e=new Error('not_found');e.status=404;throw e;}agora+=1000;return 'ok';}});
 assert.equal(out.texto,'ok');assert.deepEqual(visitas,[['primeiro',35000],['segundo',6000]]);
});
test('não tenta nova chave ou modelo após esgotar o prazo',async()=>{
 let agora=0,n=0;
 await assert.rejects(()=>executarGeminiLimitado({chaves:['a','b'],modelos:['1','2'],prazoMs:38000,agora:()=>agora,invocar:async()=>{n++;agora=38000;throw new Error('timeout');}}),/timeout/i);
 assert.equal(n,1);
});
test('erro permanente encerra sem repetir e chaves não são exibidas',async()=>{
 let n=0;await assert.rejects(()=>executarGeminiLimitado({chaves:['segredo'],modelos:['a','b'],invocar:async()=>{n++;throw new Error('erro permanente');}}),/erro permanente/);assert.equal(n,1);
});

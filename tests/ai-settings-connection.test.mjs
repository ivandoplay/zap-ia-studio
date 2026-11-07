import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAiSettingsRouter } from '/home/user/repo/src/ai-settings/router.js';

const owner='11111111-1111-4111-8111-111111111111';
function montar({testeConexao=null,allow=true}={}){
  const app=express();
  const vistos=[];
  app.use('/api/ai-settings-v2',createAiSettingsRouter({
    getLocalContext:async()=>({viewer:{id:owner,role:'master'},tenant:{id:owner},mode:'vercel_cloud',data:{settings:{botEnabled:true,ai:{provider:'gemini',providerMode:'auto',geminiApiKey:'chave-no-workspace-123456'}},stats:{}}}),
    repository:{read:async()=>null,save:async()=>({revision:1})},
    vault:null,
    allowWrites:true,allowSecretWrites:false,
    allowConnectionTest:allow,
    testConnection: testeConexao ? async (x)=>{vistos.push(x);return testeConexao(x);} : null
  }));
  return {app,vistos};
}
const pedir=(app,metodo,caminho)=>new Promise(res=>{
  const srv=app.listen(0,'127.0.0.1',()=>{
    const p=srv.address().port;
    const r=http.request({host:'127.0.0.1',port:p,path:caminho,method:metodo,headers:{'Content-Type':'application/json'}},(x)=>{
      let t='';x.on('data',c=>t+=c);x.on('end',()=>{srv.close();res({status:x.statusCode,body:t});});
    });
    if(metodo!=='GET')r.write('{}');
    r.end();
  });
});

test('sem motor configurado, o teste de conexão continua fechado',async()=>{
  const {app}=montar({allow:false});
  const r=await pedir(app,'POST','/api/ai-settings-v2/test');
  assert.equal(r.status,503);
  const cap=JSON.parse((await pedir(app,'GET','/api/ai-settings-v2')).body).capabilities;
  assert.equal(cap.canTestConnection,false);
});

test('com motor, testa de verdade e nunca devolve a chave',async()=>{
  const {app,vistos}=montar({testeConexao:()=>({provider:'gemini',model:'gemini-2.0-flash',keyPoolSize:1,usedFallback:false,sampleReply:'Online e pronto.'})});
  const cap=JSON.parse((await pedir(app,'GET','/api/ai-settings-v2')).body).capabilities;
  assert.equal(cap.canTestConnection,true,'a capacidade acompanha o motor injetado');
  const r=await pedir(app,'POST','/api/ai-settings-v2/test');
  assert.equal(r.status,200);
  const d=JSON.parse(r.body);
  assert.equal(d.kind,'connection_test');
  assert.equal(d.connectionTested,true);
  assert.equal(d.provider,'gemini');
  assert.equal(d.sampleReply,'Online e pronto.');
  assert.ok(Number.isFinite(d.latencyMs));
  assert.equal(vistos.length,1,'o motor foi chamado uma vez');
  assert.equal(vistos[0].settings.ai.geminiApiKey,'chave-no-workspace-123456','usa a chave salva');
  assert.doesNotMatch(r.body,/chave-no-workspace|123456/,'a chave não volta na resposta');
});

test('falha do provedor não vira sucesso nem ecoa a chave',async()=>{
  const {app}=montar({testeConexao:()=>{throw new Error('401 chave recusada pela API');}});
  const r=await pedir(app,'POST','/api/ai-settings-v2/test');
  assert.equal(r.status,400);
  const d=JSON.parse(r.body);
  assert.equal(d.ok,false);
  assert.doesNotMatch(r.body,/chave-no-workspace/);
});

test('conta sem nenhuma chave recebe erro declarado, não falso positivo',async()=>{
  const app=express();
  app.use('/api/ai-settings-v2',createAiSettingsRouter({
    getLocalContext:async()=>({viewer:{id:owner,role:'master'},tenant:{id:owner},mode:'vercel_cloud',data:{settings:{botEnabled:true,ai:{provider:'gemini',providerMode:'auto'}},stats:{}}}),
    repository:{read:async()=>null},vault:null,allowWrites:true,allowConnectionTest:true,
    testConnection:async()=>{throw Error('nunca deveria ser chamado');}
  }));
  const r=await pedir(app,'POST','/api/ai-settings-v2/test');
  assert.equal(r.status,400,'sem chave é erro declarado, não conexão aprovada');
});

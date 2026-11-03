import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEvolutionWebhookRouter } from '../src/evolutionApiWebhook.js';
import { evolutionInstanceIdentity, evolutionBoolean } from '../src/evolutionIdentity.js';
import { normalizeEvolutionEvent } from '../src/crmV2/evolutionEvent.js';
import { ingestEvolutionWebhook } from '../src/crmV2/eventIngress.js';
import { requireEvolutionMessageId } from '../src/evolutionApiResponse.js';
const owner='11111111-1111-4111-8111-111111111111',secret='segredo-sintetico-apenas-testes';
const env={EVOLUTION_WEBHOOK_SECRET:secret,EVOLUTION_API_KEY:'synthetic-key',EVOLUTION_DEFAULT_USER_ID:owner,SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
let contacts=new Map(),events=new Set(),sends=0,aiCalls=0,failRead=false,failSave=false,failSend=false,slotEnabled=true,botEnabled=true;
const admin={from(table){return {select(){return this},eq(){return this},async maybeSingle(){if(failRead)return {error:{message:'synthetic'}};return {data:table==='zapia_users'?{is_active:true,max_wa_slots:3}:table==='zapia_workspaces'?{business:{},settings:{botEnabled,ignoredContacts:[]}}:{ai_enabled:slotEnabled}}}}},async rpc(name,args){
 assert.equal(name,'ienvia_merge_evolution_contact');if(failSave)return {error:{message:'synthetic'}};
 const scope=`${args.p_owner}:${args.p_chat}`,k=`${scope}:${args.p_event}`,inserted=!args.p_event||!events.has(k);
 if(args.p_event)events.add(k);const contact=contacts.get(scope)||{messages:[]};
 for(const m of args.p_messages){const old=contact.messages.find(x=>x.id===m.id||x.waMsgId===m.waMsgId);if(old)Object.assign(old,m);else contact.messages.push({...m});}
 Object.assign(contact,args.p_patch);contacts.set(scope,contact);return {data:{inserted,contact},error:null};
}};
const app=express();app.use(createEvolutionWebhookRouter({env,adminClient:()=>admin,replyGenerator:async()=>{aiCalls++;return {cleanText:'Resposta sintética',actions:{}}},fetcher:async(_url,options)=>{sends++;assert.ok(options.signal);assert.equal(options.redirect,'error');if(failSend)throw new Error('timeout');return {ok:true,text:async()=>JSON.stringify({key:{id:`out-${sends}`}})}}}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));test.after(()=>new Promise(r=>server.close(r)));
const base=`http://127.0.0.1:${server.address().port}`;
function payload(id='in-1',extra={}){return {event:'messages.upsert',instance:'zap-ia-slot_1',data:{key:{remoteJid:'558600000001@s.whatsapp.net',id,fromMe:false},message:{conversation:'Olá teste'},messageTimestamp:1793707200,...extra}};}
async function post(body,token=secret){const r=await fetch(base+'/webhook',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-ienvia-webhook-secret':token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
test.beforeEach(()=>{contacts=new Map();events=new Set();sends=aiCalls=0;failRead=failSave=failSend=false;slotEnabled=botEnabled=true});
test('webhook rejeita segredo ausente/incorreto e instância desconhecida sem chamar banco/IA/envio',async()=>{
 assert.equal((await post(payload(),null)).status,401);assert.equal((await post(payload(),'errado')).status,401);
 assert.equal((await post({...payload(),instance:'desconhecida'})).status,403);assert.equal(sends,0);assert.equal(aiCalls,0);assert.equal(contacts.size,0);
});
test('duas notificações concorrentes têm uma única resposta; entrada é persistida antes da IA',async()=>{
 const [a,b]=await Promise.all([post(payload()),post(payload())]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(sends,1);assert.equal(aiCalls,1);
 assert.ok([a,b].some(x=>x.body.duplicate));assert.equal([...contacts.values()][0].messages.filter(x=>x.role==='user').length,1);
});
test('string false representa mensagem recebida e wrappers efêmeros são interpretados',async()=>{
 const r=await post(payload('wrapped',{key:{id:'wrapped',remoteJid:'558600000001@s.whatsapp.net',fromMe:'false'},message:{ephemeralMessage:{message:{conversation:'Texto efêmero'}}}}));
 assert.equal(r.body.accepted,true);assert.equal(aiCalls,1);assert.equal(evolutionBoolean('false'),false);
 const [e]=normalizeEvolutionEvent(payload('e',{key:{id:'e',remoteJid:'558600000001@s.whatsapp.net',fromMe:'false'}}));assert.equal(e.fromMe,false);
});
test('falha do Supabase antes da persistência retorna 503 e não envia',async()=>{
 failSave=true;assert.equal((await post(payload())).status,503);assert.equal(sends,0);failSave=false;failRead=true;assert.equal((await post(payload())).status,503);assert.equal(sends,0);
});
test('timeout após gravação preserva entrada/saída incerta e não repete o envio',async()=>{
 failSend=true;const a=await post(payload());assert.equal(a.status,200);assert.equal(a.body.replyUncertain,true);
 assert.equal([...contacts.values()][0].messages.find(x=>x.role==='assistant').deliveryStatus,'uncertain');
 const b=await post(payload());assert.equal(b.body.duplicate,true);assert.equal(sends,1);
});
test('respeita switch por chip, bot global, pausa de contato e opt-out antes da IA',async()=>{
 slotEnabled=false;await post(payload('a'));assert.equal(sends,0);slotEnabled=true;botEnabled=false;await post(payload('b'));assert.equal(aiCalls,0);botEnabled=true;
 const r=await post(payload('stop',{message:{conversation:'Não quero mais receber mensagens'}}));assert.equal(r.body.optOut,true);
 await post(payload('c'));assert.equal(sends,0);assert.equal([...contacts.values()][0].aiIgnored,true);
});
test('lote processa todos os registros; broadcast não dispara IA; timestamp inválido não quebra ingresso',async()=>{
 const rows=[payload('a').data,payload('b',{messageTimestamp:'inválido'}).data,payload('g',{key:{id:'g',remoteJid:'status@broadcast'}}).data];
 const r=await post({...payload(),data:rows});assert.equal(r.status,200);assert.equal(r.body.processed,3);assert.equal(sends,2);
});
test('áudio sem base64 fica registrado, sem resposta de IA a entrada vazia',async()=>{
 const r=await post(payload('audio',{message:{audioMessage:{mimetype:'audio/ogg'}}}));assert.equal(r.status,200);assert.equal(aiCalls,0);assert.equal([...contacts.values()][0].messages[0].historyMediaUnavailable,true);
});
test('identidade nunca usa conta padrão para nome arbitrário, requer slot em mapa personalizado',()=>{
 assert.equal(evolutionInstanceIdentity('outra-instancia',env),null);
 assert.equal(evolutionInstanceIdentity('custom',{...env,EVOLUTION_INSTANCE_USERS:JSON.stringify({custom:owner})}),null);
 assert.deepEqual(evolutionInstanceIdentity('custom',{...env,EVOLUTION_INSTANCE_USERS:JSON.stringify({custom:{userId:owner,slotId:'slot_2'}})}),{userId:owner,slotId:'slot_2'});
});
test('lote vazio no ingresso CRM não acessa events[0] nem resolve tenant inexistente',async()=>{
 const r=await ingestEvolutionWebhook({event:'messages.upsert',instance:'zap-ia-slot_1',data:[]},{resolveTenant:()=>{throw new Error('não deve chamar')},repository:{persistEventAndOutbox(){throw new Error('não deve chamar')}}});
 assert.deepEqual(r,{ok:true,accepted:0,inserted:0,duplicates:0});
});
test('HTTP 2xx vazio não prova aceite; status numérico 400 também é rejeição',()=>{
 assert.throws(()=>requireEvolutionMessageId({}),/incerto/i);assert.throws(()=>requireEvolutionMessageId({status:400,key:{id:'fake'}}),/rejeitou/);assert.ok(requireEvolutionMessageId({key:{id:'valid'}}));
});

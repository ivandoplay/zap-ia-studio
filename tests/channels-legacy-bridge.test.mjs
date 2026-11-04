import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import fs from 'node:fs';
import {normalizeLegacySlotId,parseLegacyContactKey} from '../src/channels/legacyIdentity.js';
import {buildLegacyImportPlan,parseLegacyLinkSnapshot,resolveLegacyTarget,projectLegacyCrmContacts} from '../src/channels/legacyBridge.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const config={name:'Atendimento existente',transport:'local_worker',crmVisible:false,aiEnabled:true,campaignsEnabled:false,tags:['Loja']};
const raw=()=>({ownerId:A,channel:{id:C,...config,revision:1,createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z'},binding:{ownerId:A,channelId:C,legacySlotId:'slot_2',transport:'local_worker',sessionSecret:'NUNCA_EXIBIR'}});
const scope={ownerId:A,channelId:C};
test('ponte legada: UUID/slots desconhecidos nunca viram slot_1; chaves antigas permanecem estáveis',()=>{
 assert.equal(normalizeLegacySlotId(),'slot_1');assert.equal(normalizeLegacySlotId(' SLOT_2 '),'slot_2');
 for(const bad of [C,'slot_4','slot_20','auto_rotate',{},true,17])assert.throws(()=>normalizeLegacySlotId(bad),e=>e.code==='INVALID_LEGACY_SLOT');
 assert.deepEqual(parseLegacyContactKey('slot_2::558600000000@s.whatsapp.net'),{slotId:'slot_2',rawJid:'558600000000@s.whatsapp.net',compositeKey:'slot_2::558600000000@s.whatsapp.net'});
 assert.equal(parseLegacyContactKey('558600000000@s.whatsapp.net').slotId,'slot_1');assert.equal(parseLegacyContactKey('slot_1::558600000000@s.whatsapp.net').compositeKey,'558600000000@s.whatsapp.net');
 for(const bad of [C+'::558600000000@s.whatsapp.net','slot_4::558600000000@s.whatsapp.net',C])assert.throws(()=>parseLegacyContactKey(bad));
});
test('ponte legada: plano é só dados, exige políticas explícitas, não manipula sessão e não aceita segredos',()=>{
 const plan=buildLegacyImportPlan({ownerId:A,slots:[{slotId:'slot_2',config}]});assert.equal(plan.changesSessions,false);assert.equal(plan.connects,false);assert.equal(plan.steps[0].args.p_slot,'slot_2');assert.equal(plan.steps[0].args.p_config.aiEnabled,true);
 for(const input of [{ownerId:A,slots:[{slotId:C,config}]},{ownerId:A,slots:[{slotId:'slot_2',config},{slotId:'slot_2',config}]},{ownerId:A,slots:[{slotId:'slot_1',config:{...config,aiEnabled:undefined}}]},{ownerId:A,slots:[{slotId:'slot_1',config:{...config,authDir:'/sessao'}}]}])assert.throws(()=>buildLegacyImportPlan(input));
});
test('ponte legada: vínculo escopado, DTO sem segredo, canais novos bloqueados e políticas independentes',()=>{
 const link=parseLegacyLinkSnapshot(raw(),scope);assert.equal(JSON.stringify(link).includes('NUNCA_EXIBIR'),false);assert.equal(link.state,'legacy_linked');assert.equal(link.canPair,false);
 assert.deepEqual(resolveLegacyTarget(link,'ingest'),{ownerId:A,channelId:C,legacySlotId:'slot_2',transport:'local_worker'});assert.equal(resolveLegacyTarget(link,'ai').legacySlotId,'slot_2');assert.throws(()=>resolveLegacyTarget(link,'campaign'),e=>e.code==='CHANNEL_CAMPAIGNS_DISABLED');
 assert.throws(()=>parseLegacyLinkSnapshot(raw(),{...scope,ownerId:B}),e=>e.code==='CHANNEL_LINK_UNVERIFIED');
 for(const mutate of [r=>r.binding.legacySlotId='slot_4',r=>r.binding.channelId=B,r=>r.binding.ownerId=B,r=>r.binding.transport='evolution_api',r=>delete r.binding,r=>delete r.channel.aiEnabled]){const r=raw();mutate(r);assert.throws(()=>parseLegacyLinkSnapshot(r,scope));}
 const unbound=parseLegacyLinkSnapshot({...raw(),binding:null},scope);assert.equal(unbound.state,'unbound');assert.throws(()=>resolveLegacyTarget(unbound,'manual'),e=>e.code==='CHANNEL_DRIVER_MIGRATION_PENDING');assert.throws(()=>resolveLegacyTarget(link,'pair'));
});
test('ponte legada: projeção CRM preserva históricos, contatos sem mapa e decisões de IA/campanhas',()=>{
 const contacts=[{chatId:'slot_2::558600000000@s.whatsapp.net',slotId:'slot_2',messages:['guardada']},{chatId:'558600000001@s.whatsapp.net',slotId:'slot_1',messages:['legada']},{channelId:C,messages:['UUID']}],before=structuredClone(contacts),links=[parseLegacyLinkSnapshot(raw(),scope)];
 assert.deepEqual(projectLegacyCrmContacts(contacts,links,{ownerId:A}),[contacts[1]]);assert.deepEqual(projectLegacyCrmContacts(contacts,links,{ownerId:A,visibility:'hidden'}),[contacts[0],contacts[2]]);assert.deepEqual(projectLegacyCrmContacts(contacts,links,{ownerId:A,visibility:'all'}),contacts);assert.deepEqual(contacts,before);assert.equal(links[0].channel.aiEnabled,true);
 assert.throws(()=>projectLegacyCrmContacts(contacts,links,{ownerId:B}));assert.throws(()=>projectLegacyCrmContacts([{channelId:C,slotId:'slot_1'}],links,{ownerId:A}));
});

test('ponte CLI: só gera plano local e rejeita --apply, sem credenciais ou efeitos operacionais',()=>{
 const file='data/channel-review.synthetic.json';fs.writeFileSync(file,JSON.stringify({ownerId:A,slots:[{slotId:'slot_2',config}]}));
 const plan=JSON.parse(execFileSync(process.execPath,['scripts/plan-legacy-channel-import.mjs',file],{encoding:'utf8'}));assert.equal(plan.connects,false);assert.equal(plan.steps.length,1);assert.throws(()=>execFileSync(process.execPath,['scripts/plan-legacy-channel-import.mjs','--apply'],{stdio:'pipe'}),e=>e.status===2);fs.unlinkSync(file);
});

test('ponte integrada ao storage: novo UUID não é normalizado, chave antiga não muda',async()=>{
 assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');const {normalizeSlotId,parseContactChannelKey,buildContactChannelKey}=await import('../src/storage.js');assert.throws(()=>normalizeSlotId(C));assert.throws(()=>parseContactChannelKey(C+'::558600000000@s.whatsapp.net'));assert.equal(buildContactChannelKey('slot_2','558600000000@s.whatsapp.net'),'slot_2::558600000000@s.whatsapp.net');
 const links=[parseLegacyLinkSnapshot(raw(),scope)];assert.throws(()=>projectLegacyCrmContacts([{slotId:'slot_2',chatId:'slot_3::558600000000@s.whatsapp.net'}],links,{ownerId:A}));assert.equal(projectLegacyCrmContacts([{channelId:C,chatId:'558600000000@s.whatsapp.net'}],links,{ownerId:A,visibility:'hidden'}).length,1);
});

test('ponte no motor isolado: mantém diretório e objeto do chip existente, sem alternativa silenciosa',async()=>{
 assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1');const {AUTH_DIR}=await import('../src/storage.js');assert.ok(AUTH_DIR.startsWith(process.env.ZAPIA_TEST_ROOT));const {whatsappManager}=await import('../src/whatsappManager.js');
 const first=whatsappManager.getSlot('slot_1'),second=whatsappManager.getSlot('slot_2');assert.equal(first.authDir,AUTH_DIR);assert.equal(second.authDir,AUTH_DIR+'/slot_2');assert.equal(first.sock,null);assert.equal(second.sock,null);assert.throws(()=>whatsappManager.getSlot(C),e=>e.code==='INVALID_LEGACY_SLOT');for(const bad of [C,'slot_4',{},'qualquer']){assert.throws(()=>whatsappManager.pickSlotForProactive(bad),e=>e.code==='INVALID_LEGACY_SLOT');assert.throws(()=>whatsappManager.enqueueProactiveBatch([], '',bad),e=>e.code==='INVALID_LEGACY_SLOT');}assert.equal(whatsappManager.getSlot('slot_2'),second);
 const third=whatsappManager.slots.slot_3;try{delete whatsappManager.slots.slot_3;assert.throws(()=>whatsappManager.getSlot('slot_3'),e=>e.code==='LEGACY_ENGINE_UNAVAILABLE');}finally{whatsappManager.slots.slot_3=third;}
});

import {Router,json} from 'express';import {trainingUuid} from '../shared/contracts/training-domain.js';import {createAiSettings,validateAiSettings,validateCredentialUpdates,AI_SECRET_FIELDS,aiRoutePreview,aiConfigurationWarnings} from '../shared/contracts/ai-settings-domain.js';import {aiSettingsFingerprint} from './repository.js';
const fail=(status)=>Object.assign(Error('Operação indisponível.'),{status});const messages={400:'Dados inválidos. Confira os campos; nada foi aplicado.',401:'Entre pelo painel existente.',403:'Suporte somente leitura ou conta não autorizada.',409:'Rascunho, origem ou conta mudou. Consulte antes de salvar novamente.',413:'Dados acima do limite.',503:'Operação indisponível ou não habilitada. Não houve confirmação; consulte antes de decidir.'};
// O rascunho é gravado no repositório da conta em qualquer modo suportado do servidor;
// o modo local não é requisito de segurança (identidade + repositório + cofre são).
const WRITABLE_MODES=new Set(['local_worker','vercel_cloud']);
export function createAiSettingsRouter({getLocalContext,repository,vault,allowWrites=false,allowSecretWrites=false,allowConnectionTest=false,testConnection=null,readSource=c=>{if(!c.data?.settings)throw fail(503);return {settings:c.data.settings,stats:c.data.stats};}}={}){const router=Router();router.use((_q,r,n)=>{r.set('Cache-Control','no-store, private');n();});router.use(json({limit:'128kb',strict:true}));function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw fail(400);}
 async function scope(q,write=false){const c=q.dashboardContext||await getLocalContext?.(q);if(!c)throw fail(401);if(!trainingUuid(c.viewer?.id)||!trainingUuid(c.tenant?.id))throw fail(503);if(c.viewer.id!==c.tenant.id&&c.viewer.role!=='master')throw fail(403);if(write&&c.viewer.id!==c.tenant.id)throw fail(403);if(write&&(allowWrites!==true||!repository))throw fail(503);return {ctx:c,ownerId:c.tenant.id,viewerId:c.viewer.id,viewerRole:c.viewer.role,mode:c.mode};}
 async function same(q,s){const c=q.dashboardContext||await getLocalContext?.(q);if(c?.tenant?.id!==s.ownerId||c?.viewer?.id!==s.viewerId||c.viewer?.role!==s.viewerRole||c.mode!==s.mode)throw fail(409);}
 async function data(q,s){const x=await readSource(s.ctx);await same(q,s);if(!x?.settings||typeof x.settings!=='object'||Array.isArray(x.settings)||!x.settings.ai||typeof x.settings.ai!=='object'||Array.isArray(x.settings.ai))throw fail(503);let settings;try{settings=createAiSettings(x.settings);}catch{throw fail(503);}const a=x.settings.ai||{},pool=typeof a.geminiKeyPool==='string'?a.geminiKeyPool.split(/[\r\n,;]+/).map(v=>v.trim()).filter(v=>v.length>=16):[];const count=new Set([...(typeof a.geminiApiKey==='string'&&a.geminiApiKey.trim().length>=16?[a.geminiApiKey.trim()]:[]),...pool]).size;const originalCredentials={gemini:{configured:!!count,count},openrouter:{configured:typeof a.openrouterApiKey==='string'&&!!a.openrouterApiKey.trim(),count:typeof a.openrouterApiKey==='string'&&!!a.openrouterApiKey.trim()?1:0},pool:{configured:pool.length>0,count:new Set(pool).size}};const originalPrimary={gemini:typeof a.geminiApiKey==='string'&&a.geminiApiKey.trim().length>=16,openrouter:originalCredentials.openrouter.configured};const stat=k=>Number.isFinite(x.stats?.[k])&&x.stats[k]>=0?x.stats[k]:null;const stats={dailyAiCalls:stat('dailyAiCalls'),avgLatencyMs:stat('avgLatencyMs')>0?stat('avgLatencyMs'):null,autoFallbacksTriggered:stat('autoFallbacksTriggered'),blockedInjections:stat('blockedInjections'),day:typeof x.stats?.dailyDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.stats.dailyDate)?x.stats.dailyDate:null};// `rawAi` guarda a origem crua: `createAiSettings` normaliza e descarta os segredos.
 return {settings,rawAi:{...a},originalCredentials,originalPrimary,stats,fingerprint:aiSettingsFingerprint({settings,originalCredentials,originalPrimary})};}
 function dto(s,x,record){const settings=record?.document.settings||x.settings,credentials={};for(const f of AI_SECRET_FIELDS){const c=record?.document.credentials[f]||{action:'inherit'};if(c.action==='replace'&&vault)vault.open(f,c.envelope,s.ownerId);const count=c.action==='replace'?c.envelope.count:c.action==='clear'?0:f==='gemini'?(x.originalPrimary.gemini?1:0):x.originalCredentials[f].count;credentials[f]={action:c.action,configured:count>0,count,originalConfigured:f==='gemini'?x.originalPrimary.gemini:x.originalCredentials[f].configured,originalCount:f==='gemini'?(x.originalPrimary.gemini?1:0):x.originalCredentials[f].count};}const own=s.viewerId===s.ownerId,canWrite=own&&WRITABLE_MODES.has(s.ctx.mode)&&allowWrites===true&&!!repository;return {ok:true,source:'local_ai_settings',ownerId:s.ownerId,revision:record?.revision||0,settings,originalBotEnabled:x.settings.botEnabled,sourceChanged:!!record&&record.sourceFingerprint!==x.fingerprint,credentials,stats:x.stats,observedAt:new Date().toISOString(),capabilities:{writable:canWrite,canWriteSecrets:canWrite&&allowSecretWrites===true&&!!vault,canTestConnection:canWrite&&allowConnectionTest===true&&typeof testConnection==='function',canActivate:false}};}
 // Chaves EFETIVAS do rascunho: o que está salvo na conta + o que o cofre guardou.
 // É a mesma montagem que o painel antigo faz ao clicar em "Testar conexão"
 // (`collectAiSettingsFromForm` → `/api/ai/test` → generateSmartReply).
 function effectiveAiKeys(record, base, vaultRef, ownerId) {
   const ai = { ...(base?.ai || {}) };
   const abrir = (campo) => {
     const c = record?.document?.credentials?.[campo];
     if (!c || c.action !== 'replace') return undefined;
     try { return vaultRef.open(campo, c.envelope, ownerId); } catch { return undefined; }
   };
   const gemini = abrir('gemini');
   const openrouter = abrir('openrouter');
   const pool = abrir('pool');
   if (typeof gemini === 'string' && gemini.trim()) ai.geminiApiKey = gemini.trim();
   if (typeof openrouter === 'string' && openrouter.trim()) ai.openrouterApiKey = openrouter.trim();
   if (typeof pool === 'string' && pool.trim()) ai.geminiKeyPool = pool.trim();
   const limpo = record?.document?.credentials || {};
   for (const campo of ['gemini', 'openrouter', 'pool']) {
     const acao = limpo[campo]?.action;
     if (acao === 'clear') {
       if (campo === 'gemini') { delete ai.geminiApiKey; delete ai.geminiKeyPool; }
       if (campo === 'openrouter') delete ai.openrouterApiKey;
       if (campo === 'pool') delete ai.geminiKeyPool;
     }
   }
   return ai;
 }

 function configured(d){return {...d.credentials,gemini:{...d.credentials.gemini,configured:d.credentials.gemini.configured||d.credentials.pool.configured}};}
 const route=(method,p,fn)=>router[method](p,async(q,r)=>{try{keys(q.query,[]);await fn(q,r);}catch(e){if(process.env.IENVIA_DEBUG_AI==='1')console.error('[ai-settings]',p,e?.status,e?.message);const status=[400,401,403,409,413,503].includes(e.status)?e.status:400;r.status(status).json({ok:false,error:messages[status]});}});
 route('get','/',async(q,r)=>{const s=await scope(q),x=await data(q,s),record=await repository?.read(s.ownerId);await same(q,s);r.json(dto(s,x,record));});
 route('put','/draft',async(q,r)=>{const s=await scope(q,true);keys(q.body,['expectedRevision','requestId','settings','credentials']);const b=q.body;if(!trainingUuid(b.requestId)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw fail(400);const settings=validateAiSettings(b.settings),updates=validateCredentialUpdates(b.credentials),hasUpdates=AI_SECRET_FIELDS.some(f=>updates[f].action!=='keep');if(hasUpdates&&(allowSecretWrites!==true||!vault))throw fail(503);const x=await data(q,s),intent={kind:'save',expectedRevision:b.expectedRevision,settings,credentials:updates},intentDigest=vault?vault.intentDigest(intent,s.ownerId):aiSettingsFingerprint(intent),current=await repository.read(s.ownerId);await same(q,s);if(current?.lastRequestId===b.requestId){if(current.lastDigest!==intentDigest)throw fail(409);return r.json(dto(s,x,current));}if((current?.revision||0)!==b.expectedRevision)throw fail(409);if(current&&current.sourceFingerprint!==x.fingerprint)throw fail(409);const credentials=structuredClone(current?.document.credentials||Object.fromEntries(AI_SECRET_FIELDS.map(f=>[f,{action:'inherit'}])));for(const f of AI_SECRET_FIELDS){const u=updates[f];if(['clear','inherit'].includes(u.action))credentials[f]={action:u.action};else if(u.action==='replace')credentials[f]={action:'replace',envelope:vault.seal(f,u.value,s.ownerId)};}const document={schema:'ienvia-ai-settings-draft-v1',settings,credentials};await same(q,s);const record=await repository.save({ownerId:s.ownerId,expectedRevision:b.expectedRevision,requestId:b.requestId,sourceFingerprint:x.fingerprint,intentDigest,document});await same(q,s);r.json(dto(s,x,record));});
 route('post','/validate',async(q,r)=>{keys(q.body,['settings']);const s=await scope(q),x=await data(q,s),record=await repository?.read(s.ownerId),d=dto(s,x,record),settings=validateAiSettings(q.body.settings);await same(q,s);r.json({ok:true,ownerId:s.ownerId,kind:'local_configuration_check',connectionTested:false,routes:aiRoutePreview(settings),warnings:aiConfigurationWarnings(settings,configured(d)),note:'Usa apenas o estado das credenciais já salvas. Chaves digitadas e não salvas não são testadas. Nenhuma chamada externa; sem latência, cota ou conexão verificadas.'});});
 route('post','/reset',async(q,r)=>{const s=await scope(q,true);keys(q.body,['expectedRevision','requestId']);const b=q.body;if(!trainingUuid(b.requestId)||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)throw fail(400);const x=await data(q,s),intent={kind:'reset',expectedRevision:b.expectedRevision},intentDigest=vault?vault.intentDigest(intent,s.ownerId):aiSettingsFingerprint(intent),document={schema:'ienvia-ai-settings-draft-v1',settings:x.settings,credentials:Object.fromEntries(AI_SECRET_FIELDS.map(f=>[f,{action:'inherit'}]))};await same(q,s);const record=await repository.save({ownerId:s.ownerId,expectedRevision:b.expectedRevision,requestId:b.requestId,sourceFingerprint:x.fingerprint,intentDigest,document});await same(q,s);r.json(dto(s,x,record));});
 // Teste de conexão: mesmo caminho do painel antigo (`POST /api/ai/test` →
 // generateSmartReply com allowDemoFallback:false). Usa as chaves do rascunho salvo —
 // o cofre só é aberto aqui, no servidor, e a chave nunca volta na resposta.
 route('post','/test',async(q,r)=>{
  if(allowConnectionTest!==true||typeof testConnection!=='function')throw fail(503);
  const s=await scope(q);keys(q.body,[]);
  const x=await data(q,s),record=await repository?.read(s.ownerId);
  // O dto valida o cofre antes de qualquer chamada externa. As chaves vêm da origem
  // crua (`x.settings.ai`): `createAiSettings` normaliza e descarta os segredos.
  dto(s,x,record);
  const ai=effectiveAiKeys(record,{ai:x.rawAi},vault,s.ownerId);
  const temChave=Boolean((ai?.geminiApiKey&&String(ai.geminiApiKey).trim())||(ai?.openrouterApiKey&&String(ai.openrouterApiKey).trim())||(ai?.geminiKeyPool&&String(ai.geminiKeyPool).trim()));
  if(!temChave)throw Object.assign(Error('Nenhuma chave configurada.'),{status:400});
  const settings={...x.settings,ai};
  await same(q,s);
  const inicio=Date.now();
  let out;
  try{ out=await testConnection({settings,ownerId:s.ownerId}); }
  catch(e){ r.status(400).json({ok:false,error:'O provedor não respondeu como esperado. Confira a chave e o modelo.',detail:String(e?.message||'').slice(0,200)}); return; }
  await same(q,s);
  r.json({ok:true,ownerId:s.ownerId,kind:'connection_test',connectionTested:true,latencyMs:Date.now()-inicio,provider:String(out?.provider||''),model:String(out?.model||''),keyPoolSize:Number.isInteger(out?.keyPoolSize)?out.keyPoolSize:1,usedFallback:Boolean(out?.usedFallback),sampleReply:String(out?.sampleReply||'').slice(0,400),observedAt:new Date().toISOString()});
 });router.use((e,_q,r,_n)=>r.status(e.type==='entity.too.large'?413:400).json({ok:false,error:messages[e.type==='entity.too.large'?413:400]}));return router;
}

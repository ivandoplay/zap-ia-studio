// Ponte de identidade/preparação: sem I/O, comandos, sessão ou conexão de WhatsApp.
import {isChannelId,parseChannelInput} from '../../public/v2/assets/channel-policy.js';
import {LEGACY_SLOT_IDS,parseLegacyContactKey} from './legacyIdentity.js';
const verified=new WeakSet();
const fail=(code,message,status=503)=>{throw Object.assign(new Error(message),{code,status,statusCode:status});};
const canonical=id=>isChannelId(id)?id.toLowerCase():fail('INVALID_CHANNEL_ID','Conta ou canal UUID inválido.',400);
export function buildLegacyImportPlan(input){
 if(!input||Object.keys(input).some(k=>!['ownerId','slots'].includes(k))||!Array.isArray(input.slots)||input.slots.length<1||input.slots.length>3)fail('INVALID_LEGACY_IMPORT','Importação exige uma lista explícita dos chips antigos.',400);
 const ownerId=canonical(input.ownerId),seen=new Set(),steps=input.slots.map(slot=>{
  if(!slot||Object.keys(slot).some(k=>!['slotId','config'].includes(k))||!LEGACY_SLOT_IDS.includes(slot.slotId)||seen.has(slot.slotId))fail('INVALID_LEGACY_IMPORT','Chip antigo inválido ou repetido.',400);
  seen.add(slot.slotId);
  if(['crmVisible','aiEnabled','campaignsEnabled'].some(k=>typeof slot.config?.[k]!=='boolean'))fail('INVALID_LEGACY_IMPORT','Revise explicitamente CRM, IA e campanhas; não inferimos permissões antigas.',400);
  const config=parseChannelInput(slot.config);config.tags.sort();return {rpc:'ienvia_import_legacy_channel',args:{p_owner:ownerId,p_slot:slot.slotId,p_config:config}};
 }).sort((a,b)=>a.args.p_slot.localeCompare(b.args.p_slot));
 return {schemaVersion:1,ownerId,changesSessions:false,connects:false,requiresAuthorizedDatabaseMigration:true,steps};
}
export function parseLegacyLinkSnapshot(value,{ownerId,channelId}){
 ownerId=canonical(ownerId);channelId=canonical(channelId);
 const bad=()=>fail('CHANNEL_LINK_UNVERIFIED','Não foi possível confirmar o vínculo deste canal nesta conta.');
 if(!value||value.ownerId!==ownerId||!value.channel||value.channel.id!==channelId||!Number.isInteger(value.channel.revision)||value.channel.revision<1||!Number.isFinite(Date.parse(value.channel.createdAt))||!Number.isFinite(Date.parse(value.channel.updatedAt)))bad();
 let config;try{const c=value.channel;config=parseChannelInput({name:c.name,transport:c.transport,crmVisible:c.crmVisible,aiEnabled:c.aiEnabled,campaignsEnabled:c.campaignsEnabled,tags:c.tags});}catch{bad();}
 const b=value.binding;if(b!==null&&(!b||b.ownerId!==ownerId||b.channelId!==channelId||!LEGACY_SLOT_IDS.includes(b.legacySlotId)||b.transport!==config.transport))bad();
 const channel=Object.freeze({id:channelId,...config,tags:Object.freeze(config.tags),revision:value.channel.revision,createdAt:value.channel.createdAt,updatedAt:value.channel.updatedAt});
 const result=Object.freeze({ownerId,channel,state:b===null?'unbound':'legacy_linked',legacySlotId:b===null?null:b.legacySlotId,canPair:false,operationalMigrationPending:true});verified.add(result);return result;
}
export function resolveLegacyTarget(link,purpose){
 if(!verified.has(link))fail('CHANNEL_LINK_UNVERIFIED','O vínculo deve vir do repositório autenticado e ser validado.');
 if(!['ingest','manual','ai','campaign'].includes(purpose))fail('INVALID_CHANNEL_OPERATION','Finalidade de canal inválida; pareamento não está liberado.',400);
 if(link.state!=='legacy_linked')fail('CHANNEL_DRIVER_MIGRATION_PENDING','Canal sem vínculo legado. Nenhum Chip 1 será usado como alternativa.',409);
 if(purpose==='ai'&&!link.channel.aiEnabled)fail('CHANNEL_AI_DISABLED','IA desativada neste canal.',403);
 if(purpose==='campaign'&&!link.channel.campaignsEnabled)fail('CHANNEL_CAMPAIGNS_DISABLED','Campanhas desativadas neste canal.',403);
 return Object.freeze({ownerId:link.ownerId,channelId:link.channel.id,legacySlotId:link.legacySlotId,transport:link.channel.transport});
}
export function projectLegacyCrmContacts(contacts,links,{ownerId,visibility='visible'}={}){
 ownerId=canonical(ownerId);
 if(!Array.isArray(contacts)||!Array.isArray(links)||!['visible','hidden','all'].includes(visibility))fail('INVALID_CRM_PROJECTION','Projeção de CRM inválida.',400);
 const byId=new Map(),bySlot=new Map();
 for(const link of links){if(!verified.has(link)||link.ownerId!==ownerId||byId.has(link.channel.id)||link.legacySlotId&&bySlot.has(link.legacySlotId))fail('CHANNEL_LINK_UNVERIFIED','Vínculos de CRM conflitantes ou de outra conta.');byId.set(link.channel.id,link);if(link.legacySlotId)bySlot.set(link.legacySlotId,link);}
 return contacts.filter(contact=>{
  if(!contact||contact.ownerId&&contact.ownerId!==ownerId)fail('CHANNEL_LINK_UNVERIFIED','Contato não pertence ao escopo consultado.');
  const parsed=contact.chatId!==undefined?parseLegacyContactKey(contact.chatId):null;
  const slot=contact.slotId!==undefined?contact.slotId:parsed&&(contact.chatId.includes('::')||!contact.channelId)?parsed.slotId:null;
  if(contact.slotId!==undefined&&parsed&&contact.chatId.includes('::')&&parsed.slotId!==contact.slotId)fail('CHANNEL_LINK_UNVERIFIED','Conversa e contato têm chips conflitantes.');
  if(slot!==null&&!LEGACY_SLOT_IDS.includes(slot))fail('CHANNEL_LINK_UNVERIFIED','Chip de contato inválido.');
  if(contact.channelId!==undefined&&!isChannelId(contact.channelId))fail('CHANNEL_LINK_UNVERIFIED','Canal de contato inválido.');
  const direct=byId.get(contact.channelId),legacy=bySlot.get(slot);
  if(contact.channelId&&(legacy&&legacy.channel.id!==contact.channelId||direct&&slot&&direct.legacySlotId!==slot))fail('CHANNEL_LINK_UNVERIFIED','Contato tem identidades de canal conflitantes.');
  const hidden=(direct||legacy)?.channel.crmVisible===false;
  return visibility==='all'||(visibility==='hidden'?hidden:!hidden);
 });
}

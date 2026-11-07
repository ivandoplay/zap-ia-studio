// Fronteira pura do formato antigo. Não abre arquivos, sessões ou sockets.
import {isChannelId} from '../shared/contracts/channel-policy.js';
export const LEGACY_SLOT_IDS=Object.freeze(['slot_1','slot_2','slot_3']);
const invalid=(code,message)=>{throw Object.assign(new Error(message),{code,status:400,statusCode:400});};
export function normalizeLegacySlotId(value='slot_1'){
 if(value===null||value==='')return 'slot_1'; // Compatibilidade apenas com ausência legada, nunca ID desconhecido.
 if(typeof value!=='string')invalid('INVALID_LEGACY_SLOT','Chip legado inválido. Nenhum Chip 1 foi escolhido.');
 const slot=value.trim().toLowerCase();
 if(!LEGACY_SLOT_IDS.includes(slot))invalid('INVALID_LEGACY_SLOT','Este identificador não pertence aos chips legados. Nenhum Chip 1 foi escolhido.');
 return slot;
}
export function normalizeLegacyChannelMode(value='auto_rotate'){
 if(value===null||value==='')return 'auto_rotate';
 if(value==='auto_rotate'||LEGACY_SLOT_IDS.includes(value))return value;
 invalid('INVALID_LEGACY_SLOT','Modo de canal desconhecido. Nenhum rodízio ou Chip 1 foi escolhido como alternativa.');
}
export function parseLegacyContactKey(value=''){
 if(typeof value!=='string')invalid('INVALID_LEGACY_CONTACT','Identificador de conversa legado inválido.');
 const raw=value.trim(),match=raw.match(/^(slot_[123])::(.+)$/i);
 if(match){const slotId=normalizeLegacySlotId(match[1]),rawJid=match[2];if(rawJid.includes('::'))invalid('INVALID_LEGACY_CONTACT','Conversa com escopo ambíguo.');return {slotId,rawJid,compositeKey:slotId==='slot_1'?rawJid:`${slotId}::${rawJid}`};}
 if(raw.includes('::')||isChannelId(raw))invalid('INVALID_LEGACY_CONTACT','Conversa de canal novo ou desconhecido não pode ser convertida em Chip 1.');
 return {slotId:'slot_1',rawJid:raw,compositeKey:raw};
}
export function validateLegacyApiReferences(path,{body,query}={}){
 if(/^\/channels(?:\/|$)/.test(path))return;
 for(const value of [body,query,body?.payload]){
  if(!value||typeof value!=='object')continue;
  for(const key of ['channelId','channel_id','slot_id'])if(Object.hasOwn(value,key))throw Object.assign(new Error('Esta rota ainda usa chips legados. O canal UUID exige a migração operacional; nada foi encaminhado ao Chip 1.'),{statusCode:409,code:'CHANNEL_DRIVER_MIGRATION_PENDING'});
  if(Object.hasOwn(value,'slotId')&&value.slotId!==undefined&&value.slotId!==null&&value.slotId!=='')normalizeLegacySlotId(value.slotId);
  if(Object.hasOwn(value,'channelMode'))normalizeLegacyChannelMode(value.channelMode);
  for(const key of ['chatId','targetChatId'])if(Object.hasOwn(value,key)&&value[key]!==null&&value[key]!==undefined)parseLegacyContactKey(value[key]);
 }
}

// Biblioteca salva da conta. Sem mensagens, exemplos, storage ou fallback legado.
import {crmUuid} from './crm-metadata-contract.js';
import {parseQuickReplyDraft} from './conversations-quick-replies.js';
const invalid=()=>{throw Object.assign(Error('Biblioteca de atalhos inválida. Nenhuma fonte alternativa foi utilizada.'),{status:400,code:'CRM_INPUT_INVALID'});};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).some(k=>!keys.includes(k)))invalid();};
export function parseQuickLibraryMutation(v){exact(v,['expectedRevision','operation','item']);if(!Number.isInteger(v.expectedRevision)||v.expectedRevision<0||v.expectedRevision>=2147483647||!['save','remove'].includes(v.operation))invalid();if(v.operation==='remove'){exact(v.item,['id']);return {expectedRevision:v.expectedRevision,operation:v.operation,item:{id:crmUuid(v.item.id)}};}exact(v.item,['id','shortcut','title','text']);const item=parseQuickReplyDraft(v.item);if(item.id)item.id=crmUuid(item.id);return {expectedRevision:v.expectedRevision,operation:v.operation,item};}
export function parseQuickLibrary(v,ownerId){
 exact(v,['ownerId','projection','revision','updatedAt','writesEnabled','items']);if(crmUuid(v.ownerId)!==crmUuid(ownerId)||v.ownerId!==ownerId||v.projection!=='saved_quick_replies_only_v1'||typeof v.writesEnabled!=='boolean'||!Number.isInteger(v.revision)||v.revision<0||v.revision>2147483647||!Array.isArray(v.items)||v.items.length>200)invalid();
 if(v.revision===0){if(v.updatedAt!==null||v.items.length)invalid();}else if(typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt)))invalid();
 const items=v.items.map(raw=>{exact(raw,['id','shortcut','title','text']);const item=parseQuickReplyDraft(raw);item.id=crmUuid(raw.id);if(['id','shortcut','title','text'].some(k=>item[k]!==raw[k]))invalid();return item;});if(new Set(items.map(i=>i.id)).size!==items.length||new Set(items.map(i=>i.shortcut)).size!==items.length)invalid();return {ownerId,projection:v.projection,revision:v.revision,updatedAt:v.updatedAt,writesEnabled:v.writesEnabled,items};
}

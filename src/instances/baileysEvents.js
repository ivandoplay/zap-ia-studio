import {jidNormalizedUser} from '@whiskeysockets/baileys/lib/WABinary/jid-utils.js';
import {BufferJSON} from '@whiskeysockets/baileys/lib/Utils/generics.js';
import {dispatchError} from './contracts.js';
export function instanceJid(value,{allowLid=false}={}){
 if(typeof value!=='string'||!(/^[0-9]{1,30}(?::[0-9]{1,5})?@(s\.whatsapp\.net|lid)$/).test(value))throw dispatchError('INSTANCE_JID_UNVERIFIED','Identidade individual não confirmada.',400);
 const normalized=jidNormalizedUser(value);if((/^[1-9][0-9]{7,14}@s\.whatsapp\.net$/).test(normalized)||allowLid&&(/^[0-9]{1,30}@lid$/).test(normalized))return normalized;
 throw dispatchError('INSTANCE_JID_UNVERIFIED','Número ou LID não confirmado.',400);
}
export function normalizeBaileysIngress(type,record,{observedAt=new Date().toISOString()}={}){
 if(!['notify','append','history','receipt','delete','contact','chat','mapping'].includes(type)||!record||typeof record!=='object'||!Number.isFinite(Date.parse(observedAt)))throw dispatchError('INVALID_INSTANCE_EVENT','Evento de entrada inválido.',400);
 let key=record.key||record,body=record.message,privateContent=false;
 for(let n=0;n<8&&body;n++){if(body.viewOnceMessage||body.viewOnceMessageV2||body.viewOnceMessageV2Extension||body.ephemeralMessage){privateContent=true;break;}if(body.documentWithCaptionMessage?.message){body=body.documentWithCaptionMessage.message;continue;}break;}
 if(body&&Object.values(body).some(value=>value&&typeof value==='object'&&value.viewOnce===true))privateContent=true;
 let wire;try{const raw=privateContent?{key:record.key,messageTimestamp:record.messageTimestamp,contentOmitted:'privacy'}:record;wire=JSON.parse(JSON.stringify({type,record:raw},BufferJSON.replacer));if(Buffer.byteLength(JSON.stringify(wire))>921600)throw Error('Evento excessivo');}catch{throw dispatchError('INVALID_INSTANCE_EVENT','Evento não pôde ser serializado com segurança.',400);}
 const base={kind:'unprojected',source:type,wire};if(['contact','chat','mapping'].includes(type))return base;
 let kind=type==='receipt'?'receipt':type==='delete'?'delete':'message';
 const protocol=record.update?.message?.protocolMessage;if(protocol?.type===0&&protocol.key){key={...record.key,...protocol.key};kind='delete';}
 if(type==='receipt'&&kind!=='delete'&&!Number.isInteger(record.update?.status))return base;
 let peerJid;try{peerJid=instanceJid(key.remoteJid,{allowLid:true});}catch{return base;}
 if(typeof key.id!=='string'||!(/^[!-~]{1,128}$/).test(key.id)||typeof key.fromMe!=='boolean')return base;
 let text=null,mediaType=null;if(kind==='message'){
  if(privateContent)mediaType='privacy_omitted';
  else if(typeof body?.conversation==='string'){text=body.conversation;mediaType='text';}
  else if(typeof body?.extendedTextMessage?.text==='string'){text=body.extendedTextMessage.text;mediaType='text';}
  else{const media=['image','video','audio','document','sticker','contact','location','reaction','pollCreation'].find(k=>body?.[k+'Message']);if(media){mediaType=media;text=body[media+'Message']?.caption??null;}else mediaType='unsupported';}
  if(text!==null&&(typeof text!=='string'||text.length>65536||text.includes('\0')))return base;
 }
 const status=type==='receipt'?record.update?.status:record.status;
 // Enum instalado Baileys 7: SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5.
 const ack=Number.isInteger(status)&&status>=2&&status<=5?status-1:0;
 let seconds;try{seconds=typeof record.messageTimestamp?.toNumber==='function'?record.messageTimestamp.toNumber():Number(record.messageTimestamp);}catch{}
 const validTime=Number.isFinite(seconds)&&seconds>0&&seconds<=4102444800;
 return {...base,kind,peerJid,providerMessageId:key.id,fromMe:key.fromMe,text,mediaType,ack,messageAt:validTime?new Date(seconds*1000).toISOString():observedAt,timestampSource:validTime?'provider':'capture'};
}

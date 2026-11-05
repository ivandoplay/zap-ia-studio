import {isChannelId} from './channel-policy.js';
import {parseContactsQuery} from './crm-metadata-contract.js';
export function isCrmMetadataPath(path,method='GET'){
 if(typeof path!=='string'||path.includes('#'))return false;
 const [base,query,...extra]=path.split('?');if(extra.length)return false;
 if(['/api/crm-v2/quick-replies','/api/crm-v2/tags'].includes(base))return query===undefined&&['GET','PATCH'].includes(method);
 if(base==='/api/crm-v2/contacts'){
  if(method==='POST')return query===undefined;
  if(method!=='GET')return false;
  try{const params=new URLSearchParams(query||''),input={};for(const [k,v]of params){if(Object.hasOwn(input,k))return false;Object.defineProperty(input,k,{value:v,enumerable:true});}parseContactsQuery(input);return true;}catch{return false;}
 }
 const m=/^\/api\/crm-v2\/(contacts\/([^/]+)|threads\/([^/]+)\/profile)$/.exec(base);
 return !!m&&isChannelId(m[2]||m[3])&&query===undefined&&['GET','PATCH'].includes(method);
}

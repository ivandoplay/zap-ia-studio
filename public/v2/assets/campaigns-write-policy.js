// Allowlist UUID. Comandos de execução explícitos separados dos rascunhos; sem pairing/dispatch direto.
import {isCampaignId} from './campaigns-contract.js';
export function isCampaignDraftPath(path,method='GET'){
 if(typeof path!=='string'||!path.startsWith('/api/campaigns-v2/'))return false;const u=new URL(path,'https://local.invalid');if(u.origin!=='https://local.invalid'||u.hash)return false;const p=u.pathname.slice('/api/campaigns-v2/'.length).split('/'),q=[...u.searchParams.keys()];if(new Set(q).size!==q.length)return false;
 if(p[0]==='execution'){
  if(p.length===2&&p[1]==='features')return method==='GET'&&!q.length;
  if(p[1]!=='runs')return false;
  if(p.length===2){if(method!=='GET'||q.length!==1||q[0]!=='ids')return false;const ids=u.searchParams.get('ids').split(',');return ids.length>0&&ids.length<=50&&new Set(ids).size===ids.length&&ids.every(isCampaignId);}
  if(!isCampaignId(p[2])||q.length)return false;if(p.length===3)return method==='GET';if(p.length===4)return ['control','resolve','resolve-ai','resolve-late'].includes(p[3])&&method==='POST'||p[3]==='plan'&&method==='PUT';
  return p.length===6&&p[3]==='recipients'&&isCampaignId(p[4])&&p[5]==='remove'&&method==='POST';
 }
 if(p[0]==='drafts'){
  if(p.length===1){if(method==='POST')return !q.length;if(method!=='GET'||q.some(k=>!['limit','after'].includes(k)))return false;return (!q.includes('limit')||/^([1-9]|[1-4][0-9]|50)$/.test(u.searchParams.get('limit')))&&(!q.includes('after')||isCampaignId(u.searchParams.get('after')));}
  if(!isCampaignId(p[1]))return false;if(p.length===2)return !q.length&&['GET','PUT'].includes(method);if(p.length===3&&p[2]==='recipients')return method==='GET'&&q.every(k=>k==='inicio')&&(!q.length||/^(0|[1-9][0-9]{0,3})$/.test(u.searchParams.get('inicio'))&&Number(u.searchParams.get('inicio'))<=9950);return p.length===5&&p[2]==='recipients'&&isCampaignId(p[3])&&p[4]==='remove'&&method==='POST'&&!q.length;
 }
 if(p.length===1&&p[0]==='features')return method==='GET'&&!q.length;
 if(p.length===1&&['import-preview','ai-variations'].includes(p[0]))return method==='POST'&&!q.length;
 if(p[0]==='folders'){
  if(p.length===1)return !q.length&&['GET','POST'].includes(method);if(!isCampaignId(p[1]))return false;
  if(p.length===3&&p[2]==='files')return method==='GET'&&q.every(k=>k==='inicio')&&(!q.length||/^(0|[1-9][0-9]{0,3})$/.test(u.searchParams.get('inicio'))&&Number(u.searchParams.get('inicio'))<=9900);
  return method==='POST'&&!q.length&&p[2]==='uploads'&&(p.length===3||p.length===5&&isCampaignId(p[3])&&p[4]==='finish');
 }
 return p[0]==='files'&&isCampaignId(p[1])&&p.length===3&&['delete','ticket'].includes(p[2])&&method==='POST'&&!q.length;
}

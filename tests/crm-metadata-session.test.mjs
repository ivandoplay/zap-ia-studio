import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionClient} from '../public/v2/assets/session-client.js';
const C='44444444-4444-4444-8444-444444444444';
const localStore={getItem:k=>k==='zapia_cloud_auth'?JSON.stringify({accessToken:'synthetic-token',refreshToken:'synthetic-refresh'}):null};
test('metadata CRM sessão: allowlist exata, GET sem corpo e sem acesso ao CRM operacional antigo',async()=>{
 const calls=[],api=createSessionClient({localStore,fetcher:async(path,o)=>{calls.push({path,...o});return new Response(JSON.stringify({ok:true}));}});
 for(const path of ['/api/crm-v2/contacts?limit=20&saved=all&visibility=visible&q=nome',`/api/crm-v2/contacts/${C}`,`/api/crm-v2/threads/${C}/profile`])await api.request(path);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.method==='GET'&&c.headers.Authorization==='Bearer synthetic-token'));
 for(const [path,options] of [['/api/crm-v2/contacts?ownerId='+C,{}],['/api/crm-v2/contacts?limit=2&limit=3',{}],['/api/crm-v2/contacts#x',{}],[`/api/crm-v2/threads/${C}/profile/extra`,{}],['/api/crm/send',{method:'POST'}],['/api/crm-v2/contacts',{method:'GET',body:{x:1}}],[`/api/crm-v2/contacts/${C}`,{method:'DELETE'}]])await assert.rejects(api.request(path,options));
 assert.equal(calls.length,3);
});
test('metadata CRM sessão: mutação não repete por 401 e falha de rede fica incerta, sem refresh/replay',async()=>{
 for(const mode of ['unauthorized','timeout']){const calls=[],api=createSessionClient({localStore,fetcher:async(path,o)=>{calls.push({path,...o});if(mode==='timeout')throw Error('offline');return new Response(JSON.stringify({ok:false,authRequired:true}),{status:401});}});await assert.rejects(api.request(`/api/crm-v2/contacts/${C}`,{method:'PATCH',body:{expectedRevision:1,patch:{saved:true}}}),e=>mode==='timeout'?e.detail?.uncertain===true:e.status===401);assert.equal(calls.length,1);assert.equal(calls[0].method,'PATCH');}
});

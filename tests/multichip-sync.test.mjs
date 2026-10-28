import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage, localStorageInstance as store } from '../src/storage.js';
import { whatsappManager } from '../src/whatsappManager.js';
import { fetchAllCloudContacts, flushTenantStoreToCloud } from '../src/supabaseCloud.js';

store.inMemory = true;
store.onMutate = null;
store.data.contacts = {};
const one = whatsappManager.slots.slot_1;
const two = whatsappManager.slots.slot_2;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapia-sync-test-'));
two.authDir = temp;
store.upsertContact('5586999999999@s.whatsapp.net', {phone:'5586999999999',name:'Chip um'}, {deferSave:true});
fs.writeFileSync(path.join(temp,'zapia_history_sync.json'), JSON.stringify({completedAt:new Date().toISOString()}));
assert.equal(two.hasCompletedHistoryBootstrap(), false, 'O histórico do chip 1 e marcador antigo não devem bloquear o chip 2');
two.ingestChatRecords([{id:'5586999999999@s.whatsapp.net',conversationTimestamp:1700000000}], {deferSave:true});
assert.ok(store.data.contacts['slot_2::5586999999999@s.whatsapp.net']);
assert.equal(two.hasCompletedHistoryBootstrap(), true);
two.ingestContactRecords([{id:'5586999999999@s.whatsapp.net', name:'Nome do chip dois'}], {deferSave:true});
assert.equal(store.data.contacts['5586999999999@s.whatsapp.net'].name,'Chip um','Contatos do chip 2 não podem alterar o chip 1');
assert.equal(store.data.contacts['slot_2::5586999999999@s.whatsapp.net'].name,'Nome do chip dois');
two.waitUntilConnected=async()=>true; two.sock={authState:{creds:{}},sendPeerDataOperationMessage:async()=>{}};
two.isSelfJid=(jid)=>String(jid).includes('5586999999999');
await two.syncAllConversationsFromPhone({waitMs:5});
assert.ok(store.data.contacts['5586999999999@s.whatsapp.net'],'Sincronizar chip 2 não pode remover contatos do chip 1');
fs.rmSync(temp,{recursive:true,force:true});

const rows = Array.from({length:1251},(_,i)=>({chat_id:String(i).padStart(5,'0'),data:{}}));
const pager = {from(){let after='';let limit=0;return {select(){return this},eq(){return this},order(){return this},limit(n){limit=n;return this},gt(k,v){if(k==='chat_id')after=v;return this},then(resolve){return Promise.resolve({data:rows.filter(r=>r.chat_id>after).slice(0,limit),error:null}).then(resolve)}}}};
assert.equal((await fetchAllCloudContacts(pager,'test')).length,1251,'Paginação deve atravessar o limite da API');
function mockClient({ failRead=false, failWrite=false }={}) {
 const counts={reads:0,writes:0};
 const client={counts,from(){let kind='';const q={select(){kind='read';return q},eq(){return q},in(){counts.reads++;return Promise.resolve(failRead?{error:{message:'rede indisponível'}}:{data:[],error:null})},upsert(){counts.writes++;return Promise.resolve(failWrite?{error:{message:'falha ao gravar'}}:{error:null})},delete(){kind='delete';return q},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}};return client;
}
const tenant=new Storage({inMemory:true,initialData:{contacts:{}}});tenant.workspaceDirty=false;tenant.dirtyContactIds.clear();
for(let i=0;i<261;i++) tenant.upsertContact(`slot_2::x${i}@lid`,{name:'Teste'}, {deferSave:true});
const good=mockClient();await flushTenantStoreToCloud(good,'test',tenant,{isWorkerSync:true});
assert.equal(good.counts.reads,4,'Mesmo mais de 240 conversas exigem reconciliação');assert.equal(tenant.dirtyContactIds.size,0);
tenant.upsertContact('slot_2::y@lid',{name:'Teste'},{deferSave:true});
await assert.rejects(flushTenantStoreToCloud(mockClient({failRead:true}),'test',tenant,{isWorkerSync:true}));
assert.ok(tenant.dirtyContactIds.has('slot_2::y@lid'),'Erro de leitura deve manter pendência');
await assert.rejects(flushTenantStoreToCloud(mockClient({failWrite:true}),'test',tenant,{isWorkerSync:true}));
assert.ok(tenant.dirtyContactIds.has('slot_2::y@lid'),'Erro de gravação deve manter pendência');
console.log('OK: isolamento por chip, histórico inicial, paginação de 1.251 conversas e retry seguro.');

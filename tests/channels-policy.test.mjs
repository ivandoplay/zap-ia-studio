import test from 'node:test';import assert from 'node:assert/strict';
import {parseChannelInput,isChannelId,filterCrmContacts,channelAllowsAI,channelAllowsCampaign} from '../public/v2/assets/channel-policy.js';
const A='11111111-1111-4111-8111-111111111111';
test('canal: UUID independente de posição, defaults conservadores e booleanos estritos',()=>{
 assert.equal(isChannelId(A),true);for(const id of ['slot_1','slot_4','',{},null])assert.equal(isChannelId(id),false);
 assert.deepEqual(parseChannelInput({name:' Canal novo ',transport:'evolution_api'}),{name:'Canal novo',transport:'evolution_api',crmVisible:true,aiEnabled:false,campaignsEnabled:false,tags:[]});
 for(const key of ['crmVisible','aiEnabled','campaignsEnabled'])for(const v of ['false',0,null])assert.throws(()=>parseChannelInput({[key]:v},{partial:true}));
 for(const body of [{name:''},{ownerId:A},{tags:['x'.repeat(25)]},{transport:'automatico'}])assert.throws(()=>parseChannelInput(body,{partial:true}));
 assert.throws(()=>parseChannelInput({transport:'local_worker'},{partial:true}));
});
test('ocultar no CRM não apaga nem altera mensagens; IA e campanhas são independentes',()=>{
 const policies={[A]:{crmVisible:false,aiEnabled:true,campaignsEnabled:false}},contacts=[{channelId:A,messages:['mensagem sintética']},{channelId:'legacy',messages:['histórico legado']}];
 assert.deepEqual(filterCrmContacts(contacts,policies),[contacts[1]]);assert.deepEqual(filterCrmContacts(contacts,policies,'hidden'),[contacts[0]]);assert.deepEqual(filterCrmContacts(contacts,policies,'all'),contacts);assert.deepEqual(contacts[0].messages,['mensagem sintética']);
 assert.equal(channelAllowsAI(policies[A]),true);assert.equal(channelAllowsCampaign(policies[A]),false);assert.equal(channelAllowsAI({aiEnabled:'true'}),false);
 assert.throws(()=>filterCrmContacts(contacts,policies,'qualquer'));
});

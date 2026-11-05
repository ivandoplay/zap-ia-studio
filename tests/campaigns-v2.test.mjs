import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignDemoStore} from '../public/v2/assets/campaigns-demo.js';
const ids=Array.from({length:4},(_,i)=>`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const draft=()=>({plano:{nome:'Novidades autorizadas',instanceIds:ids,distribution:'rodizio',retomada:'manual',blocos:[{id:'30000000-0000-4000-8000-000000000001',tipo:'texto',modo:'fixo',textos:['Olá, {{nome}}!']}]},opcoes:{},destinatarios:[{telefone:'5586999990001',nome:'Exemplo',campos:{}}]});
test('campanhas novas: rascunho usa quatro UUIDs, não três slots, e salvar nunca inicia',async()=>{
 const store=createCampaignDemoStore({scenario:'empty'}),r=await store.request('/api/campaigns',{method:'POST',body:draft()});
 assert.equal(r.campanha.status,'rascunho');assert.deepEqual(r.campanha.plano.instanceIds,ids);
 const d=await store.request('/api/campaigns/'+r.campanha.campanha_id);
 assert.equal(d.resumo.total,1);assert.equal(d.resumo.concluidos,0);assert.equal(d.revisao,null);
 assert.equal(store.capabilities.canSend,false);assert.equal(store.capabilities.demo,true);
});
test('campanhas novas: suporte, offline e instância sem permissão nunca alteram estado nem trocam saída',async()=>{
 const support=createCampaignDemoStore({scenario:'support'});await assert.rejects(support.request('/api/campaigns',{method:'POST',body:draft()}));
 let online=true;const s=createCampaignDemoStore({scenario:'empty',isOnline:()=>online});const input=draft();input.plano.instanceIds=['20000000-0000-4000-8000-000000000005'];input.plano.distribution='fixo';const {campanha:c}=await s.request('/api/campaigns',{method:'POST',body:input});
 await assert.rejects(s.request('/api/campaigns/'+c.campanha_id+'/control',{method:'POST',body:{acao:'iniciar',expectedRevision:1}}),/offline/);
 assert.equal((await s.request('/api/campaigns/'+c.campanha_id)).campanha.status,'rascunho');online=false;await assert.rejects(s.request('/api/campaigns',{method:'POST',body:draft()}),/Sem rede/);assert.equal((await s.request('/api/campaigns')).campanhas.length,1);
});
test('campanhas novas: limites, slots antigos, identidade externa e campos desconhecidos são rejeitados atomicamente',async()=>{
 const s=createCampaignDemoStore({scenario:'empty'});
 for(const mutate of [d=>d.plano.instanceIds=['slot_1'],d=>d.plano.instanceIds=['20000000-0000-4000-8000-000000000099'],d=>d.plano.ownerId='other',d=>d.ownerId='other',d=>d.plano.blocos[0].textos=['{{empresa}}'],d=>d.destinatarios.push(d.destinatarios[0]),d=>d.opcoes={intervalo_min_ms:5000,intervalo_max_ms:1000},d=>d.plano.blocos[0].textos=['{Olá|Oi'],d=>d.plano.blocos[0].textos=[''],d=>d.opcoes={fuso:'Wrong/Zone'}]){const d=draft();mutate(d);if(d.plano.blocos[0].textos[0]==='{Olá|Oi')d.plano.blocos[0].modo='spintax';await assert.rejects(s.request('/api/campaigns',{method:'POST',body:d}));}
 assert.equal((await s.request('/api/campaigns')).campanhas.length,0);
});
test('campanhas novas: início explícito, CAS, pausa e edição preservam destinatários; sem executor',async()=>{
 const s=createCampaignDemoStore({scenario:'empty'}),{campanha:c}=await s.request('/api/campaigns',{method:'POST',body:draft()}),base='/api/campaigns/'+c.campanha_id;
 await s.request(base+'/control',{method:'POST',body:{acao:'iniciar',expectedRevision:1}});await assert.rejects(s.request(base+'/control',{method:'POST',body:{acao:'pausar',expectedRevision:1}}));await s.request(base+'/control',{method:'POST',body:{acao:'pausar',expectedRevision:2}});
 const before=await s.request(base+'/recipients?inicio=0'),edit=draft();delete edit.destinatarios;edit.plano.nome='Alterada';edit.expectedRevision=3;await s.request(base,{method:'PUT',body:edit});
 assert.deepEqual(await s.request(base+'/recipients?inicio=0'),before);assert.equal((await s.request(base)).resumo.concluidos,0);
});
test('campanhas novas: revisão exige a tentativa exata e não retoma nem reenvia após conferência',async()=>{
 const s=createCampaignDemoStore(),list=await s.request('/api/campaigns'),c=list.campanhas.find(c=>c.status==='pausada'),base='/api/campaigns/'+c.campanha_id,d=await s.request(base),r=d.revisao;
 const body={expectedRevision:c.revisao,conferi:true,destinatarioId:r.destinatario_id,tentativaId:r.tentativa_id,etapa:r.etapa,decisao:'nao_enviada'};
 await assert.rejects(s.request(base+'/resolve',{method:'POST',body:{...body,tentativaId:'30000000-0000-4000-8000-000000000009'}}));
 await s.request(base+'/resolve',{method:'POST',body});const after=await s.request(base);assert.equal(after.revisao,null);assert.equal(after.campanha.status,'pausada');assert.equal(after.resumo.concluidos,0);await assert.rejects(s.request(base+'/resolve',{method:'POST',body}));
});
test('campanhas novas: importação preserva colunas e aponta duplicados; snapshots não permitem alterar o estado',async()=>{
 const s=createCampaignDemoStore({scenario:'empty'});const r=await s.request('/api/campaigns/import-preview',{method:'POST',body:{formato:'csv',texto:'telefone,nome,empresa\n86999990001,Ana,Loja\n86999990001,Ana,Loja\ninválido,Beto,Outra'}});assert.equal(r.destinatarios.length,1);assert.equal(r.destinatarios[0].campos.empresa,'Loja');assert.deepEqual(r.problemas.map(p=>p.tipo),['duplicado','invalido']);
 const {campanha:c}=await s.request('/api/campaigns',{method:'POST',body:draft()});c.status='ativa';assert.equal((await s.request('/api/campaigns/'+c.campanha_id)).campanha.status,'rascunho');s.dispose();await assert.rejects(s.request('/api/campaigns'));
});
test('campanhas novas: arquivos de mídia são só metadata, tipo inválido não causa atualização parcial',async()=>{
 const s=createCampaignDemoStore({scenario:'empty'}),folder='40000000-0000-4000-8000-000000000001',path='/api/campaigns/folders/'+folder+'/files?inicio=0',before=await s.request(path);
 await assert.rejects(s.simulateFiles(folder,[{name:'Foto.jpg',size:99,type:'image/jpeg'},{name:'Áudio.ogg',size:99,type:'audio/ogg'}]));assert.deepEqual(await s.request(path),before);await s.simulateFiles(folder,[{name:'Foto.jpg',size:99,type:'image/jpeg'}]);assert.equal((await s.request(path)).arquivos.length,before.arquivos.length+1);
});
test('campanhas novas: confirmar um bloco não conclui a sequência inteira nem retoma a campanha',async()=>{const s=createCampaignDemoStore(),c=(await s.request('/api/campaigns')).campanhas.find(c=>c.status==='pausada'),base='/api/campaigns/'+c.campanha_id,r=(await s.request(base)).revisao;await s.request(base+'/resolve',{method:'POST',body:{expectedRevision:c.revisao,conferi:true,destinatarioId:r.destinatario_id,tentativaId:r.tentativa_id,etapa:r.etapa,decisao:'confirmada'}});const after=await s.request(base);assert.equal(after.resumo.concluidos,0);assert.equal(after.campanha.status,'pausada');assert.equal(after.revisao,null);});
test('paridade Campanhas: parser de listas e variações permanecem byte-idênticos ao original; controles originais mantidos',async()=>{const fs=await import('node:fs/promises'),{campaignsMarkup}=await import('../public/v2/assets/campaigns-markup.js');for(const [a,b]of [['src/campanhaImportacao.js','public/v2/assets/campaigns-import.js'],['src/campanhaVariacoes.js','public/v2/assets/campaigns-variations.js']])assert.equal(await fs.readFile(a,'utf8'),await fs.readFile(b,'utf8'));const original=(await fs.readFile('public/painel.html','utf8')).split('<section id="tab-campanhas" class="tab-pane">')[1].split('</section>')[0];const ids=[...original.matchAll(/id="(camp[^"]+)"/g)].map(m=>m[1]);assert.ok(ids.length>35);for(const id of ids)assert.ok(campaignsMarkup.includes('id="'+id+'"'),id);assert.doesNotMatch(campaignsMarkup,/value="slot_[123]"/);});

import test from 'node:test';import assert from 'node:assert/strict';
import {criarRepositorioCampanhaSupabase} from '../src/campanhaRepositorio.js';
import {executarPassoCampanha} from '../src/campanhaExecutor.js';
const campaign='11111111-1111-4111-8111-111111111111',recipient='22222222-2222-4222-8222-222222222222',worker='33333333-3333-4333-8333-333333333333',folder='44444444-4444-4444-8444-444444444444',file='55555555-5555-4555-8555-555555555555';
for(const tipo of ['imagem','audio'])test(`Evolution ${tipo}: repositório aceita mídia por ticket sem exigir Buffer Baileys`,async()=>{
 let dispatches=0;
 const material={tipo,arquivoId:file,pastaId:folder,...(tipo==='audio'?{notaVoz:true}:{})};
 const client={async rpc(name,args){const status=name==='ienvia_reservar_worker_campanha'?'em_envio':name==='ienvia_confirmar_etapa'?'confirmada':'incerta';return {data:[{campanha_id:campaign,destinatario_id:recipient,etapa:0,tentativa_id:args.p_tentativa,status,material:args.p_material}],error:null}}};
 const repo=criarRepositorioCampanhaSupabase({client,workerId:worker,selecionar:async()=>({destinatarioId:recipient,telefone:'558600000000',nome:'Teste',etapa:0,revisao:1,slotId:'slot_1',provedor:'evolution_api',material})});
 const result=await executarPassoCampanha({repositorio:repo,campanhaId:campaign,enviar:async action=>{dispatches++;assert.equal(action.anexo,undefined);assert.equal(action.provedor,'evolution_api');assert.deepEqual(action.material,material);return {status:'aceita'}}});
 assert.equal(result.status,'confirmada');assert.equal(dispatches,1);
});
test('Baileys continua exigindo bytes locais e Evolution exige identificadores de mídia válidos',async()=>{
 for(const provider of ['baileys','evolution_api']){
 let reserves=0;const repo=criarRepositorioCampanhaSupabase({client:{rpc:async()=>{reserves++;throw new Error('não reservar')}},workerId:worker,selecionar:async()=>({destinatarioId:recipient,telefone:'558600000000',nome:'Teste',etapa:0,revisao:1,slotId:'slot_1',provedor:provider,material:{tipo:'imagem',arquivoId:'inválido',pastaId:folder}})});
 await assert.rejects(()=>repo.reservar({campanhaId:campaign,tentativaId:file}),/Candidato inválido/);assert.equal(reserves,0);
 }
});

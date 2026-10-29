import test from 'node:test';
import assert from 'node:assert/strict';
import {criarRepositorioCampanhaSupabase} from '../src/campanhaRepositorio.js';
import {executarPassoCampanha} from '../src/campanhaExecutor.js';
const camp='20000000-0000-4000-8000-000000000001',dest='30000000-0000-4000-8000-000000000001';
function ambiente(){
 const db={status:'pendente',material:null,attempt:null,fail:null,calls:[]};
 const client={async rpc(nome,args){db.calls.push([nome,args]);if(db.fail===nome)return {data:null,error:{code:'falha'}};
  if(nome==='ienvia_reservar_worker_campanha'){
   if(db.status!=='pendente')return {data:[],error:null};db.status='em_envio';db.material=args.p_material;db.attempt=args.p_tentativa;
  }else if(nome==='ienvia_confirmar_etapa'||nome==='ienvia_marcar_etapa_incerta'){
   if(db.status!=='em_envio'||db.attempt!==args.p_tentativa)return {data:[],error:null};
   db.status=nome==='ienvia_confirmar_etapa'?'confirmada':'incerta';
  }else throw Error('RPC desconhecida');
  return {data:[{campanha_id:camp,destinatario_id:dest,etapa:0,tentativa_id:db.attempt,status:db.status,material:db.material}],error:null};
 }};
 const selecionar=async()=>({destinatarioId:dest,telefone:'5586981234567',nome:'Teste',etapa:0,revisao:7,slotId:'slot_2',material:{tipo:'texto',texto:'Conteúdo sintético'}});
 return {db,repo:criarRepositorioCampanhaSupabase({client,selecionar,workerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})};
}
test('executa reserva RPC e confirmação da mesma tentativa após envio sintético',async()=>{
 const {db,repo}=ambiente();let n=0;
 const r=await executarPassoCampanha({repositorio:repo,campanhaId:camp,enviar:async a=>{n++;assert.equal(a.slotId,'slot_2');assert.equal(a.material.texto,'Conteúdo sintético');return {status:'aceita'}}});
 assert.equal(r.status,'confirmada');assert.equal(n,1);assert.equal(db.status,'confirmada');
 assert.equal(db.calls[0][0],'ienvia_reservar_worker_campanha');assert.equal(db.calls[0][1].p_revisao,7);
 assert.equal(db.calls[0][1].p_tentativa,db.calls[1][1].p_tentativa);assert.equal(db.calls[1][1].p_destinatario,dest);
});
test('erro ou resposta desconhecida do emissor registra incerteza e bloqueia a próxima execução',async()=>{
 const {db,repo}=ambiente();let n=0;const args={repositorio:repo,campanhaId:camp,enviar:async()=>{n++;throw Error('tempo esgotado')}};
 assert.equal((await executarPassoCampanha(args)).status,'incerta');assert.equal(db.status,'incerta');
 assert.equal((await executarPassoCampanha(args)).status,'indisponivel');assert.equal(n,1);
});
test('erro Supabase é tratado mesmo quando o cliente devolve {error} sem lançar exceção',async()=>{
 const {db,repo}=ambiente();db.fail='ienvia_reservar_worker_campanha';let n=0;
 const r=await executarPassoCampanha({repositorio:repo,campanhaId:camp,enviar:async()=>{n++}});
 assert.equal(r.status,'erro_reserva');assert.equal(n,0);
});
test('conflito de exclusividade SQL é indisponibilidade, nunca autorização de enviar',async()=>{
 const client={rpc:async()=>({data:null,error:{code:'23505'}})};
 const repo=criarRepositorioCampanhaSupabase({client,workerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',selecionar:async()=>({destinatarioId:dest,telefone:'5586981234567',nome:'Teste',etapa:0,revisao:7,slotId:'slot_1',material:{tipo:'texto',texto:'oi'}})});
 let n=0;const r=await executarPassoCampanha({repositorio:repo,campanhaId:camp,enviar:async()=>{n++}});
 assert.equal(r.status,'indisponivel');assert.equal(n,0);
});
test('resposta malformada da reserva nunca chama o emissor',async()=>{
 const {db,repo}=ambiente();const original=repo.reservar;repo.reservar=async p=>{const r=await original(p);return {...r,campanhaId:'campanha errada'}};
 let n=0;const r=await executarPassoCampanha({repositorio:repo,campanhaId:camp,enviar:async()=>{n++}});
 assert.equal(r.status,'incerta');assert.equal(n,0);assert.equal(db.status,'incerta');
});

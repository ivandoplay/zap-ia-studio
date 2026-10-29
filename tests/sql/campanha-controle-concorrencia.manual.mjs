import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
assert.equal(process.env.IENVIAPG_TESTE_ISOLADO,'1');
const base=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55432','-U','postgres','-d','controle_lab'];
const owner='10000000-0000-0000-0000-000000000001';
const auth=`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`;
function run(sql){return new Promise((resolve,reject)=>{const p=spawn('psql',[...base,'-c',auth+sql]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>resolve({code,out:out.trim().split('\n').at(-1),err}));});}
function transacao(comando){
 const p=spawn('psql',base,{stdio:['pipe','pipe','pipe']});let out='',err='';let unlock;
 const ready=new Promise((resolve,reject)=>{unlock=resolve;const timer=setTimeout(()=>reject(Error('Transação não sinalizou lock')),5000);p.stdout.on('data',chunk=>{out+=chunk;if(out.includes('TRAVA_PRONTA')){clearTimeout(timer);unlock()}});p.on('error',reject);});
 p.stderr.on('data',x=>err+=x);p.stdin.write(`${auth} BEGIN; ${comando} SELECT 'TRAVA_PRONTA';\n`);
 const result=new Promise(resolve=>p.on('close',code=>resolve({code,out,err})));
 return {ready,commit:()=>p.stdin.end('COMMIT;\n\\q\n'),result};
}
const camp='20000000-0000-0000-0000-000000000111',dest='30000000-0000-0000-0000-000000000111';
let r=await run(`INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome) VALUES ('${owner}','${camp}','Concorrência'); SELECT public.ienvia_adicionar_etapas('${camp}', '[{"destinatario_id":"${dest}","etapa":0}]'); SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','ativa');`);assert.equal(r.code,0,r.err);assert.equal(r.out,'1');
let tx=transacao(`SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','pausada');`);await tx.ready;
const pedido=run(`SELECT count(*) FROM public.ienvia_reservar_etapa('${camp}','${dest}',0,'40000000-0000-0000-0000-000000000111','{"texto":"simulação"}');`);
tx.commit();const [pausa,reserva]=await Promise.all([tx.result,pedido]);assert.equal(pausa.code,0,pausa.err);assert.equal(reserva.code,0,reserva.err);assert.equal(reserva.out,'0','pausa que detém o lock deve impedir reserva');
r=await run(`SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','ativa');`);assert.equal(r.out,'1');
tx=transacao(`SELECT count(*) FROM public.ienvia_reservar_etapa('${camp}','${dest}',0,'40000000-0000-0000-0000-000000000112','{"texto":"simulação"}');`);await tx.ready;
const pedidoPausa=run(`SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','pausada');`);tx.commit();
const [envio,pausa2]=await Promise.all([tx.result,pedidoPausa]);assert.equal(envio.code,0,envio.err);assert.match(envio.out,/\n1\nTRAVA_PRONTA/);assert.equal(pausa2.code,0,pausa2.err);assert.equal(pausa2.out,'1');
r=await run(`SELECT status FROM public.ienvia_campanha_checkpoints WHERE campanha_id='${camp}';`);assert.equal(r.out,'em_envio','etapa já reservada não deve ser apagada');
r=await run(`UPDATE public.ienvia_campanhas_controle SET status='ativa' WHERE campanha_id='${camp}';`);assert.notEqual(r.code,0);assert.match(r.err,/permission denied/i);
console.log('OK: pausa e reserva serializadas; somente etapa já reservada pode continuar; UPDATE direto negado.');

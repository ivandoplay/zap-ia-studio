import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
assert.equal(process.env.IENVIAPG_TESTE_ISOLADO,'1');
const base=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55432','-U','postgres','-d','controle_lab'];
const owner='10000000-0000-0000-0000-000000000001',camp='20000000-0000-0000-0000-000000000115',dest='30000000-0000-0000-0000-000000000115';
const auth=`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`;
function run(sql,asUser=true){return new Promise((resolve,reject)=>{const p=spawn('psql',[...base,'-c',(asUser?auth:'')+sql]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>resolve({code,out:out.trim().split('\n').at(-1),err}));});}
let r=await run(`INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,restricao_horaria,fuso,dias,inicio,fim) VALUES ('${owner}','${camp}','Janela concorrente',true,'UTC',ARRAY[0,1,2,3,4,5,6]::smallint[],(timezone('UTC',clock_timestamp())::time-interval '1 minute')::time,(timezone('UTC',clock_timestamp())::time+interval '2 second')::time); SELECT public.ienvia_adicionar_etapas('${camp}','[{"destinatario_id":"${dest}","etapa":0}]'); SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','ativa');`);assert.equal(r.code,0,r.err);assert.equal(r.out,'1');
const p=spawn('psql',base,{stdio:['pipe','pipe','pipe']});let out='',err='';p.stderr.on('data',c=>err+=c);
const locked=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lock não adquirido')),4000);p.stdout.on('data',c=>{out+=c;if(out.includes('LOCKED')){clearTimeout(timer);resolve()}});p.on('error',reject)});
const fim=new Promise(resolve=>p.on('close',code=>resolve({code,err})));
p.stdin.write(`${auth} BEGIN; SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','pausada'); SELECT count(*) FROM public.ienvia_alterar_status_campanha('${camp}','ativa'); SELECT 'LOCKED';\n`);await locked;
const reserva=run(`SET application_name='ienvia_janela_reserva'; SELECT count(*) FROM public.ienvia_reservar_etapa('${camp}','${dest}',0,'40000000-0000-0000-0000-000000000115','{"texto":"simulação"}');`);
let waiting=false;for(let i=0;i<40;i++){const q=await run("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ienvia_janela_reserva' AND wait_event_type='Lock';",false);if(q.out==='1'){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,15));}
assert(waiting,'reserva deve estar esperando lock antes da janela fechar');
await new Promise(resolve=>setTimeout(resolve,2200));p.stdin.end('COMMIT;\n\\q\n');const [lockFinal,res]=await Promise.all([fim,reserva]);assert.equal(lockFinal.code,0,lockFinal.err);assert.equal(res.code,0,res.err);assert.equal(res.out,'0','janela precisa ser conferida novamente após adquirir lock');
console.log('OK: espera pelo lock não permite envio após término da janela de horário.');

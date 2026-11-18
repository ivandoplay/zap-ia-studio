import {BufferJSON} from '@whiskeysockets/baileys';
import {abrirFila} from './fila.mjs';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {storage} from '../../src/storage.js';
import {whatsappManager} from '../../src/whatsappManager.js';
import {SupervisorDeSessoes,extrairConteudoMensagemBaileys,normalizarJidParaContato,normalizarTimestampMsg} from './supervisor.mjs';
const painel='https://app.ienvia.online';
const arquivo=path.resolve('data/ponte-ienvia.json');
let cfg=fs.existsSync(arquivo)?JSON.parse(fs.readFileSync(arquivo,'utf8')):null;
if(!cfg){
 const rl=readline.createInterface({input:stdin,output:stdout});const code=(await rl.question('Código NOVO do aparelho Ienvia (IENV-XXXX-XXXX): ')).trim();rl.close();
 const r=await fetch(painel+'/api/motor/parear',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,platform:'android-termux',version:'6.1.0',metadata:{name:'Ponte motor original Termux'}}),signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(!r.ok||!j.device_token)throw new Error(j.erro||'Pareamento recusado');
 cfg={token:j.device_token};fs.mkdirSync('data',{recursive:true});fs.writeFileSync(arquivo,JSON.stringify(cfg),{mode:0o600});
}
storage.data.settings.botEnabled=false;
for(const c of Object.values(storage.data.settings.waSlots))c.aiEnabled=false;
storage.data.contacts={};storage.data.proactiveQueue=[];whatsappManager.proactiveQueue=[];whatsappManager.proactiveQueuePaused=true;clearInterval(whatsappManager.followUpTimer);
const motor=whatsappManager.getSlot('slot_1');
const sup=new SupervisorDeSessoes({rootDir:process.cwd(),panelUrl:painel,deviceToken:cfg.token});
// O adaptador usa exclusivamente a sessão original; não cria um segundo WASocket.
sup.iniciarConexao=async()=>{throw new Error('Use a sessão original já pareada neste aparelho.');};
let instancia=null,observado=null,estadoPublicado=null,parar=false;
function phoneKey(v){let n=String(v||'').replace(/\D/g,'');return n.startsWith('55')&&n.length===13&&n[4]==='9'?n.slice(0,4)+n.slice(5):n;}
async function observar(sock){
 if(observado===sock)return;observado=sock;
 sock.ev.on('messages.upsert',({type,messages})=>{
  if(!['notify','append'].includes(type)||!instancia)return;
  for(const msg of messages||[]){
   if(!msg.key?.id)continue;
   try{fila.guardar('evento:'+instancia+':'+msg.key.id,{tipo:'evento',instance:instancia,msg:JSON.stringify(msg,BufferJSON.replacer)});}
   catch(e){console.error('[ponte] ERRO DE DISCO: evento não salvo:',e.message);}
  }
 });
 sock.ev.on('messages.update',updates=>{
  if(!instancia)return;
  for(const u of updates||[]){if(u.key?.fromMe && u.key.id && [0,3,4,5].includes(u.update?.status)){
   try{fila.guardar('recibo:'+instancia+':'+u.key.id+':'+u.update.status,{tipo:'recibo',instance:instancia,id:u.key.id,status:u.update.status});}catch(e){console.error('[ponte] Falha ao salvar recibo:',e.message);}
  }}
 });

}
const fila=abrirFila(path.resolve('data/ponte-fila'));
async function escoarFila(){
 for(const item of fila.listar()){
  const v=item.valor;
  if(v.instance!==instancia)continue;
  try{
   if(v.tipo==='recibo'){
    const r=await sup.chamarApi('/api/motor/recibos',{instance_id:instancia,receipts:[{id:v.id,status:v.status}]});
    if(r.result!=='ok'||r.pending)continue;
   }else{
    const msg=JSON.parse(v.msg,BufferJSON.reviver);const sock=motor.sock;
    let jid=normalizarJidParaContato(msg.key?.remoteJid)||normalizarJidParaContato(msg.key?.remoteJidAlt);
    if(!jid&&msg.key?.remoteJid?.endsWith('@lid'))jid=normalizarJidParaContato(await sock.signalRepository?.lidMapping?.getPNForLID(msg.key.remoteJid));
    if(!jid)continue;
    const x=extrairConteudoMensagemBaileys(msg);
    if(!x){fila.confirmar(item.nome);continue;}
    const r=await sup.chamarApi('/api/motor/eventos',{instance_id:instancia,event_id:msg.key.id,sender_jid:jid,push_name:msg.pushName||'',body_text:x.text,occurred_at:normalizarTimestampMsg(msg.messageTimestamp),from_me:Boolean(msg.key.fromMe),media:x.media});
    if(!['accepted','duplicate'].includes(r.result))continue;
    if(r.message_id&&r.media?.status==='pending'&&x.mediaMessage)await sup.enviarMidiaRecebida(r.message_id,x.mediaMessage,x.media);
   }
   fila.confirmar(item.nome);console.log('[ponte] Sincronizado:',v.tipo);
  }catch(e){console.log('[ponte] Entrada preservada para nova tentativa:',e.message);}
 }
}
// Identifica o chip antes de abrir o socket para capturar mensagens pendentes.
const inicial=await sup.chamarApi('/api/motor/pulso',{platform:'android-termux',version:'6.1.0'});
const iniciais=(inicial.instances||[]).filter(i=>i.status!=='revoked');
if(iniciais.length!==1)throw new Error('Vincule exatamente um chip ao aparelho antes de iniciar a ponte.');
instancia=iniciais[0].id;
const vigia=setInterval(()=>{if(motor.sock&&observado!==motor.sock)observar(motor.sock).catch(e=>console.log('[ponte] Falha ao observar socket:',e.message));},100);
await motor.connect();
console.log('[ponte] Motor original iniciado. Vincule UM chip local a este aparelho no painel.');
process.on('SIGINT',()=>{parar=true;if(motor.sock)motor.destroySocketSilently(motor.sock);process.exit(0);});
while(!parar){try{
 const pulso=await sup.chamarApi('/api/motor/pulso',{platform:'android-termux',version:'6.1.0'});
 const chips=(pulso.instances||[]).filter(i=>i.status!=='revoked');
 if(chips.length>1)throw new Error('Use apenas um chip neste aparelho de teste.');
 if(chips.length===1&&motor.status==='connected'&&motor.sock){
  const chip=chips[0];const real=motor.sock.user?.id?.split(':')[0]?.split('@')[0];
  if(chip.connected_phone&&phoneKey(chip.connected_phone)!==phoneKey(real))throw new Error('O chip do painel pertence a outro número; operação bloqueada.');
  instancia=chip.id;await observar(motor.sock);
  sup.sessoes.set(instancia,{sock:motor.sock,status:'connected'});
  const chave=instancia+':'+real;
  if(estadoPublicado!==chave||chip.status!=='connected'){await sup.chamarApi('/api/motor/estado',{instance_id:instancia,status:'connected',connected_phone:'+'+real});estadoPublicado=chave;console.log('[ponte] Chip conectado ao Ienvia.');}
  await escoarFila();
  const lote=await sup.chamarApi('/api/motor/comandos',null,'GET');
  for(const cmd of lote.commands||[]){
   if(cmd.instance_id!==instancia){await sup.chamarApi('/api/motor/comandos',{command_id:cmd.id,outcome:'failed',error_detail:'Instância diferente da sessão autorizada.'});continue;}
   if(cmd.command_type==='connect_qr'||cmd.command_type==='connect_code'){await sup.chamarApi('/api/motor/comandos',{command_id:cmd.id,outcome:'succeeded'});continue;}
   if(!['send_text','send_media'].includes(cmd.command_type)){await sup.chamarApi('/api/motor/comandos',{command_id:cmd.id,outcome:'failed',error_detail:'Este adaptador de teste permite somente envio de texto/mídia. Desconecte localmente.'});continue;}
   await sup.executarComando(cmd);console.log('[ponte] Comando processado:',cmd.command_type);
  }
 }
}catch(e){console.log('[ponte] Aviso:',e.message);}
await new Promise(r=>setTimeout(r,3000));
}

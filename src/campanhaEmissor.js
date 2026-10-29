// Adaptador de envio por chip. Uma chamada ao socket por bloco, sem retry.
const extensoes={'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/webm':'webm'};
export function criarEmissorCampanha({obterSlot,podeEnviar=()=>true,registrar=()=>{},aoErro=()=>{}}={}){
 if(typeof obterSlot!=='function'||typeof podeEnviar!=='function'||typeof registrar!=='function'||typeof aoErro!=='function')throw new Error('Emissor inválido.');
 return async acao=>{
  if(!acao||!['slot_1','slot_2','slot_3'].includes(acao.slotId)||typeof acao.telefone!=='string'||!/^[1-9][0-9]{7,14}$/.test(acao.telefone)||!acao.material||!['texto','imagem','audio'].includes(acao.material.tipo))throw new Error('Ação inválida.');
  const slot=obterSlot(acao.slotId);if(!slot||slot.slotId&&slot.slotId!==acao.slotId||slot.status!=='connected'||!slot.sock)throw new Error('Chip indisponível.');
  const socket=slot.sock;
  const checar=async()=>{
   if(slot.sock!==socket||slot.status!=='connected'||!await podeEnviar(acao)||slot.sock!==socket||slot.status!=='connected')throw new Error('Sessão ou contato indisponível para envio.');
  };
  await checar();
  const jid=`${acao.telefone}@s.whatsapp.net`;let enviado;
  if(acao.material.tipo==='texto'){
   if(typeof acao.material.texto!=='string'||!acao.material.texto.trim()||acao.material.texto.length>10000||typeof socket.sendMessage!=='function')throw new Error('Texto inválido.');
   enviado=await socket.sendMessage(jid,{text:acao.material.texto});
  }else{
   if(!acao.anexo||!Buffer.isBuffer(acao.anexo.buffer)||!acao.anexo.buffer.length||acao.anexo.buffer.length>35*1024*1024||typeof acao.anexo.mime!=='string')throw new Error('Anexo inválido.');
   if(acao.material.tipo==='imagem'){
    if(!['image/jpeg','image/png','image/webp'].includes(acao.anexo.mime))throw new Error('Imagem inválida.');
    enviado=await socket.sendMessage(jid,{image:acao.anexo.buffer});
   }else if(acao.material.notaVoz===true){
    if(typeof slot.sendCanonicalVoiceNote!=='function'||!Buffer.isBuffer(acao.anexo.voz?.buffer)||!acao.anexo.voz.buffer.length)throw new Error('Nota de voz não foi preparada.');
    enviado=await slot.sendCanonicalVoiceNote({chatId:jid,oggBuffer:acao.anexo.voz.buffer,durationSec:acao.anexo.voz.durationSec,waveform:acao.anexo.voz.waveform,beforeSend:checar});
   }else if(acao.material.notaVoz===false&&extensoes[acao.anexo.mime]){
    enviado=await socket.sendMessage(jid,{document:acao.anexo.buffer,mimetype:acao.anexo.mime,fileName:`audio.${extensoes[acao.anexo.mime]}`});
   }else throw new Error('Áudio inválido.');
  }
  if(typeof enviado?.key?.id!=='string'||!enviado.key.id)return {status:'incerta'};
  try{slot.rememberBotMessage?.(enviado);}catch{ /* Aceitação não deve ser convertida em reenvio. */ }
  // Registro não pode converter uma aceitação em falha e induzir reenvio.
  Promise.resolve().then(()=>registrar({acao,jid,enviado,slot})).catch(()=>{try{aoErro('Falha ao registrar o envio no histórico.');}catch{}});
  return {status:'aceita'};
 };
}

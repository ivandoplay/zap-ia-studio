// Identificação conservadora: somente a última saída identificada como campanha.
// Quando faltar evidência, a regra preexistente de opt-out continua em vigor.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function campanhaDaConversa(priorHistory){
 if(!Array.isArray(priorHistory))return null;
 const ultima=[...priorHistory].reverse().find(m=>m?.role==='assistant'||m?.role==='owner');
 return ultima&&UUID.test(ultima.campaignId||'')?ultima.campaignId:null;
}
export function pedidoExplicitoParada(texto){
 if(typeof texto!=='string')return false;
 const t=texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').slice(0,5000);
 const pausa=/(?:^|[.!?;,]\s*|\bpor favor\s*,?\s*)(?:pare|para|parem)\s+de\s+(?:me\s+)?(?:mandar|enviar|ligar|contatar|chamar)\b/;
 const nao=/(?:^|[.!?;,]\s*|\bpor favor\s*,?\s*)nao\s+(?:(?:me\s+)?(?:mande|envie|ligue|chame)|quero\s+(?:mais\s+)?receber)\b/;
 const remocao=/(?:^|[.!?;,]\s*|\bpor favor\s*,?\s*)(?:retire|remova|exclua|tire)\s+(?:o\s+)?(?:meu|minha)\s+(?:numero|contato|telefone|nome)\b/;
 return pausa.test(t)||nao.test(t)||remocao.test(t);
}
export function respostaParadaCampanha({actions,priorHistory,userText}={}){
 if((!actions?.optOutReason&&!pedidoExplicitoParada(userText))||!campanhaDaConversa(priorHistory))return null;
 return 'Entendi. Obrigado por avisar e desculpe pelo incômodo.';
}

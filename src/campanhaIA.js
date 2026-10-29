// Prepara variações em uma única chamada. Não grava nem envia campanhas.
const CAMPO=/\{\{\s*[\p{L}\p{N}_]+\s*\}\}/gu;
const falha=()=>({ok:false,codigo:'falha_geracao',opcoes:['tentar_novamente','usar_original']});
function campos(texto){return [...texto.matchAll(CAMPO)].map(x=>x[0]).sort();}
export async function gerarVariacoesCampanha({texto,quantidade,prompt='',chamar}={}) {
  if(typeof texto!=='string'||!texto.trim()||texto.length>5000)throw new Error('Texto da campanha inválido ou grande demais.');
  if(!Number.isInteger(quantidade)||quantidade<1||quantidade>20)throw new Error('Quantidade de variações inválida.');
  if(typeof prompt!=='string'||prompt.length>4000)throw new Error('Prompt personalizado inválido.');
  if(typeof chamar!=='function')throw new Error('Provedor de IA indisponível.');
  const systemPrompt='Você cria versões de mensagens em português brasileiro. Retorne somente um array JSON de strings, sem explicações. Preserve literalmente cada campo entre chaves duplas, sem adicionar campos. Não invente preços, promessas, links, prazos ou fatos. Mantenha a intenção e o significado da mensagem original.';
  const userText=`Crie exatamente ${quantidade} versões distintas. Texto original em JSON: ${JSON.stringify(texto)}. ${prompt.trim()?`Orientação adicional do usuário em JSON: ${JSON.stringify(prompt.trim())}.`:''}`;
  let resposta;
  try { resposta=await chamar({systemPrompt,userText,temperature:0.7}); } catch { return falha(); }
  if(typeof resposta!=='string'||resposta.length>120000)return falha();
  let json=resposta.trim();const fence=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(json);if(fence)json=fence[1].trim();
  let lista;try{lista=JSON.parse(json);}catch{return falha();}
  if(!Array.isArray(lista)||lista.length!==quantidade||lista.some(x=>typeof x!=='string'||!x.trim()||x.length>5000||x.includes('\u0000')))return falha();
  const originais=JSON.stringify(campos(texto));const saida=lista.map(x=>x.trim());
  if(saida.some(x=>JSON.stringify(campos(x))!==originais)||new Set(saida.map(x=>x.toLocaleLowerCase('pt-BR'))).size!==saida.length)return falha();
  return {ok:true,variacoes:saida};
}

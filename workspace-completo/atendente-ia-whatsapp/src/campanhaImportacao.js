// Importação isolada. Valida formato, não comprova propriedade nem existência de WhatsApp.
const MAX_CARACTERES=2000000;
const MAX_LINHAS=10001;
const MAX_COLUNAS=100;
function validarTexto(texto) {
  if (typeof texto !== 'string') throw new Error('Texto de importação inválido.');
  if (texto.length>MAX_CARACTERES) throw new Error('Limite de tamanho da lista excedido.');
}
export function interpretarCsv(texto,separador=',') {
  validarTexto(texto);
  if (![',',';','\t'].includes(separador)) throw new Error('Separador inválido.');
  if(texto.startsWith('\ufeff')) texto=texto.slice(1);
  const linhas=[];let linha=[],campo='',aspas=false,fechado=false,inicio=true,linhaFisica=1,inicioRegistro=1;
  const campoFinal=()=>{linha.push(campo);if(linha.length>MAX_COLUNAS) throw new Error('Limite de colunas excedido.');campo='';inicio=true;fechado=false;};
  const linhaFinal=()=>{campoFinal();if(linha.some(v=>v!=='')){Object.defineProperty(linha,'numeroLinha',{value:inicioRegistro});linhas.push(linha);if(linhas.length>MAX_LINHAS) throw new Error('Limite de linhas excedido.');}linha=[];};
  for(let i=0;i<texto.length;i++) {
    const c=texto[i];
    if(aspas){
      if(c==='"'){if(texto[i+1]==='"'){campo+='"';i++;}else{aspas=false;fechado=true;}}
      else if(c==='\r'&&texto[i+1]==='\n'){campo+='\r\n';i++;linhaFisica++;}
      else {campo+=c;if(c==='\r'||c==='\n')linhaFisica++;}
      continue;
    }
    if(c===separador){campoFinal();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r' && texto[i+1]==='\n')i++;linhaFinal();linhaFisica++;inicioRegistro=linhaFisica;continue;}
    if(fechado)throw new Error('CSV inválido após fechamento de aspas.');
    if(c==='"'){if(!inicio)throw new Error('CSV inválido: aspas inesperadas.');aspas=true;inicio=false;continue;}
    campo+=c;inicio=false;
  }
  if(aspas)throw new Error('CSV inválido: aspas não fechadas.');
  if(campo!==''||linha.length||fechado)linhaFinal();
  return linhas;
}
export function normalizarTelefoneCampanha(entrada) {
  if(typeof entrada!=='string')return null;
  const s=entrada.trim();
  if(!/^\+?[\d\s().-]+$/.test(s))return null;
  const digitos=s.replace(/\D/g,'');
  if(s.startsWith('+')) {
    if(digitos.length<8||digitos.length>15||digitos[0]==='0')return null;
    if(digitos.startsWith('55') && ![12,13].includes(digitos.length))return null;
    return digitos;
  }
  if([10,11].includes(digitos.length) && digitos[0]!=='0')return '55'+digitos;
  if([12,13].includes(digitos.length) && digitos.startsWith('55') && digitos[2]!=='0')return digitos;
  return null;
}
const cabecalho=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function importarLinhasDestinatarios(linhas, {cabecalhoPresente = true} = {}) {
  if (!Array.isArray(linhas) || linhas.length > MAX_LINHAS || linhas.some(l => !Array.isArray(l) || l.length > MAX_COLUNAS)) throw new Error('Limite ou formato de linhas inválido.');
  let tel=0, nome=-1, primeiraLinha=1, colunasExtras=[];
  const numerosOriginais=linhas.map(l=>l.numeroLinha);
  linhas=linhas.map(l=>l.slice());
  if (cabecalhoPresente) {
    if (!linhas.length) return {destinatarios:[],problemas:[]};
    const cab=linhas.shift().map(cabecalho);numerosOriginais.shift();
    const telefones=cab.map((v,i)=>['telefone','celular','whatsapp','numero','phone'].includes(v)?i:-1).filter(i=>i>=0);
    const nomes=cab.map((v,i)=>['nome','name'].includes(v)?i:-1).filter(i=>i>=0);
    if(!telefones.length)throw new Error('Lista precisa ter uma coluna de telefone identificada.');
    if(telefones.length>1||nomes.length>1)throw new Error('Cabeçalho ambíguo: informe apenas uma coluna de telefone e uma de nome.');
    tel=telefones[0];nome=nomes[0]??-1;primeiraLinha=2;
    const chaves=new Set();
    cab.forEach((v,i)=>{
      if(i===tel||i===nome||!v)return;
      if(['__proto__','prototype','constructor'].includes(v))throw new Error('Nome de coluna inválido.');
      const chave=v.replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
      if(!chave||chave.length>60||['__proto__','prototype','constructor','nome','telefone'].includes(chave))throw new Error('Nome de coluna inválido.');
      if(chaves.has(chave))throw new Error('Colunas adicionais duplicadas.');
      chaves.add(chave);colunasExtras.push({indice:i,chave});
    });
  }
  const destinatarios=[],problemas=[],vistos=new Set();let caracteres=0;
  linhas.forEach((linha,indice)=>{
    caracteres+=linha.reduce((sum,x)=>sum+(typeof x==='string'?x.length:0),0);
    if(caracteres>MAX_CARACTERES)throw new Error('Limite de dados da lista excedido.');
    if(linha.every(x=>x==null||String(x).trim()===''))return;
    const celula=linha[tel];
    const textoTelefone=typeof celula==='string'?celula:(typeof celula==='number'&&Number.isSafeInteger(celula)?String(celula):'');
    const numero=normalizarTelefoneCampanha(textoTelefone);
    if(!numero){problemas.push({linha:numerosOriginais[indice]??indice+primeiraLinha,tipo:'invalido'});return;}
    if(vistos.has(numero)){problemas.push({linha:numerosOriginais[indice]??indice+primeiraLinha,tipo:'duplicado'});return;}
    const nomeContato=nome<0?'':(typeof linha[nome]==='string'?linha[nome].trim():'');
    if(nomeContato.length>200){problemas.push({linha:numerosOriginais[indice]??indice+primeiraLinha,tipo:'nome_muito_longo'});return;}
    const campos={};
    for(const coluna of colunasExtras){
      const valor=linha[coluna.indice];
      const texto=valor == null ? '' : (valor instanceof Date && !Number.isNaN(valor.getTime()) ? valor.toISOString() : String(valor).trim());
      if(texto.length>2000){problemas.push({linha:numerosOriginais[indice]??indice+primeiraLinha,tipo:'campo_muito_longo'});return;}
      campos[coluna.chave]=texto;
    }
    vistos.add(numero);destinatarios.push({nome:nomeContato,telefone:numero,...(colunasExtras.length?{campos}:{})});
  });
  return {destinatarios,problemas};
}
export function importarDestinatarios({texto,formato,separador=','}={}) {
  validarTexto(texto);
  if(formato==='txt') {
    const linhas=texto.replace(/^\ufeff/,'').split(/\r\n|\n|\r/).map(v=>[v]);
    return importarLinhasDestinatarios(linhas,{cabecalhoPresente:false});
  }
  if(formato==='csv') return importarLinhasDestinatarios(interpretarCsv(texto,separador));
  throw new Error('Formato de importação não suportado.');
}

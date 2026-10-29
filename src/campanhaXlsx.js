import { Parser } from 'saxen';
import { readSheet } from 'read-excel-file/node';
import { createZipBuffer, extractZipBuffer } from './zipReader.js';
import { importarLinhasDestinatarios } from './campanhaImportacao.js';

const MAX_COMPRIMIDO=5*1024*1024;
const MAX_EXPANDIDO=15*1024*1024;
const MAX_LINHAS=10001;
const MAX_COLUNAS=100;
const MAX_CELULAS=200000;

function verificarReferencia(ref) {
  if (typeof ref !== 'string' || !ref) throw new Error('Referência de planilha inválida.');
  for (const pedaco of ref.split(':')) {
    const m=/^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(pedaco);
    if(!m)throw new Error('Referência de planilha inválida.');
    let coluna=0;for(const ch of m[1].toUpperCase())coluna=coluna*26+ch.charCodeAt(0)-64;
    const linha=Number(m[2]);
    if(!linha||linha>MAX_LINHAS||coluna>MAX_COLUNAS)throw new Error('Planilha excede limite de linhas ou colunas.');
  }
}
function verificarXml(xml, contagem, nomes, ehRelacaoWorkbook=false) {
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error('Declarações XML não permitidas.');
  const parser=new Parser();
  parser.on('error',()=>{throw new Error('XML de planilha inválido.');});
  parser.on('openTag',(nome,getAttrs,decode)=>{
    if(++contagem.nos>500000)throw new Error('Planilha excede limite de elementos XML.');
    const tag=nome.split(':').pop();
    if(!['row','c','dimension','mergeCell','numFmt','Relationship'].includes(tag))return;
    // A biblioteca consumidora remove prefixos de atributos; faça o mesmo antes
    // de validar e recuse colisões, para não interpretar um valor diferente dela.
    const attrs=Object.create(null);
    for(const [nomeOriginal,valor] of Object.entries(getAttrs())) {
      if(nomeOriginal.startsWith('xmlns:')||nomeOriginal==='xmlns')continue;
      const chave=nomeOriginal.includes(':')?nomeOriginal.slice(nomeOriginal.indexOf(':')+1):nomeOriginal;
      if(Object.hasOwn(attrs,chave))throw new Error('Atributos XML ambíguos.');
      attrs[chave]=valor;
    }
    if(ehRelacaoWorkbook && tag==='Relationship') {
      const tipo=decode(attrs.Type||'');
      const tipos=['http://schemas.openxmlformats.org/officeDocument/2006/relationships/','http://purl.oclc.org/ooxml/officeDocument/relationships/'];
      if(tipos.some(base=>['worksheet','sharedStrings','styles'].some(s=>tipo===base+s))) {
        const alvo=decode(attrs.Target||'');
        const caminho=alvo.startsWith('/')?alvo.slice(1):'xl/'+alvo;
        if(!alvo||decode(attrs.TargetMode||'').toLowerCase()==='external'||/[\\\\?#%]/.test(caminho)||
           caminho.split('/').some(p=>!p||p==='.'||p==='..')||!caminho.toLowerCase().endsWith('.xml')||!nomes.has(caminho)) {
          throw new Error('Caminho de relação XML inválido.');
        }
      }
    }
    if(tag==='numFmt' && attrs.numFmtId) {
      const id=decode(attrs.numFmtId);
      if(!/^\d{1,5}$/.test(id)||Number(id)>50000)throw new Error('Planilha excede limite de formato.');
    }
    if(tag==='row'){
      if(++contagem.linhas>MAX_LINHAS)throw new Error('Planilha excede limite de linhas.');
      if(attrs.r && (!/^\d{1,7}$/.test(decode(attrs.r)) || Number(decode(attrs.r))>MAX_LINHAS || Number(decode(attrs.r))<1))throw new Error('Planilha excede limite de linhas.');
    }
    if(tag==='c'){
      if(++contagem.celulas>MAX_CELULAS)throw new Error('Planilha excede limite de células.');
      verificarReferencia(decode(attrs.r||''));
    }
    if((tag==='dimension'||tag==='mergeCell')&&attrs.ref)verificarReferencia(decode(attrs.ref));
  });
  parser.parse(xml);
}
export async function importarXlsx(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length>MAX_COMPRIMIDO)throw new Error('Arquivo de planilha inválido ou acima do limite.');
  const descompactado=extractZipBuffer(buffer,{maxTotalBytes:MAX_EXPANDIDO,maxFiles:250});
  const nomes=new Set();const contagem={linhas:0,celulas:0,nos:0};
  for(const f of descompactado.files){
    if(nomes.has(f.path))throw new Error('Arquivo de planilha com entradas duplicadas.');
    nomes.add(f.path);
  }
  for(const f of descompactado.files) {
    if(/\.(?:xml|rels)$/i.test(f.path))verificarXml(f.buffer.toString('utf8'),contagem,nomes,f.path==='xl/_rels/workbook.xml.rels');
  }
  if(!nomes.has('[Content_Types].xml')||!nomes.has('xl/workbook.xml'))throw new Error('Planilha XLSX inválida.');
  // Reconstrói o ZIP a partir das entradas validadas, evitando interpretações
  // divergentes de caminhos, tamanhos ou headers pelo leitor externo.
  const normalizado=createZipBuffer(descompactado.files.map(f=>({path:f.path,content:f.buffer})));
  let linhas;
  try { linhas=await readSheet(normalizado,1); } catch { throw new Error('Não foi possível ler a planilha XLSX.'); }
  return importarLinhasDestinatarios(linhas);
}

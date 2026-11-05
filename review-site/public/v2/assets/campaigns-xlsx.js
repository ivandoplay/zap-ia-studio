// Leitura local, limitada, sem rede. O leitor recebe um novo ZIP composto apenas de bytes verificados.
import {importarLinhasDestinatarios} from './campaigns-import.js';
const MAX=4*1024*1024,EXPANDED=15*1024*1024;
const fail=message=>{throw Error(message||'Planilha XLSX inválida ou acima dos limites seguros.');};
const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const text=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{fail();}};
function zipPath(p){if(!p||p.length>500||/[\\\u0000-\u001f\u007f]/.test(p)||p.startsWith('/')||p.includes(':')||p.split('/').some(x=>!x||x==='.'||x==='..'))fail('Planilha contém caminho não permitido.');return p;}
async function inflate(bytes,size,budget){if(size>budget)fail('Planilha excede o limite de expansão.');let stream;try{stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{fail('Este navegador não oferece a leitura segura de XLSX. Use CSV ou TXT.');}const reader=stream.getReader(),chunks=[];let total=0;try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>size||total>budget){await reader.cancel();fail('Planilha excede o limite de expansão.');}chunks.push(value);}}finally{reader.releaseLock();}if(total!==size)fail();const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;}
export async function unpackCampaignXlsx(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX)fail();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=o=>v.getUint16(o,true),u32=o=>v.getUint32(o,true);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0||u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==u16(end+10))fail();const count=u16(end+10),central=u32(end+16),length=u32(end+12);if(count<1||count>250||central+length!==end)fail('Planilha excede os limites de arquivos.');
 const names=new Set(),entries=[],ranges=[];let at=central,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||u32(at)!==0x02014b50)fail();const flags=u16(at+8),method=u16(at+10),checksum=u32(at+16),packed=u32(at+20),size=u32(at+24),nameSize=u16(at+28),extra=u16(at+30),comment=u16(at+32),local=u32(at+42);if(at+46+nameSize+extra+comment>end||u16(at+34)!==0||(flags&1)||![0,8].includes(method)||total+size>EXPANDED)fail('Planilha protegida ou acima dos limites seguros.');
  const path=zipPath(text(bytes.subarray(at+46,at+46+nameSize)));if(names.has(path))fail('Planilha contém entradas duplicadas.');names.add(path);
  if(local+30>central||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail();const start=local+30+u16(local+26)+u16(local+28),stop=start+packed;if(stop>central||start>central||text(bytes.subarray(local+30,local+30+u16(local+26)))!==path||ranges.some(([a,b])=>local<b&&stop>a))fail();ranges.push([local,stop]);
  if(!(flags&8)&&(u32(local+14)!==checksum||u32(local+18)!==packed||u32(local+22)!==size))fail();let buffer;
  if(method===0){if(size!==packed)fail();buffer=bytes.slice(start,stop);}else buffer=await inflate(bytes.subarray(start,stop),size,EXPANDED-total);
  if(crc(buffer)!==checksum)fail('Planilha incompleta ou corrompida.');entries.push({path,buffer});total+=size;at+=46+nameSize+extra+comment;
 }
 if(at!==end||!names.has('[Content_Types].xml')||!names.has('xl/workbook.xml')||!names.has('xl/_rels/workbook.xml.rels'))fail();return entries;
}
function validateXml(entries){
 const names=new Set(entries.map(e=>e.path));let nodes=0,estimatedNodes=0,rows=0,cells=0;
 const coordinate=s=>{for(const ref of s.split(':')){const m=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);let col=0;if(!m)fail('Planilha contém referência inválida.');for(const c of m[1])col=col*26+c.charCodeAt(0)-64;if(col>100||Number(m[2])>10001)fail('Planilha excede o limite de linhas ou colunas.');}};
 for(const e of entries){
  if(!/\.(?:xml|rels)$/i.test(e.path))fail('Planilha contém conteúdo não permitido.');const xml=text(e.buffer);if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))fail('Declarações XML não permitidas.');let depth=0;for(const token of xml.matchAll(/<\/?[^!?\s/>][^>]*>/g)){const tag=token[0];if(tag.startsWith('</'))depth=Math.max(0,depth-1);else{if(++estimatedNodes>500000||!tag.endsWith('/>')&&++depth>128)fail('Planilha excede o limite de nós ou profundidade.');}}const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.getElementsByTagName('parsererror').length)fail('XML de planilha inválido.');
  for(const n of doc.getElementsByTagName('*')){
   if(++nodes>500000)fail('Planilha excede o limite de nós.');const tag=n.localName;
   for(const attr of n.attributes)if(attr.prefix&&['Target','TargetMode','Type','Id'].includes(attr.localName))fail('Relação XML não permitida.');
   if(tag==='Relationship'){
    const target=n.getAttribute('Target')||'';if(n.getAttribute('TargetMode')==='External'||/[\\?#:]/.test(target))fail('Relação externa não permitida.');const base=e.path==='_rels/.rels'?'':e.path.replace(/_rels\/[^/]+\.rels$/,'');let p=target.startsWith('/')?target.slice(1):base+target;const normalized=[];for(const part of p.split('/')){if(part==='..'){if(!normalized.length)fail();normalized.pop();}else if(part&&part!=='.')normalized.push(part);}p=zipPath(normalized.join('/'));if(!names.has(p)||!p.endsWith('.xml'))fail('Relação de planilha inválida.');
   }
   if(tag==='row'){if(++rows>10001||n.hasAttribute('r')&&(!/^[1-9][0-9]{0,6}$/.test(n.getAttribute('r'))||Number(n.getAttribute('r'))>10001))fail('Planilha excede o limite de linhas.');}
   if(tag==='c'){if(++cells>200000)fail('Planilha excede o limite de células.');coordinate(n.getAttribute('r')||'');}
   if(['dimension','mergeCell'].includes(tag)&&n.hasAttribute('ref'))coordinate(n.getAttribute('ref'));
   if(tag==='numFmt'&&(!/^\d{1,5}$/.test(n.getAttribute('numFmtId')||'')||Number(n.getAttribute('numFmtId'))>50000))fail('Planilha excede o limite de formatos.');
  }
 }
}
function normalizedZip(entries){
 const encoder=new TextEncoder(),names=entries.map(e=>encoder.encode(e.path)),size=entries.reduce((n,e,i)=>n+30+names[i].length+e.buffer.length+46+names[i].length,22),out=new Uint8Array(size),v=new DataView(out.buffer),records=[];let at=0;
 const u16=(o,n)=>v.setUint16(o,n,true),u32=(o,n)=>v.setUint32(o,n,true);
 entries.forEach((e,i)=>{const name=names[i],offset=at,checksum=crc(e.buffer);u32(at,0x04034b50);u16(at+4,20);u16(at+6,2048);u32(at+14,checksum);u32(at+18,e.buffer.length);u32(at+22,e.buffer.length);u16(at+26,name.length);out.set(name,at+30);out.set(e.buffer,at+30+name.length);at+=30+name.length+e.buffer.length;records.push({offset,checksum});});const central=at;
 entries.forEach((e,i)=>{const name=names[i],r=records[i];u32(at,0x02014b50);u16(at+4,20);u16(at+6,20);u16(at+8,2048);u32(at+16,r.checksum);u32(at+20,e.buffer.length);u32(at+24,e.buffer.length);u16(at+28,name.length);u32(at+42,r.offset);out.set(name,at+46);at+=46+name.length;});u32(at,0x06054b50);u16(at+8,entries.length);u16(at+10,entries.length);u32(at+12,at-central);u32(at+16,central);return out;
}
export async function readCampaignXlsx(file,{readRows=globalThis.readXlsxFile}={}){
 if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX)fail();const entries=await unpackCampaignXlsx(new Uint8Array(await file.arrayBuffer()));validateXml(entries);if(typeof readRows!=='function')fail('Leitor de XLSX indisponível. Use CSV ou TXT.');let sheets;
 try{sheets=await readRows(new Blob([normalizedZip(entries)]),{sheets:[1]});}catch{fail('Não foi possível ler a primeira planilha XLSX.');}
 if(!Array.isArray(sheets)||!Array.isArray(sheets[0]?.data))fail();return importarLinhasDestinatarios(sheets[0].data);
}

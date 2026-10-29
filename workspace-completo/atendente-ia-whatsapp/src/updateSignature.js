import crypto from 'node:crypto';

function catalog(entries) {
  const seen=new Set();
  return entries.map(({zipPath,content})=>{
    if(typeof zipPath!=='string' || !zipPath.startsWith('ZAP-IA-Studio/') || !Buffer.isBuffer(content)) throw new Error('Arquivo inválido no pacote de atualização.');
    if(seen.has(zipPath))throw new Error('Arquivo duplicado no pacote de atualização.');
    seen.add(zipPath);
    return {path:zipPath,size:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}

export function isNewerRelease(current, remote) {
  const pattern=/^\d+\.\d+\.\d+$/;
  if (!pattern.test(current) || !pattern.test(remote)) return false;
  const a=current.split('.').map(Number),b=remote.split('.').map(Number);
  for(let i=0;i<3;i++){if(b[i]!==a[i])return b[i]>a[i];}
  return false;
}

export function makeSignedManifest(entries,version,privateKey) {
  if(typeof version!=='string' || !/^\d+\.\d+\.\d+$/.test(version))throw new Error('Versão de atualização inválida.');
  const manifest=Buffer.from(JSON.stringify({format:1,version,files:catalog(entries)}),'utf8');
  return {manifest,signature:crypto.sign(null,manifest,privateKey)};
}

export function verifySignedManifest(entries,manifest,signature,publicKey,expectedVersion) {
  if(!Buffer.isBuffer(manifest) || manifest.length>2*1024*1024 || !Buffer.isBuffer(signature) || signature.length!==64 || !crypto.verify(null,manifest,publicKey,signature))throw new Error('Assinatura digital da atualização inválida.');
  let doc;try{doc=JSON.parse(manifest.toString('utf8'));}catch{throw new Error('Manifesto de atualização inválido.');}
  if(doc?.format!==1 || doc.version!==expectedVersion)throw new Error('Versão do pacote assinado não corresponde à versão anunciada.');
  if(!Array.isArray(doc.files))throw new Error('Lista de arquivos do pacote inválida.');
  const actual=catalog(entries);
  if(doc.files.length!==actual.length)throw new Error('Pacote de atualização incompleto ou com arquivos extras.');
  for(let i=0;i<actual.length;i++){
    const a=actual[i],b=doc.files[i];
    if(!b || b.path!==a.path || b.size!==a.size || b.sha256!==a.sha256)throw new Error('Integridade do conteúdo do pacote não confere.');
  }
  return true;
}

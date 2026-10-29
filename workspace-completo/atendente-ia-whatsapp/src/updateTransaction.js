import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Os dados do cliente e as sessões nunca fazem parte das operações da atualização.
const PROTECTED = new Set(['data', 'node_modules', '.runtime', '.git', '.env']);
const DIR = 'ienvia-update-transaction';
const LOCK = 'ienvia-update.lock';
function isProtected(rel) {
  const first = String(rel).split('/')[0].toLowerCase();
  return PROTECTED.has(first) || first.startsWith('.env');
}

function checkPath(root, rel) {
  if (!rel || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw new Error('Caminho inválido na atualização.');
  const full = path.join(root, ...rel.split('/'));
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Caminho fora da instalação.');
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Link simbólico não permitido na atualização.'); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return full;
}
function atomicWrite(file, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.ienvia-update-${crypto.randomBytes(12).toString('hex')}.tmp`);
  try {
    const fd=fs.openSync(tmp, 'wx', mode);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
function runtime(root) {
  const dir=checkPath(root,'.runtime');fs.mkdirSync(dir,{recursive:true,mode:0o700});return dir;
}
function locked(root, fn) {
  const dir=runtime(root), lock=path.join(dir, LOCK);let fd;
  try { fd=fs.openSync(lock,'wx',0o600); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let pid;try { pid=JSON.parse(fs.readFileSync(lock,'utf8')).pid; } catch { throw new Error('Não foi possível verificar o bloqueio da atualização.'); }
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Bloqueio de atualização inválido.');
    let active=true;try { process.kill(pid,0); } catch(e) { if (e.code==='ESRCH') active=false; }
    if (active) throw new Error('Outra atualização está em andamento.');
    fs.unlinkSync(lock);fd=fs.openSync(lock,'wx',0o600);
  }
  try { fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;return fn(dir); }
  finally { if(fd!==undefined)fs.closeSync(fd);try {fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;} }
}
function rollback(root, dir) {
  const stage=path.join(dir,DIR), manifest=path.join(stage,'manifest.json');
  if (!fs.existsSync(stage)) return false;
  if (fs.lstatSync(stage).isSymbolicLink()) throw new Error('Link simbólico não permitido na área de recuperação.');
  if (!fs.existsSync(manifest)) {fs.rmSync(stage,{recursive:true,force:true});return false;}
  const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if (m.version!==1 || !Array.isArray(m.operations)) throw new Error('Registro de recuperação inválido.');
  if (m.committed) {fs.rmSync(stage,{recursive:true,force:true});return false;}
  for (let i=m.operations.length-1;i>=0;i--) {
    const op=m.operations[i];
    if (!op || !['system','outer'].includes(op.scope) || typeof op.rel!=='string') throw new Error('Operação inválida no registro de recuperação.');
    if(isProtected(op.rel))throw new Error('Recuperação bloqueada para dados protegidos.');
    const scope=op.scope==='outer'?path.dirname(root):root;
    const dest=checkPath(scope,op.rel);
    if(op.existed) {
      const b=path.join(stage,`backup-${i}`);if(!fs.lstatSync(b).isFile() || fs.lstatSync(b).isSymbolicLink())throw new Error('Backup de atualização inválido.');
      atomicWrite(dest,fs.readFileSync(b),op.mode);
      if(process.platform!=='win32')fs.chmodSync(dest,op.mode);
    } else {try { fs.unlinkSync(dest); }catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  fs.rmSync(stage,{recursive:true,force:true});return true;
}
export function recoverInterruptedUpdate(rootDir) {
  const root=fs.realpathSync(rootDir);return locked(root,dir=>rollback(root,dir));
}
export function applyUpdateTransaction({rootDir,entries,onApplied}) {
  const root=fs.realpathSync(rootDir), outer=path.dirname(root), hasOuter=path.basename(root).toLowerCase()==='sistema';
  return locked(root,dir=>{
    rollback(root,dir);
    const stage=path.join(dir,DIR);fs.mkdirSync(stage,{mode:0o700});
    const ops=[],seen=new Set();
    try {
      for(const entry of entries){
        let scope,rel;
        if(entry.zipPath.startsWith('ZAP-IA-Studio/sistema/')){scope='system';rel=entry.zipPath.slice('ZAP-IA-Studio/sistema/'.length);if(isProtected(rel))continue;}
        else if(hasOuter && entry.zipPath.startsWith('ZAP-IA-Studio/')){scope='outer';rel=entry.zipPath.slice('ZAP-IA-Studio/'.length);if(!rel || rel.toLowerCase().startsWith('sistema/') || isProtected(rel))continue;}
        else continue;
        const dest=checkPath(scope==='system'?root:outer,rel);if(seen.has(dest))throw new Error('Arquivo duplicado na atualização.');seen.add(dest);
        let st=null;try{st=fs.lstatSync(dest);}catch(e){if(e.code!=='ENOENT')throw e;}
        if(st && (!st.isFile() || st.isSymbolicLink()))throw new Error('Destino de atualização inválido ou link simbólico.');
        const op={scope,rel,existed:Boolean(st),mode:st ? st.mode & 0o777 : 0o644};
        if(st)atomicWrite(path.join(stage,`backup-${ops.length}`),fs.readFileSync(dest),0o600);
        ops.push(op);
      }
      const manifest=path.join(stage,'manifest.json');atomicWrite(manifest,JSON.stringify({version:1,operations:ops,committed:false}),0o600);
      let i=0;
      for(const entry of entries){
        let scope,rel;if(entry.zipPath.startsWith('ZAP-IA-Studio/sistema/')){scope='system';rel=entry.zipPath.slice('ZAP-IA-Studio/sistema/'.length);if(isProtected(rel))continue;}
        else if(hasOuter && entry.zipPath.startsWith('ZAP-IA-Studio/')){scope='outer';rel=entry.zipPath.slice('ZAP-IA-Studio/'.length);if(!rel || rel.toLowerCase().startsWith('sistema/') || isProtected(rel))continue;}else continue;
        const dest=checkPath(scope==='system'?root:outer,rel);const mode=process.platform!=='win32' && dest.endsWith('.sh') ? 0o755 : ops[i].mode;
        atomicWrite(dest,entry.content,mode);if(process.platform!=='win32')fs.chmodSync(dest,mode);i++;onApplied?.(i);
      }
      atomicWrite(manifest,JSON.stringify({version:1,operations:ops,committed:true}),0o600);fs.rmSync(stage,{recursive:true,force:true});return ops.length;
    } catch(error){
      try {rollback(root,dir);}catch(recovery){throw new Error(`Falha ao atualizar e ao recuperar: ${recovery.message}`,{cause:error});}
      throw error;
    }
  });
}

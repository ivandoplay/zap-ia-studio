// Diário local opcional de lotes brutos. Não é a visualização do histórico:
// qualquer leitor futuro deve respeitar o dono da conta e todas as exclusões.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
export function writeHistoryJournal({root,userId,slotId,payload}) {
  if (!path.isAbsolute(root) || typeof userId !== 'string' || !userId || !/^slot_[123]$/.test(slotId)) throw new Error('Conta ou chip inválido.');
  const folder=path.join(root,hash(userId),slotId);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const bytes=JSON.stringify({formatVersion:1,receivedAt:new Date().toISOString(),slotId,payload},(_k,v)=>typeof v==='bigint'?v.toString():v);
  const basename=`${Date.now()}-${crypto.randomBytes(12).toString('hex')}.json`;
  const dest=path.join(folder,basename),temp=dest+'.tmp';let fd;
  try {
    fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.renameSync(temp,dest);
  }catch(e){if(fd!==undefined && fd!==null)try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(temp)}catch{};throw e;}
  return {file:dest,bytes:Buffer.byteLength(bytes)};
}

export function journalUserFolder(root, userId) {
  if (!path.isAbsolute(root) || typeof userId !== 'string' || !userId) throw new Error('Conta inválida.');
  return path.join(root, hash(userId));
}
export function isHistoryJournalEnabled(root, userId) {
  return fs.existsSync(path.join(journalUserFolder(root,userId), 'enabled.flag'));
}
export function enableHistoryJournal(root, userId) {
  const folder=journalUserFolder(root,userId);
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const flag=path.join(folder,'enabled.flag');
  try { fs.writeFileSync(flag,'1\n',{mode:0o600,flag:'wx'}); }
  catch (err) { if (err?.code !== 'EEXIST') throw err; }
}
export function countJournalFiles(root,userId,slotId) {
  if (!/^slot_[123]$/.test(slotId)) throw new Error('Chip inválido.');
  const folder=path.join(journalUserFolder(root,userId),slotId);
  try { return fs.readdirSync(folder,{withFileTypes:true}).filter(x=>x.isFile() && x.name.endsWith('.json')).length; }
  catch(e) { if(e.code==='ENOENT') return 0; throw e; }
}

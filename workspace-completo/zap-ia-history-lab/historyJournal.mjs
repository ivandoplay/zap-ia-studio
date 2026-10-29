// Experimento não integrado ao motor: preserva pacotes brutos antes de qualquer
// corte do cache. O leitor futuro terá que respeitar exclusões e o dono da conta.
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

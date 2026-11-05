import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {dispatchError,requireUuid} from './contracts.js';
const noFollow=fs.constants.O_NOFOLLOW||0;
function syncDirectory(dir){if(process.platform==='win32')return;const fd=fs.openSync(dir,fs.constants.O_RDONLY|noFollow);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const failure=(code,message)=>dispatchError(code,message,503);
// Spool exclusivo de ENTRADA. Nunca contém ação de enviar, sessão/auth ou retry de saída.
export function createIngressJournal({root,ownerId,instanceId,maxPendingBytes=64*1024*1024}={}){
 ownerId=requireUuid(ownerId);instanceId=requireUuid(instanceId);
 if(typeof root!=='string'||!path.isAbsolute(root)||!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<1024)throw new TypeError('Raiz privada absoluta e orçamento de disco obrigatórios.');
 root=path.resolve(root);
 function ancestors(dir){let current=path.parse(dir).root;for(const part of dir.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw failure('INGRESS_JOURNAL_UNSAFE','Journal não aceita diretórios simbólicos.');}}
 function privateDir(dir){ancestors(dir);if(!fs.existsSync(dir)){fs.mkdirSync(dir,{mode:0o700});syncDirectory(path.dirname(dir));}const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||typeof process.getuid==='function'&&s.uid!==process.getuid()||process.platform!=='win32'&&(s.mode&0o077)!==0)throw failure('INGRESS_JOURNAL_UNSAFE','Journal exige diretório privado.');}
 privateDir(root);privateDir(path.join(root,ownerId));const dir=path.join(root,ownerId,instanceId);privateDir(dir);const original=fs.statSync(dir),lock=path.join(dir,'.lock');let lockFd,closed=false;
 try{lockFd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|noFollow,0o600);fs.writeFileSync(lockFd,randomUUID());fs.fsyncSync(lockFd);}catch(error){if(lockFd!==undefined)fs.closeSync(lockFd);throw failure(error.code==='EEXIST'?'INGRESS_JOURNAL_LOCKED':'INGRESS_JOURNAL_UNAVAILABLE','Journal indisponível ou já adquirido; não removemos lock automaticamente.');}
 const lockStat=fs.fstatSync(lockFd);
 function ensure(){if(closed)throw failure('INGRESS_JOURNAL_CLOSED','Journal encerrado.');privateDir(dir);const s=fs.statSync(dir);if(s.ino!==original.ino||s.dev!==original.dev)throw failure('INGRESS_JOURNAL_UNSAFE','Diretório do journal mudou.');}
 function syncDir(){syncDirectory(dir);}
 function list(){ensure();return fs.readdirSync(dir).filter(name=>/^[0-9a-f-]{36}\.json$/.test(name));}
 function readFile(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|noFollow);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>1048576)throw Error('Arquivo inválido');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}
 function validate(e){if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!['eventId','leaseId','executorId','observedAt','event'].includes(k))||typeof e.observedAt!=='string'||!Number.isFinite(Date.parse(e.observedAt))||!e.event||typeof e.event!=='object')throw Error('Envelope inválido');for(const key of ['eventId','leaseId','executorId'])if(requireUuid(e[key])!==e[key])throw Error('UUID não canônico');}
 function stats(){const names=list();let bytes=0,orphanFiles=0;for(const name of fs.readdirSync(dir)){if(!names.includes(name)&&!name.startsWith('.tmp-'))continue;const s=fs.lstatSync(path.join(dir,name));if(!s.isFile()||s.isSymbolicLink())throw failure('INGRESS_JOURNAL_UNSAFE','Arquivo inseguro no journal.');bytes+=s.size;if(name.startsWith('.tmp-'))orphanFiles++;}return {pending:names.length,pendingBytes:bytes,orphanFiles};}
 return Object.freeze({identity:Object.freeze({ownerId,instanceId}),
  append(e){ensure();let data;try{validate(e);data=JSON.stringify(e);}catch{throw failure('INGRESS_JOURNAL_INVALID','Envelope de entrada inválido.');}if(Buffer.byteLength(data)>1048576)throw failure('INGRESS_JOURNAL_FULL','Entrada excede o limite do journal.');const file=path.join(dir,e.eventId+'.json');if(fs.existsSync(file)){if(readFile(file)!==data)throw failure('INGRESS_JOURNAL_CONFLICT','Identificador de entrada reutilizado.');return;}
   if(stats().pendingBytes+Buffer.byteLength(data)>maxPendingBytes)throw failure('INGRESS_JOURNAL_FULL','Journal atingiu o orçamento; pendências foram preservadas.');const temp=path.join(dir,'.tmp-'+randomUUID());let fd;
   try{fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|noFollow,0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(temp,file);fs.unlinkSync(temp);syncDir();}catch{throw failure('INGRESS_JOURNAL_UNAVAILABLE','Persistência local não confirmada; nenhum arquivo pendente foi removido.');}finally{if(fd!==undefined)fs.closeSync(fd);}
  },
  read(limit=25){if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Lote de journal entre 1 e 100.');try{return list().map(name=>({name,mtime:fs.lstatSync(path.join(dir,name)).mtimeMs})).sort((a,b)=>a.mtime-b.mtime||a.name.localeCompare(b.name)).slice(0,limit).map(({name})=>{const e=JSON.parse(readFile(path.join(dir,name)));validate(e);if(name!==e.eventId+'.json')throw Error('Identidade divergente');return e;}).sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.eventId.localeCompare(b.eventId)).slice(0,limit);}catch{throw failure('INGRESS_JOURNAL_CORRUPT','Journal precisa de revisão; registros não foram apagados nem pulados.');}},
  ack(id){ensure();id=requireUuid(id);const file=path.join(dir,id+'.json');if(!fs.existsSync(file))return;const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw failure('INGRESS_JOURNAL_UNSAFE','Arquivo inseguro no journal.');fs.unlinkSync(file);syncDir();},
  stats,
  close(){if(closed)return;ensure();const s=fs.lstatSync(lock);if(s.ino!==lockStat.ino||s.dev!==lockStat.dev||s.isSymbolicLink())throw failure('INGRESS_JOURNAL_UNSAFE','Lock mudou; encerramento recusado.');fs.unlinkSync(lock);fs.closeSync(lockFd);closed=true;syncDir();}
 });
}

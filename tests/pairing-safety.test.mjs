import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { backupSlotAuth } from '../src/pairingSafety.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zapia-pair-safety-'));
try {
 const auth=path.join(root,'wa_auth'), recovery=path.join(root,'recovery');
 const a=path.join(auth,'user-a','slot_2'), b=path.join(auth,'user-a','slot_3');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});
 fs.writeFileSync(path.join(a,'creds.json'),'{"registered":true,"fake":"apenas-teste"}');
 fs.writeFileSync(path.join(a,'store_lid-mapping.json'),'{}');fs.writeFileSync(path.join(a,'cache.tmp'),'temporario');
 fs.writeFileSync(path.join(b,'creds.json'),'{"registered":true,"fake":"outro-chip"}');
 const info=backupSlotAuth({authRoot:auth,recoveryRoot:recovery,userId:'user-a',slotId:'slot_2',authDir:a});
 assert.equal(info.copiedFiles,2);const u=fs.readdirSync(recovery)[0],bak=path.join(recovery,u,fs.readdirSync(path.join(recovery,u))[0]);
 assert.equal(fs.readFileSync(path.join(bak,'creds.json'),'utf8'),fs.readFileSync(path.join(a,'creds.json'),'utf8'));
 assert.equal(fs.existsSync(path.join(bak,'cache.tmp')),false);assert.equal(fs.existsSync(path.join(bak,'slot_3')),false);
 assert.equal(fs.existsSync(path.join(b,'creds.json')),true,'Outro chip deve permanecer intacto.');
 assert.throws(()=>backupSlotAuth({authRoot:auth,recoveryRoot:recovery,userId:'user-a',slotId:'slot_2',authDir:b}),/não corresponde/);
 assert.throws(()=>backupSlotAuth({authRoot:auth,recoveryRoot:recovery,userId:'../outro',slotId:'slot_2',authDir:a}),/inválido/);
 if(process.platform!=='win32'){fs.symlinkSync(path.join(b,'creds.json'),path.join(a,'link'));assert.throws(()=>backupSlotAuth({authRoot:auth,recoveryRoot:recovery,userId:'user-a',slotId:'slot_2',authDir:a}),/simbólico/);}
 console.log('OK: backup restrito ao chip correto, sem apagar dados ou seguir links.');
}finally{fs.rmSync(root,{recursive:true,force:true})}

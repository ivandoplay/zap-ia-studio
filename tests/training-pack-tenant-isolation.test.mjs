import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Storage,tenantStorageContext} from '../src/storage.js';import {BUNDLED_PACKS_DIR,getTrainingPack,listTrainingPacks} from '../src/trainingPackEngine.js';
assert.equal(process.env.ZAPIA_ISOLATED_TEST,'1','Usar somente cópia isolada sem dados reais');
const make=(id,role,customPacks={})=>new Storage({inMemory:true,isCloudTenant:true,userId:id,userRole:role,initialData:{customPacks},fallbackClean:true});
const pack=(id,name)=>({id,name,canonicalCore:{approvedMessages:[]},operationalSkills:[],humanizationSkills:[]});
const a=make('conta-a','user',{'pacote-sintetico':pack('pacote-sintetico','somente A')});const b=make('conta-b','user',{'pacote-sintetico':pack('pacote-sintetico','somente B')});const empty=make('conta-c','user');const master=make('conta-master','master');
const mockPath=path.join(BUNDLED_PACKS_DIR,'pacote-master-sintetico.json');fs.mkdirSync(BUNDLED_PACKS_DIR,{recursive:true});assert(!fs.existsSync(mockPath));fs.writeFileSync(mockPath,JSON.stringify(pack('pacote-master-sintetico','privado master')));
try{
 await tenantStorageContext.run(master,async()=>assert.equal(getTrainingPack('pacote-master-sintetico').name,'privado master'));
 const run=(store,name)=>tenantStorageContext.run(store,async()=>{await new Promise(r=>setImmediate(r));assert.equal(getTrainingPack('pacote-sintetico')?.name,name);assert.equal(getTrainingPack('pacote-master-sintetico'),null,'cliente não deve acessar pacote privado da master nem cache');assert.deepEqual(listTrainingPacks().map(x=>x.name),name?[name]:[])});
 await Promise.all([run(a,'somente A'),run(b,'somente B'),run(empty,undefined)]);
 console.log('OK: pacotes de contas sintéticas isolados mesmo com IDs iguais e cache master previamente carregado.');
}finally{fs.rmSync(mockPath,{force:true})}

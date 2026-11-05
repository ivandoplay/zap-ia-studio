import {createInstanceRuntime} from './runtime.js';
import {dispatchError,requireUuid,parseExecutionSnapshot} from './contracts.js';
import {createLocalSessionDriver} from './localSessionDriver.js';
import {createEvolutionInstanceDriver,parseEvolutionBinding} from './evolutionDriver.js';
// Composição opt-in. Não é carregada pelo bootstrap legado e não descobre sessões por telefone/slot.
export function createInstanceExecutor({ownerId,executorId,repository,getWorkerIdentity,timeoutMs=8000,now=Date.now}={}){
 ownerId=requireUuid(ownerId);executorId=requireUuid(executorId);
 if(typeof getWorkerIdentity!=='function')throw new TypeError('Identidade autenticada atual do worker obrigatória.');
 const runtime=createInstanceRuntime({ownerId,executorId,repository,timeoutMs,now}),resolve=repository.resolve.bind(repository),resolveEvolution=repository.resolveEvolutionBinding?.bind(repository);
 async function bounded(operation){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(dispatchError('DISPATCH_REPOSITORY_TIMEOUT','Catálogo não confirmado no prazo.',503)),timeoutMs);})]);}finally{clearTimeout(timer);}}
 function owned(){const actor=getWorkerIdentity();if(actor?.ownerId!==ownerId||actor?.executorId!==executorId)throw dispatchError('INSTANCE_SCOPE_MISMATCH','A conta ativa do worker mudou.',403);}
 owned();
 async function ready(instanceId,transport){
  owned();instanceId=requireUuid(instanceId);const raw=await bounded(()=>resolve({ownerId,instanceId}));
  owned();const snapshot=parseExecutionSnapshot(raw,{ownerId,instanceId}),a=snapshot.assignment;
  if(!a||!a.enabled||!a.executorEnabled)throw dispatchError('INSTANCE_NOT_ASSIGNED','Instância sem executor habilitado.',503);
  if(a.executorId!==executorId||snapshot.instance.transport!==transport)throw dispatchError('INSTANCE_SCOPE_MISMATCH','Executor ou transporte incompatível.',403);
  return {instanceId,snapshot};
 }
 return Object.freeze({
  async registerLocalSession(id,session){const {instanceId}=await ready(id,'local_worker');runtime.attach(createLocalSessionDriver({ownerId,executorId,instanceId,session,getWorkerIdentity,now}));return {ownerId,executorId,instanceId,registered:true,connectedNotAsserted:true};},
  async registerEvolutionInstance(id,profile){
   if(!resolveEvolution)throw dispatchError('INSTANCE_EXECUTION_SETUP_REQUIRED','Repositório do vínculo Evolution obrigatório.',503);
   const {instanceId,snapshot}=await ready(id,'evolution_api');
   const getBinding=async()=>{owned();const b=await bounded(()=>resolveEvolution({ownerId,instanceId,executorId}));owned();return b;};
   const binding=parseEvolutionBinding(await getBinding(),{ownerId,instanceId,executorId});if(binding.assignmentRevision!==snapshot.assignment.revision)throw dispatchError('DISPATCH_CONFLICT','Vínculo mudou durante registro.');
   runtime.attach(createEvolutionInstanceDriver({ownerId,instanceId,executorId,binding,profile,getBinding,getWorkerIdentity,now}));return {ownerId,executorId,instanceId,registered:true,connectedNotAsserted:true};
  },
  unregister(id){owned();return runtime.detach(id);},
  list(){owned();return runtime.list();},
  async send(input){owned();const result=await runtime.send(input);owned();return result;}
 });
}

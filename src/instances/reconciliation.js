import {dispatchError,requireUuid} from './contracts.js';
const states=['reserved','started','uncertain','accepted','not_started'];
const fail=()=>{throw dispatchError('DISPATCH_DIAGNOSIS_UNVERIFIED','Não foi possível validar o diagnóstico. Nenhum envio ou desbloqueio foi solicitado.',503);};
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function same(value,scope){if(!value||['ownerId','instanceId','requestId'].some(k=>value[k]!==scope[k]))fail();}
export function parseDispatchReview(value,scope){
 same(value,scope);const r=value,valid={expired_unstarted:r.beforeState==='reserved'&&r.afterState==='not_started',retained_unknown:['started','uncertain'].includes(r.beforeState)&&r.afterState===r.beforeState,retained_reservation:r.beforeState==='reserved'&&r.afterState==='reserved',observed_accepted:r.beforeState==='accepted'&&r.afterState==='accepted',observed_not_started:r.beforeState==='not_started'&&r.afterState==='not_started'};
 if(!Object.hasOwn(valid,r.action)||!valid[r.action]||r.actorId!==scope.ownerId||!date(r.createdAt)||typeof r.duplicate!=='boolean'||r.queued!==false||r.canRetryAutomatically!==false)fail();
 let reviewId;try{reviewId=requireUuid(r.reviewId);}catch{fail();}
 return {ownerId:scope.ownerId,instanceId:scope.instanceId,requestId:scope.requestId,reviewId,actorId:r.actorId,beforeState:r.beforeState,afterState:r.afterState,action:r.action,createdAt:r.createdAt,duplicate:r.duplicate,queued:false,canRetryAutomatically:false};
}
export function parseDispatchDiagnosis(value,scope){
 same(value,scope);const d=value;
 if(!states.includes(d.state)||!date(d.createdAt)||!date(d.updatedAt)||!date(d.reservedUntil)||d.startedAt!==null&&!date(d.startedAt)||['started','accepted'].includes(d.state)&&d.startedAt===null||['reserved','not_started'].includes(d.state)&&d.startedAt!==null||!Number.isSafeInteger(d.reviewCount)||d.reviewCount<0||d.delivered!==false||d.queued!==false||d.canRetryAutomatically!==false)fail();
 const classifications={reserved:['reserved_waiting_start','expired_before_start'],started:['outcome_unknown'],uncertain:['outcome_unknown'],accepted:['accepted_by_provider'],not_started:['not_started']};
 if(!classifications[d.state].includes(d.classification)||d.blocking!==['reserved','started','uncertain'].includes(d.state)||d.canExpireUnstarted!==(d.classification==='expired_before_start'))fail();
 let executorId;try{executorId=requireUuid(d.executorId);}catch{fail();}
 const lastReview=d.lastReview===null?null:parseDispatchReview(d.lastReview,scope);if((d.reviewCount===0)!==(lastReview===null))fail();
 return {ownerId:scope.ownerId,instanceId:scope.instanceId,requestId:scope.requestId,executorId,state:d.state,classification:d.classification,blocking:d.blocking,canExpireUnstarted:d.canExpireUnstarted,createdAt:d.createdAt,updatedAt:d.updatedAt,startedAt:d.startedAt,reservedUntil:d.reservedUntil,reviewCount:d.reviewCount,lastReview,delivered:false,queued:false,canRetryAutomatically:false};
}
export function parseReviewInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['expectedState','reviewId'].includes(k))||!states.includes(value.expectedState))throw dispatchError('INVALID_DISPATCH_REVIEW','Revisão exige estado esperado e identificador próprio; não aceita comando de envio.',400);
 return {expectedState:value.expectedState,reviewId:requireUuid(value.reviewId)};
}

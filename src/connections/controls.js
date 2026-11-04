import {freshTimestamp} from '../dashboard/connections.js';
const paths=new Set(['/wa/connect','/wa/disconnect','/wa/slot-config','/evolution-cloud/connect','/evolution-cloud/refresh-qr','/evolution-cloud/reconnect','/evolution-cloud/disconnect','/evolution-cloud/delete']);
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function validateConnectionControl(path,body,{maxSlots=1,support=false}={}){
 path=path.replace(/\/$/,'');if(!paths.has(path))return false;
 maxSlots=Number.isInteger(maxSlots)&&maxSlots>=1&&maxSlots<=3?maxSlots:1;
 if(support)fail('Operações de conexão não são permitidas em suporte. Volte à sua própria conta.',403);
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.slotId!=='string'||!/^slot_[1-3]$/.test(body.slotId))fail('Informe um chip válido explicitamente. Nenhum Chip 1 será escolhido como alternativa.');
 if(Number(body.slotId.slice(-1))>maxSlots)fail('Chip fora do limite da conta.',403);
 if(path.replace(/\/$/,'')==='/wa/disconnect'&&typeof body.clearSession!=='boolean')fail('clearSession deve ser true ou false: apagar sessão e parar conexão são ações diferentes.');
 if(body.aiEnabled!==undefined&&typeof body.aiEnabled!=='boolean')fail('aiEnabled deve ser booleano (true ou false).');
 if(body.label!==undefined&&(typeof body.label!=='string'||body.label.trim().length<1||body.label.trim().length>42||/[\u0000-\u001f]/.test(body.label)))fail('O nome do chip deve ter entre 1 e 42 caracteres.');
 if(path==='/wa/slot-config'&&body.label===undefined&&body.aiEnabled===undefined)fail('Informe o nome ou o estado da IA do chip.');
 if(body.pairingPhone!==undefined&&body.pairingPhone!==null&&(typeof body.pairingPhone!=='string'||!/^\+?[\d ()-]{10,25}$/.test(body.pairingPhone)||!/^\d{10,15}$/.test(body.pairingPhone.replace(/\D/g,''))))fail('Informe telefone completo com código do país e DDD.');
 if(body.targetDeviceId!==undefined&&body.targetDeviceId!==null&&(typeof body.targetDeviceId!=='string'||!/^[-a-zA-Z0-9_:]{1,128}$/.test(body.targetDeviceId)))fail('Identificador de motor inválido.');
 return true;
}
export function privatePairing(value={},now=Date.now()){
 const active=['connecting','qr_ready'].includes(value.status)&&freshTimestamp(value.generatedAt,now,45000);
 const code=typeof value.pairingCode==='string'?value.pairingCode.replaceAll('-','').toUpperCase():'';
 return {status:['connected','disconnected','connecting','qr_ready'].includes(value.status)?value.status:'unknown',qrDataUrl:active&&typeof value.qrDataUrl==='string'&&value.qrDataUrl.length<=300000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.qrDataUrl)?value.qrDataUrl:null,pairingCode:active&&/^[A-Z0-9]{8}$/.test(code)?code:null,expiresAt:active?new Date(Date.parse(value.generatedAt)+45000).toISOString():null};
}

import {icon} from './icons.js';
const statusLabel={connected:'Conectado',disconnected:'Desconectado',connecting:'Conectando',qr_ready:'Aguardando pareamento',unknown:'Não confirmado',conflict:'Conflito de transportes'};
const transportLabel={local:'Motor local',evolution_api:'Evolution API',none:'Sem transporte confirmado',unknown:'Não confirmado',conflict:'Mais de um transporte'};
const by=id=>document.getElementById(id);
const tag=(element,label,tone='neutral')=>{element.textContent=label;element.className=`tag tag-${tone}`;};
export function assertConnections(data){
 if(data?.ok!==true||data.schemaVersion!==1||!['vercel_cloud','local_worker'].includes(data.mode)||!data.viewer||!data.tenant||!data.permissions||!data.connections||!Array.isArray(data.connections.slots)||data.connections.slots.length<1||data.connections.slots.length>3||data.connections.slots.some(s=>!/^slot_[1-3]$/.test(s.slotId)||!Object.hasOwn(statusLabel,s.status))||new Set(data.connections.slots.map(s=>s.slotId)).size!==data.connections.slots.length||data.connections.total!==data.connections.slots.length||!Array.isArray(data.devices)||data.devices.length>20||data.devices.some(d=>!d||!Array.isArray(d.activeSlots))||!['updated','unavailable'].includes(data.deviceReadStatus)||!Array.isArray(data.warnings)||data.capabilities?.readOnly!==true||!Number.isFinite(Date.parse(data.generatedAt||'')))throw new Error('Resposta de diagnóstico inválida. Nenhuma sessão foi alterada.');
 return data;
}
export function mountConnections(){
 const main=document.createElement('main');main.className='page connections-page';
 main.innerHTML=`<div class="support-banner" id="connections-support" hidden><span>${icon('shield')}</span><div><strong>Suporte: somente diagnóstico</strong><span id="connections-support-label"></span></div><button class="button button-secondary" id="connections-exit" type="button">Voltar à minha conta</button></div>
 <header class="page-header"><div><div class="eyebrow">CADA SINAL NO SEU LUGAR</div><h1>Conexões e motor</h1><p id="connections-account"></p></div><div class="header-actions"><button class="button button-secondary" type="button" id="connections-refresh">${icon('refresh')}Atualizar sinais</button><a class="button button-primary" href="/painel#dashboard">Abrir controles atuais</a></div></header>
 <div class="connection-meta"><span id="connections-sync">Consultando…</span><span id="connections-time"></span><span class="connection-readonly">Diagnóstico · sem alterar sessões</span></div>
 <div class="data-warning" id="connections-error" role="status" hidden></div>
 <section aria-labelledby="chips-heading"><div class="connection-section-heading"><div><h2 id="chips-heading">Seus chips</h2><p>Sessão do WhatsApp, transporte e motor são verificados separadamente.</p></div><span id="chip-quota" class="tag tag-neutral"></span></div><div id="connection-chips" class="connection-chips"></div></section>
 <div class="connection-bottom-grid"><section class="panel transport-panel" aria-labelledby="transport-heading"><div class="connection-section-heading"><span class="connection-block-icon">${icon('cloud')}</span><div><h2 id="transport-heading">Evolution</h2><p>Conexão com o provedor na nuvem</p></div></div><div class="connection-signal"><strong>Leitura do provedor</strong><span id="provider-state" class="tag tag-neutral"></span></div><p id="provider-description"></p><div class="connection-inline-note">${icon('info')}<p>Evolution conectada não comprova que existe um executor de campanha disponível. Essa prontidão será tratada em Campanhas.</p></div></section>
 <section class="panel workers-panel" aria-labelledby="workers-heading"><div class="connection-section-heading"><span class="connection-block-icon">${icon('server')}</span><div><h2 id="workers-heading">Motores locais</h2><p>PC ou Termux vinculados à conta</p></div><span id="worker-state" class="tag tag-neutral"></span></div><div id="connection-workers"></div><p class="connection-footnote">No modo nuvem, mostramos até 20 dispositivos mais recentes desta conta. Heartbeat antigo não é confirmação de motor online.</p></section></div>
 <section class="connection-safety" aria-labelledby="connection-safety-title"><span>${icon('shield')}</span><div><h2 id="connection-safety-title">Sem atalhos para a restrição</h2><p>Uma conta desconectada não é automaticamente uma conta banida. Restrição não é inferida de um erro 401 e reconectar não garante sua resolução. Esta página não gera QR, não pareia e não reconecta chips.</p><p>Para operações manuais, os controles atuais continuam disponíveis. Confira a conta, o chip e o transporte antes de agir. Em suporte, esta nova página permanece somente leitura.</p></div></section>`;
 document.body.replaceChildren(main);return main;
}
export function renderConnections(data,exitSupport){
 const support=!!data.viewer.id&&data.viewer.id!==data.tenant.id;
 by('connections-support').hidden=!support;by('connections-support-label').textContent=`${data.viewer.displayName||'Operador'} acessando ${data.tenant.displayName||'conta de suporte'}.`;
 by('connections-exit').onclick=exitSupport;
 by('connections-account').textContent=`${data.tenant.displayName||'Painel local'} · ${data.mode==='local_worker'?'motor que atende este painel':'diagnóstico da conta na nuvem'}`;
 by('connections-time').textContent=`Consultado às ${new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(data.generatedAt))} · Fortaleza`;
 by('chip-quota').textContent=`${data.connections.total} ${data.connections.total===1?'chip permitido':'chips permitidos'}`;
 by('connection-chips').replaceChildren();
 for(const slot of data.connections.slots){
  const card=document.createElement('article');card.className='panel connection-chip';
  card.innerHTML=`<div class="connection-chip-heading"><span class="chip-symbol">${icon('phone')}</span><h3></h3><span class="tag"></span></div><dl><div><dt>Transporte</dt><dd></dd></div><div><dt>Motor local</dt><dd></dd></div><div><dt>Restrição da conta</dt><dd>Não verificada</dd></div><div><dt>Entrega de mensagens</dt><dd>Não verificada neste diagnóstico</dd></div></dl><p class="chip-explanation"></p>`;
  card.querySelector('h3').textContent=`Chip ${slot.slotId.slice(-1)}`;
  tag(card.querySelector('.tag'),statusLabel[slot.status],slot.status==='connected'?'green':['unknown','conflict'].includes(slot.status)?'amber':'neutral');
  const dd=card.querySelectorAll('dd');dd[0].textContent=transportLabel[slot.transport]||'Não confirmado';dd[1].textContent=data.deviceReadStatus==='unavailable'?'Não foi possível verificar':slot.workerOnline?'Heartbeat recente':'Sem heartbeat recente';
  card.querySelector('.chip-explanation').textContent=slot.status==='conflict'?'Dois transportes reportam conexão. Nenhum foi escolhido automaticamente.':slot.status==='unknown'?'Não usamos um snapshot antigo como conexão confirmada.':'Estes sinais não são autorização nem garantia de envio.';
  by('connection-chips').append(card);
 }
 const local=data.mode==='local_worker',providerError=data.warnings.includes('provider_unavailable');
 tag(by('provider-state'),local?'Não consultado':providerError?'Indisponível':data.connections.slots.every(s=>s.readStatus==='not_configured')?'Sem instância identificada':'Leitura concluída',providerError?'amber':'neutral');
 by('provider-description').textContent=local?'Você está consultando o motor local. Não fazemos uma consulta paralela à Evolution neste modo.':providerError?'A consulta ao provedor falhou. Isso não confirma desconexão, banimento ou entrega.':'O resultado por chip aparece acima. Esta consulta não cria instâncias e não muda sessões.';
 const unavailable=data.deviceReadStatus==='unavailable';
 tag(by('worker-state'),unavailable?'Não verificado':data.connections.workerOnline?'Sinal recente':'Sem sinal recente',unavailable?'amber':data.connections.workerOnline?'green':'neutral');
 by('connection-workers').replaceChildren();
 if(local||unavailable||!data.devices.length){const p=document.createElement('p');p.className='worker-empty';p.textContent=local?'O processo que atende este painel respondeu. O estado de cada sessão WhatsApp continua sendo um sinal separado.':unavailable?'Não foi possível consultar os motores. Uma falha de leitura não significa que não existem dispositivos.':'Nenhum dispositivo foi retornado na consulta desta conta. Evolution pode operar sem motor local; isso não confirma um executor de campanha.';by('connection-workers').append(p);}
 else for(const device of data.devices){const row=document.createElement('div');row.className='worker-row';row.innerHTML='<div><strong></strong><span></span><small></small></div><span class="tag"></span>';row.querySelector('strong').textContent=device.label;row.querySelector('div>span').textContent=[device.platform||'Plataforma não informada',device.version?`v${device.version}`:'Versão não informada'].join(' · ');row.querySelector('small').textContent=device.activeSlots.length?`Vinculado a: ${device.activeSlots.map(id=>`Chip ${id.slice(-1)}`).join(', ')}`:'Sem chip vinculado informado';tag(row.querySelector('.tag'),device.online?'Online':'Sem sinal recente',device.online?'green':'neutral');by('connection-workers').append(row);}
 setConnectionsSync('fresh',data.warnings.length?'Parte dos sinais está indisponível. Confira os avisos de cada origem.':'');
}
export function setConnectionsSync(state,message=''){
 if(!by('connections-sync'))return;
 by('connections-sync').textContent=state==='fresh'?'Sinais consultados':state==='loading'?'Atualizando sinais…':state==='paused'?'Atualização em pausa':'Diagnóstico desatualizado';
 by('connections-error').hidden=!message;by('connections-error').textContent=message;
 if(state==='stale'){
  by('connection-chips').querySelectorAll('.connection-chip').forEach(card=>{card.querySelectorAll('dd')[1].textContent='Não atualizado';card.querySelector('.chip-explanation').textContent='Último snapshot conhecido. Não é confirmação atual de conexão.';});
  by('connection-chips').querySelectorAll('.connection-chip-heading .tag').forEach(el=>tag(el,'Não atualizado','amber'));
  tag(by('provider-state'),'Não atualizado','amber');tag(by('worker-state'),'Não atualizado','amber');
  by('connection-workers').querySelectorAll('.tag').forEach(el=>tag(el,'Não atualizado','amber'));
 }
}

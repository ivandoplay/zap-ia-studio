import {icon} from './icons.js';
const number=new Intl.NumberFormat('pt-BR');
const fmt=v=>Number.isSafeInteger(v)&&v>=0?number.format(v):'—';
export function showGate({eyebrow='VISÃO GERAL',title='Preparando seu resumo…',description='Verificando a sessão existente. Nenhuma mensagem será enviada.',busy=false,retry,exitSupport}={}) {
 const main=document.createElement('main');main.className='gate';main.setAttribute('aria-busy',String(busy));
 main.innerHTML='<img src="/v2/assets/ienvia-icon.png" width="48" height="48" alt="Ienvia"><span class="eyebrow">VISÃO GERAL</span><h1></h1><p role="status"></p><div class="gate-actions"></div>';
 main.querySelector('.eyebrow').textContent=eyebrow;main.querySelector('h1').textContent=title;main.querySelector('p').textContent=description;
 const actions=main.querySelector('.gate-actions');
 if(busy){const line=document.createElement('div');line.className='loading-line';line.setAttribute('aria-hidden','true');main.append(line);}
 if(retry){const b=document.createElement('button');b.type='button';b.className='button button-primary';b.textContent='Tentar novamente';b.addEventListener('click',retry);actions.append(b);}
 const link=document.createElement('a');link.href='/painel';link.className='button button-secondary';link.textContent='Abrir painel atual / entrar';actions.append(link);
 if(exitSupport){const b=document.createElement('button');b.type='button';b.className='button button-secondary';b.textContent='Voltar à minha conta';b.addEventListener('click',exitSupport);actions.append(b);}
 document.body.replaceChildren(main);return main;
}
export function mountPage() {
 const main=document.createElement('main');main.className='page';
 main.innerHTML=`<div class="support-banner" id="support-banner" hidden><span data-icon="users"></span><div><strong>Modo suporte</strong><span id="support-label"></span></div><button type="button" class="button button-secondary" id="exit-support">Voltar à minha conta</button></div>
 <header class="page-header"><div><div class="eyebrow">SUA OPERAÇÃO, EM UM OLHAR</div><h1>Visão geral</h1><p id="tenant-description"></p></div><div class="header-actions"><button type="button" class="button button-secondary" id="refresh-summary"><span data-icon="refresh"></span>Atualizar</button><a href="/painel#crm" class="button button-primary"><span data-icon="chat"></span>Abrir conversas</a></div></header>
 <div class="summary-meta"><span class="sync-pill" id="sync-status">Atualizando…</span><span id="updated-at"></span><span class="readonly-note">Somente leitura</span></div>
 <div class="data-warning" id="data-warning" role="status" hidden></div>
 <section class="metrics-strip" aria-label="Resumo da conta"><article class="metric"><div class="metric-label">Conversas<span data-icon="chat"></span></div><strong id="count-conversations">—</strong><p>Registros nesta conta</p></article><article class="metric"><div class="metric-label">Aguardando humano<span data-icon="users"></span></div><strong id="count-pending">—</strong><p>Etapa de atendimento humano</p></article><article class="metric"><div class="metric-label">Chips conectados<span data-icon="connection"></span></div><strong id="count-connected">—</strong><p id="connection-caption">Conexão verificada no provedor</p></article><article class="metric"><div class="metric-label">Campanhas<span data-icon="campaign"></span></div><strong id="count-campaigns">—</strong><p id="campaign-caption">Total de campanhas da conta</p></article></section>
 <div class="overview-grid"><section class="panel activity-chart" aria-labelledby="activity-title"><div class="panel-heading"><div><h2 id="activity-title">Última atividade das conversas</h2><p>Últimos 7 dias · horário de Fortaleza</p></div><span class="tag tag-neutral" id="activity-total"></span></div><div class="chart-legend"><span class="mini-dot green"></span>Conversas por data da última atividade</div><div class="chart" id="activity-plot" role="img"><div class="chart-axis" aria-hidden="true" id="chart-axis"></div><div class="chart-plot"><div class="chart-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div><ol class="chart-bars" id="chart-bars" aria-hidden="true"></ol></div></div><p id="activity-empty" class="activity-empty" hidden></p><div class="chart-footer">Cada conversa aparece só no dia da sua última atividade. Não é volume histórico de mensagens.</div><details class="activity-data"><summary>Ver dados do gráfico</summary><table><caption>Conversas por data da última atividade</caption><thead><tr><th scope="col">Data</th><th scope="col">Conversas</th></tr></thead><tbody id="activity-table"></tbody></table></details></section>
 <section class="panel health-panel" aria-labelledby="connections-title"><div class="panel-heading"><div><h2 id="connections-title">Conexões e motor</h2><p>WhatsApp e executor são sinais diferentes.</p></div></div><div class="health-list"><div class="health-row"><span class="health-icon" data-icon="connection"></span><div><strong>WhatsApp</strong><span id="wa-caption"></span></div><span id="wa-tag" class="tag tag-neutral">Não verificado</span></div><div class="health-row"><span class="health-icon" data-icon="server"></span><div><strong>Motor local</strong><span>Heartbeat recente, quando disponível</span></div><span id="worker-tag" class="tag tag-neutral">Sem sinal</span></div><div class="health-row"><span class="health-icon" data-icon="refresh"></span><div><strong>Consulta do resumo</strong><span id="data-caption"></span></div><span class="tag tag-green" id="data-tag">Atualizado</span></div></div><div class="health-note"><span data-icon="info"></span><span>Estar conectado não comprova envio, entrega ou saúde da IA. Abrir esta página não reconecta nenhum chip.</span></div><a class="button button-secondary health-action" href="/conexoes/">Ver conexões e motor<span data-icon="arrow"></span></a></section></div>
 <section class="panel attention-panel" aria-labelledby="attention-title"><div class="panel-heading"><div><h2 id="attention-title">O que merece sua atenção</h2><p>Sinais do resumo, sem iniciar nenhuma ação.</p></div><span class="section-caption" id="attention-count"></span></div><div class="attention-list" id="attention-list"></div></section>`;
 document.body.replaceChildren(main);return main;
}
export function assertPayload(data) {
 const count=v=>Number.isSafeInteger(v)&&v>=0;
 if(data?.ok!==true||data.schemaVersion!==1||!['vercel_cloud','local_worker'].includes(data.mode)||!data.viewer||!data.tenant||!data.permissions||!data.connections||!Array.isArray(data.connections.slots)||data.connections.slots.length<1||data.connections.slots.length>3||!count(data.counts?.conversations)||!count(data.counts?.pendingHuman)||!(data.counts.campaigns===null||count(data.counts.campaigns))||!Array.isArray(data.activity)||data.activity.length!==7||data.activity.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!count(d.value))||!Number.isFinite(Date.parse(data.generatedAt||'')))throw new Error('O servidor não retornou um resumo válido.');
 return data;
}
export function renderSummary(data,{onExitSupport}={}) {
 const by=id=>document.getElementById(id),conn=data.connections,unknown=conn.providerReadStatus==='unavailable'||conn.slots.some(s=>s.status==='unknown'||s.status==='conflict');
 const support=!!data.viewer.id&&!!data.tenant.id&&data.viewer.id!==data.tenant.id;
 by('support-banner').hidden=!support;by('support-label').textContent=`Conta acessada: ${data.tenant.displayName||'Conta de suporte'}. Operador: ${data.viewer.displayName||'Master'}.`;
 by('exit-support').onclick=onExitSupport;
 by('tenant-description').textContent=`${data.tenant.displayName||'Conta atual'} · ${data.mode==='local_worker'?'resumo deste motor local':'dados da conta na nuvem'}.`;
 by('count-conversations').textContent=fmt(data.counts.conversations);by('count-pending').textContent=fmt(data.counts.pendingHuman);by('count-campaigns').textContent=fmt(data.counts.campaigns);
 by('campaign-caption').textContent=data.counts.campaigns===null?'Não carregadas no resumo local':'Todas, sem limite de listagem';
 by('count-connected').textContent=unknown&&conn.connected===0?'—':`${conn.connected}/${conn.total}`;
 by('connection-caption').textContent=unknown?'Há status que precisa de verificação':`${conn.total} ${conn.total===1?'chip permitido':'chips permitidos'} para esta conta`;
 const conflict=conn.slots.some(s=>s.status==='conflict');
 const waLabel=conflict?'Conflito':unknown?(conn.connected>0?'Parcial':'Indisponível'):conn.connected>0?'Conectado':'Desconectado';
 by('wa-tag').textContent=waLabel;by('wa-tag').className=`tag ${unknown?'tag-amber':conn.connected>0?'tag-green':'tag-neutral'}`;
 by('wa-caption').textContent=conflict?'Mais de um transporte reporta conexão':unknown?'Não foi possível confirmar todos os chips':`${conn.connected} de ${conn.total} ${conn.total===1?'chip conectado':'chips conectados'}`;
 by('worker-tag').textContent=conn.workerOnline?'Online':'Sem sinal recente';by('worker-tag').className=`tag ${conn.workerOnline?'tag-green':'tag-neutral'}`;
 by('data-caption').textContent=data.mode==='local_worker'?'Leitura da memória deste motor':'Contagens agregadas, sem carregar contatos';
 const date=new Date(data.generatedAt);by('updated-at').textContent=`Consultado às ${new Intl.DateTimeFormat('pt-BR',{timeZone:data.timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(date)} · Fortaleza`;
 by('updated-at').title=date.toISOString();
 const max=Math.max(3,Math.ceil(Math.max(0,...data.activity.map(d=>d.value))/3)*3),sum=data.activity.reduce((n,d)=>n+d.value,0);
 by('activity-total').textContent=`${fmt(sum)} no período`;by('chart-bars').replaceChildren();by('activity-table').replaceChildren();by('chart-axis').replaceChildren();
 for(const n of [max,Math.round(max*2/3),Math.round(max/3),0]){const span=document.createElement('span');span.textContent=fmt(n);by('chart-axis').append(span);}
 const descriptions=[];
 for(const [i,d] of data.activity.entries()) {
  const short=`${d.date.slice(8)}/${d.date.slice(5,7)}`;descriptions.push(`${short}: ${fmt(d.value)}`);
  const li=document.createElement('li');if(i===data.activity.length-1)li.className='is-highlighted';
  const col=document.createElement('div');col.className='bar-column';const bar=document.createElement('span');bar.className='bar';bar.style.height=`${d.value===0?0:d.value/max*100}%`;
  const value=document.createElement('span');value.className='bar-value';value.textContent=fmt(d.value);bar.append(value);col.append(bar);
  const label=document.createElement('span');label.className='bar-label';label.textContent=short;li.append(col,label);by('chart-bars').append(li);
  const tr=document.createElement('tr');for(const content of [short,fmt(d.value)]){const td=document.createElement('td');td.textContent=content;tr.append(td);}by('activity-table').append(tr);
 }
 by('activity-plot').setAttribute('aria-label',`Conversas por data da última atividade, não volume de mensagens. ${descriptions.join('; ')}.`);
 by('activity-empty').hidden=sum!==0;by('activity-empty').textContent='Nenhuma conversa tem última atividade registrada neste período.';
 const attention=[];
 if(data.counts.pendingHuman>0)attention.push({title:`${fmt(data.counts.pendingHuman)} ${data.counts.pendingHuman===1?'conversa aguarda':'conversas aguardam'} atendimento humano`,description:'Abra a caixa de entrada para revisar a fila.',href:'/painel#crm',icon:'chat',tag:'Conversas'});
 if(unknown)attention.push({title:conflict?'Verificar conflito de transportes':'Status do WhatsApp indisponível',description:conflict?'Há sinais simultâneos de Evolution e motor local. Nenhum transporte foi escolhido automaticamente.':'Um status antigo não foi tratado como conexão confirmada.',href:'/conexoes/',icon:'connection',tag:'Verificar'});
 else if(conn.connected===0)attention.push({title:'Nenhum chip conectado',description:'A página não reconecta chips nem inicia campanhas. Confira o estado antes de qualquer ação.',href:'/conexoes/',icon:'connection',tag:'Conexões'});
 if(data.campaigns?.paused>0)attention.push({title:`${fmt(data.campaigns.paused)} ${data.campaigns.paused===1?'campanha pausada':'campanhas pausadas'}`,description:'Permanecem pausadas. Abrir este resumo não retoma envios.',href:'/painel#campanhas',icon:'campaign',tag:'Campanhas'});
 if(!attention.length)attention.push({title:'Nenhuma pendência identificada neste resumo',description:'Este é um resumo, não uma auditoria de entrega ou de toda a operação.',href:'/painel#crm',icon:'check',tag:'Revisar'});
 by('attention-list').replaceChildren();by('attention-count').textContent=`${attention.length} ${attention.length===1?'sinal':'sinais'}`;
 for(const item of attention){const row=document.createElement('a');row.className='attention-row';row.href=item.href;row.innerHTML=`<span class="attention-icon tone-sage">${icon(item.icon)}</span><div><strong></strong><span></span></div><span class="tag tag-neutral"></span><span>${icon('chevron')}</span>`;row.querySelector('strong').textContent=item.title;row.querySelector('div>span').textContent=item.description;row.querySelector('.tag').textContent=item.tag;by('attention-list').append(row);}
 setSyncState('fresh');
}
export function setSyncState(state,message='') {
 const status=document.getElementById('sync-status');if(!status)return;
 status.textContent=state==='fresh'?'Resumo atualizado':state==='loading'?'Atualizando…':state==='paused'?'Atualização em pausa':'Dados desatualizados';status.dataset.state=state;
 const warning=document.getElementById('data-warning');warning.hidden=state!=='stale';warning.textContent=message||'Não foi possível atualizar. Exibindo o último resumo válido; os status abaixo não são confirmação atual.';
 const stale=state==='stale';document.querySelector('.metrics-strip')?.classList.toggle('is-stale',stale);
 document.getElementById('data-tag').textContent=stale?'Desatualizado':state==='loading'?'Consultando':'Atualizado';document.getElementById('data-tag').className=`tag ${stale?'tag-amber':'tag-green'}`;
 // Um WhatsApp antes conectado não continua "confirmado" quando o snapshot fica antigo.
 if(stale){document.getElementById('connection-caption').textContent='Último status conhecido — não atualizado';document.getElementById('wa-tag').textContent='Não atualizado';document.getElementById('wa-tag').className='tag tag-amber';document.getElementById('worker-tag').textContent='Não atualizado';document.getElementById('worker-tag').className='tag tag-amber';}
}

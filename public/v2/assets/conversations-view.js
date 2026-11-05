/* Conversas — módulo novo do CRM. Somente o que a API nova entrega; sem dados de demonstração. */
const number = new Intl.NumberFormat('pt-BR');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const STAGE_LABELS = {
  novo: 'Novo',
  qualificando: 'Qualificando',
  em_atendimento: 'Em atendimento',
  aguardando_humano: 'Aguardando humano',
  concluido: 'Concluído'
};

const STAGE_TONE = {
  novo: 'neutral',
  qualificando: 'neutral',
  em_atendimento: 'green',
  aguardando_humano: 'amber',
  concluido: 'neutral'
};

export function formatPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith('55')) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}

// Iniciais legíveis: nomes sem letras (telefone) usam os dois últimos dígitos.
// Quando o contato não tem nome salvo, o "nome" é o telefone: exibimos formatado.
export function displayName(name = '', phone = '') {
  const clean = String(name || '').trim();
  if (clean && /[\p{L}]/u.test(clean)) return clean;
  return formatPhone(phone || clean.replace(/\D/g, '')) || 'Contato WhatsApp';
}

export function initialsOf(name = '') {
  const clean = String(name).trim();
  const letters = clean.replace(/[^\p{L}\s]/gu, ' ').trim();
  if (letters) {
    const parts = letters.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  const digits = clean.replace(/\D/g, '');
  return digits ? digits.slice(-2) : '?';
}

export function relativeTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

export function clockTime(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }).format(date)
    : '';
}

export function dayLabel(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (dayKey(date) === dayKey(today)) return 'Hoje';
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(date) === dayKey(yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', timeZone: 'America/Fortaleza' }).format(date);
}

export function mountConversations() {
  const main = document.createElement('main');
  main.className = 'page conversations-page';
  main.innerHTML = `
   <header class="page-header">
    <div><div class="eyebrow">CONVERSAS E CRM</div><h1>Conversas</h1><p id="conversations-caption">Carregando as conversas desta conta…</p></div>
    <div class="header-actions">
     <button type="button" class="button button-secondary" id="conversations-refresh"><span data-icon="refresh"></span>Atualizar</button>
     <a class="button button-primary" href="/painel#crm"><span data-icon="chat"></span>Abrir painel completo</a>
    </div>
   </header>
   <div class="summary-meta"><span class="sync-pill" id="conversations-sync">Atualizando…</span><span id="conversations-updated"></span><span class="readonly-note" id="conversations-scope">Somente leitura nesta etapa</span></div>
   <div class="data-warning" id="conversations-warning" role="status" hidden></div>

   <section class="conv-metrics" aria-label="Resumo das conversas">
    <button type="button" class="conv-metric" data-pill=""><strong id="count-all">—</strong><span>Na caixa de entrada</span></button>
    <button type="button" class="conv-metric" data-pill="unread"><strong id="count-unread">—</strong><span>Com não lidas</span></button>
    <button type="button" class="conv-metric" data-pill="human"><strong id="count-human">—</strong><span>Aguardando humano</span></button>
    <button type="button" class="conv-metric" data-pill="pinned"><strong id="count-pinned">—</strong><span>Fixadas</span></button>
   </section>

   <div class="conv-shell">
    <section class="panel conv-list-panel" aria-labelledby="conv-list-title">
     <div class="panel-heading"><div><h2 id="conv-list-title">Caixa de entrada</h2><p id="conv-list-caption">—</p></div><label class="conv-visibility"><span class="sr-only">Mostrar</span>
      <select id="conv-visibility"><option value="inbox">Caixa de entrada</option><option value="archived">Arquivadas</option><option value="all">Todas</option></select></label></div>
     <div class="conv-toolbar">
      <div class="conv-search"><span data-icon="search"></span><input id="conv-search" type="search" placeholder="Buscar por nome, telefone ou etiqueta…" autocomplete="off" spellcheck="false" maxlength="80" aria-label="Buscar conversas"></div>
      <select id="conv-stage" aria-label="Filtrar por etapa"><option value="">Todas as etapas</option></select>
     </div>
     <div class="conv-pills" role="group" aria-label="Filtros rápidos">
      <button type="button" class="conv-pill is-active" data-pill="">Todas</button>
      <button type="button" class="conv-pill" data-pill="unread">Não lidas</button>
      <button type="button" class="conv-pill" data-pill="human">Aguardando humano</button>
      <button type="button" class="conv-pill" data-pill="pinned">Fixadas</button>
      <button type="button" class="conv-pill" data-pill="paused">IA pausada</button>
     </div>
     <ol class="conv-list" id="conv-list" aria-live="polite"></ol>
     <p class="conv-empty" id="conv-empty" hidden></p>
     <div class="conv-more"><button type="button" class="button button-secondary" id="conv-load-more" hidden>Carregar mais</button></div>
    </section>

    <section class="panel conv-thread-panel" aria-labelledby="conv-thread-title">
     <div class="conv-thread-head">
      <div class="conv-avatar" id="thread-avatar">?</div>
      <div class="conv-thread-id"><h2 id="conv-thread-title">Escolha uma conversa</h2><p id="conv-thread-sub">As mensagens aparecem aqui, sem sair desta página.</p></div>
     </div>
     <div class="conv-thread-body" id="conv-thread-body">
      <div class="conv-placeholder" id="conv-placeholder"><span data-icon="chat"></span><p>Selecione uma conversa na lista para ler as mensagens e o resumo do atendimento.</p></div>
      <ol class="conv-messages" id="conv-messages" hidden></ol>
     </div>
     <div class="conv-thread-foot" id="conv-thread-foot" hidden>
      <p class="conv-readonly"><span data-icon="info"></span><span>Enviar mensagens por esta tela ainda não está liberado nesta etapa. Use o painel completo para responder.</span></p>
      <a class="button button-primary" id="conv-open-panel" href="/painel#crm">Abrir no painel completo<span data-icon="arrow"></span></a>
     </div>
    </section>
   </div>`;
  document.body.replaceChildren(main);

  const by = id => document.getElementById(id);
  const state = { filters: { visibility: 'inbox', stage: '', pill: '', q: '', limit: 30, offset: 0 }, items: [], total: 0, selected: null, loading: false, stale: false };

  function paintStages(stages) {
    const select = by('conv-stage');
    if (select.dataset.painted === '1') return;
    select.dataset.painted = '1';
    for (const stage of stages) {
      const option = document.createElement('option');
      option.value = stage;
      option.textContent = STAGE_LABELS[stage] || stage;
      select.append(option);
    }
  }

  function syncBadge(stateName, message = '') {
    const pill = by('conversations-sync');
    pill.textContent = stateName === 'fresh' ? 'Lista atualizada' : stateName === 'loading' ? 'Atualizando…' : 'Dados desatualizados';
    pill.dataset.state = stateName;
    const warning = by('conversations-warning');
    warning.hidden = stateName !== 'stale';
    if (stateName === 'stale') warning.textContent = message || 'Não foi possível atualizar. A lista abaixo é a última leitura válida e pode estar incompleta.';
    const tag = by('conversations-scope');
    tag.textContent = stateName === 'stale' ? 'Última leitura — não é confirmação atual' : 'Somente leitura nesta etapa';
  }

  function itemMarkup(item) {
    const unread = item.unread > 0;
    const initials = initialsOf(item.name);
    const shownName = displayName(item.name, item.phone);
    const stageTone = STAGE_TONE[item.stage] || 'neutral';
    const lastRole = item.lastMessage?.role === 'owner' ? 'Você: ' : '';
    const preview = item.lastMessage ? `${lastRole}${item.lastMessage.preview || ''}` : 'Sem mensagens registradas';
    return `<li><button type="button" class="conv-item${item.chatId === state.selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}" data-chat="${esc(item.chatId)}">
      <span class="conv-avatar">${esc(initials)}</span>
      <span class="conv-item-main">
        <span class="conv-item-top"><strong>${esc(shownName)}</strong><time datetime="${esc(item.lastMessageAt || '')}">${esc(relativeTime(item.lastMessageAt))}</time></span>
        <span class="conv-item-preview">${esc(preview)}</span>
        <span class="conv-item-tags">
          ${item.pinned ? '<span class="tag tag-neutral">Fixada</span>' : ''}
          ${unread ? `<span class="tag tag-green">${number.format(item.unread)} não lidas</span>` : ''}
          <span class="tag tag-${stageTone}">${esc(STAGE_LABELS[item.stage] || item.stage)}</span>
          ${item.paused ? '<span class="tag tag-amber">IA pausada</span>' : ''}
          ${item.slotId ? `<span class="tag tag-neutral">${esc(item.slotId.replace('slot_', 'Chip '))}</span>` : ''}
        </span>
      </span>
      ${item.phone ? `<span class="conv-item-phone">${esc(formatPhone(item.phone))}</span>` : ''}
     </button></li>`;
  }

  function renderList() {
    const list = by('conv-list');
    if (!state.items.length) {
      list.replaceChildren();
      const empty = by('conv-empty');
      empty.hidden = false;
      empty.textContent = state.filters.q || state.filters.pill || state.filters.stage || state.filters.visibility !== 'inbox'
        ? 'Nenhuma conversa corresponde a estes filtros.'
        : 'Esta conta ainda não tem conversas registradas.';
    } else {
      by('conv-empty').hidden = true;
      list.innerHTML = state.items.map(itemMarkup).join('');
    }
    by('conv-load-more').hidden = !(state.total > state.items.length);
    by('conv-load-more').textContent = `Carregar mais (${number.format(Math.max(0, state.total - state.items.length))} restantes)`;
  }

  function renderCounts(counts) {
    by('count-all').textContent = number.format(counts.inbox);
    by('count-unread').textContent = number.format(counts.unread);
    by('count-human').textContent = number.format(counts.human);
    by('count-pinned').textContent = number.format(counts.pinned);
    by('conv-list-caption').textContent = `${number.format(state.total)} ${state.total === 1 ? 'conversa' : 'conversas'} neste filtro · ${number.format(counts.inbox)} na caixa de entrada`;
    for (const button of document.querySelectorAll('.conv-pill')) button.classList.toggle('is-active', (button.dataset.pill || '') === state.filters.pill);
    for (const button of document.querySelectorAll('.conv-metric')) button.classList.toggle('is-active', (button.dataset.pill || '') === state.filters.pill);
  }

  function messageMarkup(message) {
    const outgoing = message.role === 'owner';
    const media = message.media;
    const body = message.text
      ? esc(message.text).replace(/\n/g, '<br>')
      : media && media.url
        ? `<a class="conv-media" href="${esc(media.url)}" target="_blank" rel="noopener">${esc(media.name || (media.mime?.startsWith('audio') ? 'Mensagem de voz' : 'Abrir arquivo'))}</a>`
        : media
          ? `<span class="conv-media is-unavailable">${esc(media.name || (media.mime?.startsWith('audio') ? 'Áudio' : 'Arquivo'))} — mídia não disponível neste ambiente</span>`
          : '<span class="muted">Mensagem sem texto registrado</span>';
    const ack = outgoing && Number.isInteger(message.ack) ? `<span class="conv-ack" title="Confirmação do WhatsApp">${message.ack >= 3 ? '✓✓' : message.ack >= 2 ? '✓✓' : '✓'}</span>` : '';
    return `<li class="conv-message ${outgoing ? 'is-out' : 'is-in'}"><div class="bubble">${body}</div><div class="conv-message-meta">${outgoing ? 'Você' : 'Contato'} · ${esc(clockTime(message.at))} ${ack}</div></li>`;
  }

  function renderThread(data) {
    const conversation = data.conversation;
    by('conv-thread-title').textContent = displayName(conversation.name, conversation.phone);
    by('conv-thread-sub').textContent = [
      formatPhone(conversation.phone),
      STAGE_LABELS[conversation.stage] || conversation.stage,
      conversation.slotId ? conversation.slotId.replace('slot_', 'Chip ') : '',
      `${number.format(conversation.messageCount)} mensagens`
    ].filter(Boolean).join(' · ');
    by('thread-avatar').textContent = initialsOf(conversation.name);
    by('conv-placeholder').hidden = true;
    const list = by('conv-messages');
    list.hidden = false;
    // Mensagens vêm em ordem cronológica; exibimos da mais antiga para a mais nova.
    let html = '';
    let currentDay = '';
    for (const message of data.messages) {
      const day = dayLabel(message.at);
      if (day && day !== currentDay) { currentDay = day; html += `<li class="conv-day"><span>${esc(day)}</span></li>`; }
      html += messageMarkup(message);
    }
    list.innerHTML = html || '<li class="conv-day"><span>Sem mensagens nesta conversa</span></li>';
    by('conv-thread-foot').hidden = false;
    by('conv-open-panel').href = `/painel#crm`;
    list.scrollTop = list.scrollHeight;
    by('conv-thread-body').scrollTop = by('conv-thread-body').scrollHeight;
  }

  return { state, by, renderList, renderCounts, renderThread, syncBadge, paintStages };
}

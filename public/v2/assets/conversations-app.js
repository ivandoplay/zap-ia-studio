import {createSessionClient, SessionError} from './session-client.js';
import {mountShell} from './shell.js';
import {mountConversations} from './conversations-view.js';
import {showGate} from './view.js';

let localStore, sessionStore;
try { localStore = localStorage; } catch {}
try { sessionStore = sessionStorage; } catch {}

const api = createSessionClient({ localStore, sessionStore });
let ui, shell, generation = 0, loadingList = false, loadingThread = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(payload) {
  if (payload?.ok !== true || payload.schemaVersion !== 1 || !Array.isArray(payload.items)) {
    throw new SessionError('O servidor não retornou uma lista de conversas válida.', 503);
  }
  return payload;
}

async function initialize() {
  const mine = ++generation;
  ui?.dispose?.();
  shell?.dispose?.();
  showGate({ eyebrow: 'CONVERSAS', busy: true, title: 'Verificando a sessão…', description: 'Nenhuma mensagem será enviada por esta página.' });
  try {
    const status = await api.status();
    if (mine !== generation) return;
    if (status.cloudLoginRequired) throw new SessionError('Entre pelo painel para ver as conversas.', 401, { authRequired: true });

    const first = check(await api.request('/api/conversations?limit=30&visibility=inbox'));
    if (mine !== generation) return;

    ui = mountConversations();
    shell = mountShell({
      pageId: 'conversas',
      title: 'Conversas',
      currentUser: first.viewer,
      permissions: first.permissions,
      appearanceApi: {
        account: true,
        load: () => api.request('/api/dashboard/appearance'),
        save: theme => api.request('/api/dashboard/appearance', { method: 'PUT', body: { theme } })
      },
      aboutText: 'Esta etapa entrega leitura de conversas na navegação nova: lista com busca, filtros e as mensagens de cada atendimento. Enviar mensagens, anexos e alterar etapas continuam no painel completo até a próxima etapa da migração. Os dados vêm da conta autenticada; nada é simulado.'
    });

    const { state, by, renderList, renderCounts, renderThread, syncBadge, paintStages } = ui;
    paintStages(first.stages);
    const apply = payload => {
      state.items = payload.items;
      state.total = payload.total;
      renderCounts(payload.counts);
      renderList();
      by('conversations-caption').textContent = `${payload.tenant?.displayName || 'Sua conta'} · ${payload.mode === 'local_worker' ? 'conversas deste motor local' : 'conversas na nuvem'}.`;
      by('conversations-updated').textContent = `Consultado às ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' }).format(new Date())} · Fortaleza`;
      syncBadge(state.stale ? 'stale' : 'fresh');
    };
    apply(first);

    let abort;
    const loadList = async ({ append = false, quiet = false } = {}) => {
      if (loadingList) return;
      loadingList = true;
      abort?.abort();
      abort = new AbortController();
      if (!quiet) syncBadge('loading');
      if (append) state.filters.offset = state.items.length;
      const params = new URLSearchParams({
        limit: String(state.filters.limit),
        offset: String(state.filters.offset),
        visibility: state.filters.visibility,
        pill: state.filters.pill,
        stage: state.filters.stage,
        q: state.filters.q
      });
      try {
        const payload = check(await api.request(`/api/conversations?${params}`, { signal: abort.signal }));
        if (mine !== generation) return;
        state.stale = false;
        if (append) { state.items = [...state.items, ...payload.items]; state.total = payload.total; renderCounts(payload.counts); renderList(); syncBadge('fresh'); }
        else apply(payload);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if ([401, 403].includes(error.status)) { showGate({ eyebrow: 'CONVERSAS', title: error.status === 403 ? 'Acesso não autorizado' : 'Entre para continuar', description: error.message, retry: initialize }); return; }
        state.stale = true;
        syncBadge('stale', `${error.message || 'Falha ao consultar.'} A lista abaixo é a última leitura válida.`);
      } finally { loadingList = false; }
    };

    const openConversation = async chatId => {
      if (loadingThread) return;
      loadingThread = true;
      state.selected = chatId;
      renderList();
      try {
        const payload = await api.request(`/api/conversations/${encodeURIComponent(chatId)}?limit=60`);
        if (mine !== generation) return;
        if (payload?.ok !== true || !payload.conversation || !Array.isArray(payload.messages)) throw new SessionError('Conversa inválida.', 503);
        renderThread(payload);
      } catch (error) {
        if ([401, 403].includes(error.status)) { showGate({ eyebrow: 'CONVERSAS', title: 'Sessão expirada', description: error.message, retry: initialize }); return; }
        by('conv-thread-title').textContent = 'Não foi possível abrir esta conversa';
        by('conv-thread-sub').textContent = error.message || 'Tente novamente.';
        by('conv-messages').innerHTML = `<li class="conv-day"><span>${error.status === 404 ? 'Conversa não encontrada nesta conta' : 'Falha na leitura'}</span></li>`;
        by('conv-messages').hidden = false;
        by('conv-placeholder').hidden = true;
        state.selected = null;
        renderList();
      } finally { loadingThread = false; }
    };

    // Busca com espera curta; sem sobreposição de consultas.
    let timer;
    const scheduleSearch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.filters.offset = 0; loadList(); }, 320);
    };

    by('conv-search').addEventListener('input', event => { state.filters.q = event.target.value.slice(0, 80); scheduleSearch(); });
    by('conv-stage').addEventListener('change', event => { state.filters.stage = event.target.value; state.filters.offset = 0; loadList(); });
    by('conv-visibility').addEventListener('change', event => { state.filters.visibility = event.target.value; state.filters.offset = 0; loadList(); });
    for (const button of document.querySelectorAll('.conv-pill, .conv-metric')) {
      button.addEventListener('click', () => { state.filters.pill = button.dataset.pill || ''; state.filters.offset = 0; loadList(); });
    }
    by('conv-list').addEventListener('click', event => {
      const target = event.target.closest('[data-chat]');
      if (target) openConversation(target.dataset.chat);
    });
    by('conv-load-more').addEventListener('click', () => loadList({ append: true }));
    by('conversations-refresh').addEventListener('click', () => {
      by('conversations-refresh').disabled = true;
      loadList().finally(() => { by('conversations-refresh').disabled = false; });
    });

    // Atualiza sozinho a cada 45s enquanto a aba está visível e ninguém está digitando.
    const tick = async () => {
      if (document.visibilityState !== 'visible' || loadingList || loadingThread) return;
      if (document.activeElement === by('conv-search')) return;
      await loadList({ quiet: true });
    };
    const interval = setInterval(tick, 45_000);
    window.addEventListener('pagehide', () => clearInterval(interval));
    void wait(0);
  } catch (error) {
    if (mine !== generation) return;
    showGate({
      eyebrow: 'CONVERSAS',
      title: error.status === 401 ? 'Entre para continuar' : 'Conversas indisponíveis',
      description: error.status === 401 ? 'Use o login do painel. Depois volte para Conversas na navegação nova.' : error.message || 'Não foi possível consultar as conversas.',
      retry: initialize
    });
  }
}

window.addEventListener('storage', event => { if ([ 'zapia_cloud_auth', 'zapia_act_as', 'zapia_pin', null].includes(event.key)) initialize(); });
window.addEventListener('pagehide', () => { generation++; shell?.dispose?.(); });
initialize();

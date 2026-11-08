// Infra de performance do navegador — carregada ANTES de app.js.
// 1. Deduplicação e cancelamento de chamadas HTTP repetidas
// 2. Debounce reutilizável para busca/autocomplete
// 3. Telemetria de usuário real (LCP, CLS, INP, TTFB) + conexão da rede
// 4. Skeleton de carregamento
// Nada aqui depende de estado do painel: roda no login, no painel e nas páginas geradas.

(function perfFront() {
  if (window.__perfFront) return;
  window.__perfFront = true;

  // ── 1. Deduplicação de GET ────────────────────────────────────────────────
  // Dois renders que pedem a mesma URL ao mesmo tempo compartilham a mesma promise.
  // Sem isso, trocar de aba rápido dispara 3x /api/bootstrap.
  const emVoo = new Map();

  function chaveDe(url, options) {
    const metodo = String(options?.method || 'GET').toUpperCase();
    const ator = typeof state !== 'undefined' ? (state.actAsUser?.userId || '') : '';
    const auth = typeof state !== 'undefined' ? (state.cloudSession?.accessToken || '') : '';
    return `${metodo} ${url} ${ator} ${auth.slice(-16)}`;
  }

  /** Executa `fetcher` uma única vez por URL+ator enquanto a requisição está em andamento. */
  window.dedupeRequest = function dedupeRequest(url, options, fetcher) {
    const metodo = String(options?.method || 'GET').toUpperCase();
    if (metodo !== 'GET') return fetcher(); // POST/PATCH nunca deduplica: pode ter efeito
    const key = chaveDe(url, options);

    if (emVoo.has(key)) return emVoo.get(key);

    // Só deduplicamos enquanto a primeira chamada está em voo. Reusar uma
    // Response já consumida ou um resultado antigo depois de um POST seria incorreto.
    const promise = Promise.resolve().then(fetcher).finally(() => emVoo.delete(key));

    emVoo.set(key, promise);
    return promise;
  };

  /** Esquece o cache curto — chamado depois de salvar algo, para não ler dado velho. */
  window.invalidateRequestCache = function invalidateRequestCache() {
    // API reservada para compatibilidade: sem cache de resposta não há dado a invalidar.
  };

  // ── 2. Debounce / throttle ────────────────────────────────────────────────
  window.debounce = function debounce(fn, espera = 250) {
    let t = null;
    let ultimosArgs = [];
    let ultimoContexto = null;
    const wrapped = function (...args) {
      ultimosArgs = args;
      ultimoContexto = this;
      clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn.apply(ultimoContexto, ultimosArgs);
      }, espera);
    };
    wrapped.cancel = () => { clearTimeout(t); t = null; };
    wrapped.flush = (...args) => {
      clearTimeout(t);
      t = null;
      fn.apply(ultimoContexto, args.length ? args : ultimosArgs);
    };
    return wrapped;
  };

  window.throttleRaf = function throttleRaf(fn) {
    let pedido = false;
    return (...args) => {
      if (pedido) return;
      pedido = true;
      requestAnimationFrame(() => {
        pedido = false;
        fn(...args);
      });
    };
  };

  // ── 3. Métricas de usuário real (RUM) ─────────────────────────────────────
  // Manda pelo sendBeacon (não bloqueia e sobrevive ao fechamento da aba).
  const rum = { lcp: 0, cls: 0, inp: 0, ttfb: 0, navegacaoMs: 0 };
  const conexao = navigator.connection?.effectiveType || navigator.connection?.type || 'desconhecida';

  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) rum.ttfb = Math.round(nav.responseStart);
    window.addEventListener('load', () => {
      const navFinal = performance.getEntriesByType('navigation')[0];
      if (navFinal) rum.navegacaoMs = Math.round(navFinal.loadEventEnd || navFinal.domContentLoadedEventEnd || 0);
    }, { once: true });
    new PerformanceObserver((lista) => {
      const e = lista.getEntries().at(-1);
      if (e) rum.lcp = Math.round(e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    let cls = 0;
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) if (!e.hadRecentInput) cls += e.value;
      rum.cls = Math.round(cls * 1000) / 1000;
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) {
        if (e.duration > rum.inp) rum.inp = Math.round(e.duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch {}

  let enviado = false;
  function enviarRum() {
    if (enviado) return;
    enviado = true;
    const linhas = Object.entries(rum)
      .filter(([name, value]) => value > 0 || name === 'cls')
      .map(([name, value]) =>
        JSON.stringify({ name, value, page: location.pathname, connection: conexao })
      );
    if (!linhas.length) return;
    const corpo = linhas.join('\n');
    try {
      navigator.sendBeacon('/api/rum', new Blob([corpo], { type: 'text/plain;charset=UTF-8' }));
    } catch {}
  }
  // visibilitychange é o momento mais confiável no celular (aba não é fechada, é trocada)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') enviarRum();
  });
  window.addEventListener('pagehide', enviarRum, { once: true });

  window.__perfRum = rum;

  // ── 4. Skeleton ──────────────────────────────────────────────────────────
  /**
   * Marca uma região como "carregando", guardando o conteúdo real para restaurar.
   * Sem flash de tela vazia e sem layout pulando: o skeleton já ocupa a altura final.
   */
  window.skeletonOn = function skeletonOn(el, linhas = 3, { altura = 14, larguras = null } = {}) {
    if (!el || el.dataset.skeleton === 'on') return;
    el.dataset.skeleton = 'on';
    el.dataset.skeletonBackup = el.innerHTML;
    const total = Math.max(1, Math.min(24, Number(linhas) || 3));
    const cols = Array.isArray(larguras) && larguras.length ? larguras : [92, 78, 64, 86, 72, 58, 88, 70, 60, 82, 74, 66];
    const html = `<div class="skl" aria-hidden="true">${Array.from({ length: total }, (_, i) =>
      `<span class="skl-linha" data-h="${altura}" data-w="${cols[i % cols.length]}"></span>`).join('')}</div>`;
    el.innerHTML = html;
    el.setAttribute('aria-busy', 'true');
  };

  /**
   * Remove o esqueleto. `manter` = true deixa o elemento vazio em vez de
   * restaurar o HTML antigo (o render real já pintou o conteúdo, ou a lista
   * ficou vazia e quem manda no vazio é o próprio render).
   */
  window.skeletonOff = function skeletonOff(el, { manter = true } = {}) {
    if (!el || el.dataset.skeleton !== 'on') return;
    const backup = el.dataset.skeletonBackup || '';
    el.innerHTML = manter ? '' : backup;
    delete el.dataset.skeletonBackup;
    delete el.dataset.skeleton;
    el.removeAttribute('aria-busy');
  };

  /** Skeleton temporizado: some sozinho depois de `tempoMs` se o render não chegar antes. */
  window.skeletonPulse = function skeletonPulse(seletor, tempoMs = 4000, linhas = 3) {
    const el = typeof seletor === 'string' ? document.querySelector(seletor) : seletor;
    if (!el) return;
    skeletonOn(el, linhas);
    setTimeout(() => skeletonOff(el), tempoMs);
  };

  // ── 5. Paginação/virtualização leve ──────────────────────────────────────
  /**
   * Renderiza a lista em blocos: começa com `inicial` itens e cresce conforme o
   * usuário rola. Evita pintar 2.000 contatos de uma vez numa lista que cabe 8 na tela.
   */
  window.renderPaged = function renderPaged(container, itens, desenhar, { inicial = 60, passo = 60 } = {}) {
    if (!container) return;
    let mostrando = Math.min(inicial, itens.length);
    const pintar = () => {
      container.innerHTML = itens.slice(0, mostrando).map(desenhar).join('');
    };
    pintar();
    container.onscroll = null;
    if (itens.length > mostrando) {
      container.onscroll = window.throttleRaf(() => {
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 120) {
          if (mostrando >= itens.length) return;
          mostrando = Math.min(mostrando + passo, itens.length);
          pintar();
        }
      });
    }
  };
})();

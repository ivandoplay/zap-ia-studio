// Performance de entrega: compressão, cache de estático, ETag e telemetria de rota.
// Tudo em um módulo só para rodar igual no servidor Node e na função da Vercel,
// onde não existe `app.listen` nem CDN própria — só o handler do Express.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// ── Quais tipos vale comprimir ────────────────────────────────────────────────
// Só texto. WebP/AVIF/OGG/PDF já são comprimidos: recomprimir gasta CPU sem ganho.
const COMPRESSIVE = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|manifest\+json)|image\/svg\+xml|font\/woff)/i;
const ALREADY_ZIPPED = /\.(webp|avif|png|jpe?g|gif|ico|ogg|opus|mp3|m4a|wav|webm|pdf|zip|woff2?|gz|br)$/i;

const MIME_BY_EXT = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

// ── Cache em memória dos estáticos comprimidos ───────────────────────────────
// app.js tem 450KB; comprimir a cada requisição custa ~8ms de CPU por visita.
// Guardamos o resultado em Brotli uma única vez por versão do arquivo.
// Chave = caminho + mtime + tamanho, então qualquer deploy invalida sozinho.
const compressedCache = new Map();
const COMPRESSED_CACHE_MAX_BYTES = 32 * 1024 * 1024;
let compressedCacheBytes = 0;

function remember(key, entry) {
  if (compressedCacheBytes + entry.body.length > COMPRESSED_CACHE_MAX_BYTES) {
    compressedCache.clear();
    compressedCacheBytes = 0;
  }
  compressedCache.set(key, entry);
  compressedCacheBytes += entry.body.length;
  return entry;
}

// Escolhe Brotli quando o navegador aceita (todos os modernos), senão GZIP.
export function negotiateEncoding(acceptEncoding = '') {
  const aceitos = new Map();
  for (const item of String(acceptEncoding || '').toLowerCase().split(',')) {
    const [nome, ...params] = item.trim().split(';');
    if (!nome) continue;
    const qText = params.map((p) => p.trim()).find((p) => p.startsWith('q='))?.slice(2);
    const q = qText === undefined ? 1 : Number(qText);
    aceitos.set(nome, Number.isFinite(q) ? q : 0);
  }
  const br = Math.max(aceitos.get('br') || 0, aceitos.get('*') || 0);
  const gzip = Math.max(aceitos.get('gzip') || 0, aceitos.get('*') || 0);
  if (br > 0 && br >= gzip) return 'br';
  if (gzip > 0) return 'gzip';
  return null;
}

export function compressSync(buffer, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5, // 5 = rápido no build e ainda ~79% menor
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length
      }
    });
  }
  return zlib.gzipSync(buffer, { level: 6 });
}

/**
 * Comprime um Buffer com cache por chave de versão.
 * Usado tanto pelo middleware de estático quanto pelo /api/bootstrap.
 */
export function compressWithCache(buffer, encoding, cacheKey) {
  if (!encoding) return null;
  const key = `${encoding}:${cacheKey}`;
  const hit = compressedCache.get(key);
  if (hit) return hit.body;
  const body = compressSync(buffer, encoding);
  remember(key, { body });
  return body;
}

/**
 * Middleware de compressão. Precisa vir ANTES das rotas para pegar tudo:
 * estáticos, JSON da API e HTML.
 */
export function compressionMiddleware({ threshold = 1024 } = {}) {
  return function compress(req, res, next) {
    // NDJSON/SSE precisa sair token a token; esta middleware comprime no end()
    // e não deve misturar chunks identity com um final comprimido.
    if (String(req.headers['x-stream'] || '') === '1') return next();
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    const originalSetHeader = res.setHeader.bind(res);
    let skip = false;
    res.setHeader = (name, value) => {
      const lower = String(name).toLowerCase();
      if (lower === 'content-type') {
        if (!COMPRESSIVE.test(String(value))) skip = true;
        else res.vary('Accept-Encoding'); // CDN/navegador precisam separar br/gzip/identity
      }
      if (lower === 'content-encoding') skip = true;
      return originalSetHeader(name, value);
    };
    if (!encoding) return next();

    const originalEnd = res.end.bind(res);
    res.end = (chunk, encoding_, callback) => {
      const cb = typeof encoding_ === 'function' ? encoding_ : callback;
      const textEncoding = typeof encoding_ === 'string' ? encoding_ : undefined;
      const contentType = String(res.getHeader('Content-Type') || '');
      if (skip || !COMPRESSIVE.test(contentType) || !chunk || typeof chunk === 'function') {
        return originalEnd(chunk, textEncoding, cb);
      }
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, textEncoding || 'utf8');
      if (body.length < threshold) return originalEnd(body, undefined, cb);
      const compressed = compressSync(body, encoding);
      // Comprimir já é o suficiente: recalculamos o Content-Length e o ETag
      // para o navegador não guardar um tamanho errado.
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(compressed.length));
      res.removeHeader('ETag');
      return originalEnd(compressed, undefined, cb);
    };
    next();
  };
}

/**
 * Cache de estático por tipo de arquivo:
 *  - JS/CSS/PNG/ícone com hash de conteúdo na URL: 1 ano, imutável
 *  - JS/CSS sem hash (app.js, styles.css): no-cache + ETag (o deploy troca a versão)
 *  - HTML: no-cache sempre, porque aponta para a versão nova dos assets
 */
export function staticCacheHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  if (ALREADY_ZIPPED.test(filePath) || ext === '.js' || ext === '.css' || ext === '.svg' || ext === '.woff2') {
    // hashed file names (ex.: app.9f2c1a.js) podem ficar 1 ano
    if (/\.[0-9a-f]{8,}\.(js|css|woff2|png|webp|avif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // arquivo de nome fixo: 5 min de cache e revalidação em background; deploy
      // novo chega rápido sem obrigar cada visita a baixar o corpo completo.
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    }
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
}

// ── Telemetria de rota (latência real do usuário) ────────────────────────────
// Sem SDK: um log estruturado com o formato de campos do semantic-conventions do
// OpenTelemetry (trace_id/span_id/duration/http.route/status), pronto para ser
// ingerido por qualquer coletor, e um endpoint /api/perf/rum para o navegador.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 800);
const recentRequests = [];
let totalRequests = 0;
let totalDurationMs = 0;

function newSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

export function requestTelemetry() {
  return function telemetry(req, res, next) {
    const started = process.hrtime.bigint();
    const traceparent = String(req.headers.traceparent || '');
    const parent = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i.exec(traceparent);
    const supplied = String(req.headers['x-trace-id'] || '');
    const traceId = parent?.[1]?.toLowerCase() || (/^[a-f0-9]{32}$/i.test(supplied) ? supplied.toLowerCase() : crypto.randomBytes(16).toString('hex'));
    const parentSpanId = parent?.[2]?.toLowerCase() || null;
    const spanId = newSpanId();
    res.setHeader('X-Trace-Id', traceId);
    res.setHeader('traceparent', `00-${traceId}-${spanId}-01`);

    res.on('finish', () => {
      // Só a rota importa: /api/crm/123 não pode virar 500 entradas distintas.
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`.replace(/\/+/g, '/')
        : String(req.originalUrl || '').split('?')[0];
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      totalRequests++;
      totalDurationMs += durationMs;

      const entry = {
        time: new Date().toISOString(),
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        'http.method': req.method,
        'http.route': route,
        'http.status_code': res.statusCode,
        duration_ms: Math.round(durationMs),
        slow: durationMs >= SLOW_MS
      };

      recentRequests.push(entry);
      if (recentRequests.length > 200) recentRequests.shift();

      // Rota lenta entra no log mesmo em produção: é o que aponta o N+1 e a query caríssima.
      if (entry.slow || res.statusCode >= 500) {
        console.warn(entry.slow ? '[perf] requisição lenta' : '[perf] erro HTTP', JSON.stringify(entry));
      }
    });
    next();
  };
}

export function perfSnapshot() {
  const porRota = new Map();
  for (const r of recentRequests) {
    const atual = porRota.get(r['http.route']) || { rota: r['http.route'], n: 0, somaMs: 0, piorMs: 0 };
    atual.n++;
    atual.somaMs += r.duration_ms;
    atual.piorMs = Math.max(atual.piorMs, r.duration_ms);
    porRota.set(r['http.route'], atual);
  }
  return {
    ok: true,
    escopo: process.env.VERCEL ? 'instancia-serverless-atual' : 'processo-local',
    totalRequests,
    mediaGeralMs: totalRequests ? Math.round(totalDurationMs / totalRequests) : 0,
    limiteLentoMs: SLOW_MS,
    rotas: [...porRota.values()]
      .map((r) => ({ ...r, mediaMs: Math.round(r.somaMs / r.n) }))
      .sort((a, b) => b.piorMs - a.piorMs)
      .slice(0, 15),
    ultimasLentas: recentRequests.filter((r) => r.slow).slice(-15).reverse()
  };
}

/**
 * Endpoint de métricas de usuário real (RUM): o navegador manda LCP/CLS/INP/TTFB.
 * Recebe NDJSON do sendBeacon e mantém só a janela recente em memória.
 */
export function createRumRouter(express) {
  const router = express.Router();
  const amostras = [];
  const limitesPorIp = new Map();
  const metricasPermitidas = new Set(['lcp', 'cls', 'inp', 'ttfb', 'navegacaoMs']);
  router.post('/rum', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
    const agora = Date.now();
    const ip = String(req.ip || req.socket?.remoteAddress || 'desconhecido').slice(0, 80);
    let limite = limitesPorIp.get(ip);
    if (!limite || agora >= limite.ate) limite = { n: 0, ate: agora + 60_000 };
    if (limite.n >= 30) return res.status(429).end();
    limite.n++;
    limitesPorIp.set(ip, limite);
    if (limitesPorIp.size > 1000) {
      for (const [key, value] of limitesPorIp) if (agora >= value.ate) limitesPorIp.delete(key);
    }

    let aceitas = 0;
    let ultimaPagina = '';
    const linhas = String(req.body || '').split('\n').filter(Boolean).slice(0, 20);
    for (const linha of linhas) {
      try {
        const dado = JSON.parse(linha);
        const metrica = String(dado.name || '');
        const valor = Number(dado.value);
        if (!metricasPermitidas.has(metrica) || !Number.isFinite(valor) || valor < 0 || valor > 600_000) continue;
        const pathname = String(dado.page || '').split(/[?#]/, 1)[0];
        ultimaPagina = pathname.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 60) || '/';
        const tipoConexao = String(dado.connection || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
        amostras.push({
          time: new Date(agora).toISOString(),
          metrica,
          valor,
          pagina: ultimaPagina,
          conexao: tipoConexao
        });
        aceitas++;
      } catch {
        // Uma linha malformada não invalida as demais métricas do sendBeacon.
      }
    }
    while (amostras.length > 500) amostras.shift();
    // O processo da Vercel é efêmero: o log estruturado é a trilha que pode ser
    // coletada pela observabilidade da plataforma/um sink externo. Sem ID de usuário.
    if (aceitas) console.info('[perf-rum]', JSON.stringify({ time: new Date(agora).toISOString(), amostras: aceitas, pagina: ultimaPagina }));
    res.status(204).end();
  });
  router.get('/rum/resumo', (_req, res) => {
    const porMetrica = new Map();
    for (const a of amostras) {
      const lista = porMetrica.get(a.metrica) || [];
      lista.push(a.valor);
      porMetrica.set(a.metrica, lista);
    }
    const resumo = {};
    for (const [metrica, valores] of porMetrica) {
      const ordenado = [...valores].sort((x, y) => x - y);
      const p75 = ordenado[Math.floor(ordenado.length * 0.75)] ?? 0;
      resumo[metrica] = {
        amostras: valores.length,
        p75: Math.round(p75 * 100) / 100,
        pior: Math.round(ordenado[ordenado.length - 1] * 100) / 100
      };
    }
    res.json({ ok: true, escopo: process.env.VERCEL ? 'instancia-serverless-atual' : 'processo-local', metricas: resumo });
  });
  return router;
}

// ── Leitura de arquivo estático com compressão em cache ─────────────────────
/**
 * Serve um arquivo de `public/` comprimido e com cache correto.
 * Devolve `false` quando o arquivo não existe (o chamador decide o 404).
 */
export function sendStaticFile(req, res, rootDir, urlPath) {
  const rel = decodeURIComponent(String(urlPath || '')).replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return false;
  const full = path.join(rootDir, 'public', rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  staticCacheHeaders(res, full);
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }

  const ext = path.extname(full).toLowerCase();
  if (MIME_BY_EXT[ext]) res.setHeader('Content-Type', MIME_BY_EXT[ext]);
  if (MIME_BY_EXT[ext] && COMPRESSIVE.test(MIME_BY_EXT[ext])) res.vary('Accept-Encoding');

  const encoding = ALREADY_ZIPPED.test(full) ? null : negotiateEncoding(req.headers['accept-encoding']);
  const isHead = req.method === 'HEAD';
  if (encoding) {
    const body = compressWithCache(fs.readFileSync(full), encoding, `${full}:${stat.mtimeMs}:${stat.size}`);
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', String(body.length));
    res.status(200).end(isHead ? undefined : body);
    return true;
  }

  res.setHeader('Content-Length', String(stat.size));
  res.status(200).end(isHead ? undefined : fs.readFileSync(full));
  return true;
}

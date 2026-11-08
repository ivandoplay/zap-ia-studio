import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import { once } from 'node:events';
import { compressionMiddleware, sendStaticFile, staticCacheHeaders, negotiateEncoding, createRumRouter } from '../src/shared/perf.js';
import { aplicarCursor } from '../src/shared/keyset-pagination.js';

async function servidorDeTeste() {
  const app = express();
  app.use(compressionMiddleware());
  app.use('/api', createRumRouter(express));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const arquivo = (req.path || '/').replace(/^\/+/, '') || 'index.html';
    if (!/\.(?:js|mjs|css|json|html|svg|txt)$/i.test(arquivo)) return next();
    if (sendStaticFile(req, res, process.cwd(), arquivo)) return;
    next();
  });
  app.use(express.static(path.join(process.cwd(), 'public'), { setHeaders: staticCacheHeaders }));
  app.get('/_test/json', (_req, res) => res.json({ message: 'teste '.repeat(2000) }));
  app.get('/_test/stream', (req, res) => {
    if (req.headers['x-stream'] === '1') {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write('{"tipo":"token"}\n');
      return res.end('{"tipo":"fim"}\n');
    }
    res.end('sem streaming');
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function request(url, headers = {}, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('negociação escolhe encoding aceito e respeita q=0', () => {
  assert.equal(negotiateEncoding('gzip, br'), 'br');
  assert.equal(negotiateEncoding('br;q=0, gzip;q=1'), 'gzip');
  assert.equal(negotiateEncoding('gzip;q=0'), null);
});

test('estáticos texto comprimem em Brotli, cacheiam por versão e aceitam 304', async (t) => {
  const { server, origin } = await servidorDeTeste();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const primeira = await request(`${origin}/app.js`, { 'accept-encoding': 'br' });
  assert.equal(primeira.status, 200);
  assert.equal(primeira.headers['content-encoding'], 'br');
  assert.match(primeira.headers['cache-control'], /max-age=300/);
  assert.match(primeira.headers['content-type'], /javascript/);
  const original = zlib.brotliDecompressSync(primeira.body);
  assert.ok(original.length > primeira.body.length * 3);

  const identity = await request(`${origin}/app.js`);
  assert.equal(identity.status, 200);
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.match(identity.headers.vary || '', /Accept-Encoding/i);

  const validada = await request(`${origin}/app.js`, {
    'accept-encoding': 'br',
    'if-none-match': primeira.headers.etag
  });
  assert.equal(validada.status, 304);
  assert.equal(validada.body.length, 0);
});

test('JSON API comprime corretamente; SVG comprime sem estragar o tipo', async (t) => {
  const { server, origin } = await servidorDeTeste();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const json = await request(`${origin}/_test/json`, { 'accept-encoding': 'gzip' });
  assert.equal(json.status, 200);
  assert.equal(json.headers['content-encoding'], 'gzip');
  assert.match(json.headers.vary || '', /Accept-Encoding/i);
  assert.match(zlib.gunzipSync(json.body).toString(), /teste/);

  const svg = await request(`${origin}/icon-v2.svg`, { 'accept-encoding': 'br,gzip' });
  assert.equal(svg.status, 200);
  assert.equal(svg.headers['content-encoding'], 'br');
  assert.match(svg.headers['content-type'], /svg/);
});

test('stream NDJSON permanece sem compressão para não misturar chunks', async (t) => {
  const { server, origin } = await servidorDeTeste();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const resposta = await request(`${origin}/_test/stream`, { 'accept-encoding': 'br,gzip', 'x-stream': '1' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers['content-encoding'], undefined);
  assert.match(resposta.body.toString(), /"tipo":"token"/);
  assert.match(resposta.body.toString(), /"tipo":"fim"/);
});

test('RUM aceita apenas métricas whitelisted e retorna resumo sem identidade', async (t) => {
  const { server, origin } = await servidorDeTeste();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const envio = [
    JSON.stringify({ name: 'lcp', value: 950, page: '/painel?email=privado', connection: '4g' }),
    JSON.stringify({ name: 'email', value: 1, page: '/painel', connection: '4g' })
  ].join('\n');
  const post = await request(`${origin}/api/rum`, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(envio) }, 'POST', envio);
  assert.equal(post.status, 204);
  const resumo = await request(`${origin}/api/rum/resumo`);
  const dados = JSON.parse(resumo.body.toString());
  assert.equal(dados.metricas.lcp.amostras, 1);
  assert.equal(dados.metricas.email, undefined);
});

test('paginação por cursor limita páginas e retorna próximo cursor', () => {
  const chamadas = [];
  const builder = {
    gt: (...args) => (chamadas.push(['gt', ...args]), builder),
    order: (...args) => (chamadas.push(['order', ...args]), builder),
    limit: (...args) => (chamadas.push(['limit', ...args]), builder)
  };
  const pagina = aplicarCursor(builder, { cursor: '2026-11-05T10:00:00Z', coluna: 'updated_at', limite: 2 });
  assert.ok(chamadas.some((c) => c[0] === 'gt'));
  assert.deepEqual(chamadas.at(-1), ['limit', 3]);
  assert.deepEqual(pagina.finalizar([{ updated_at: 'a' }, { updated_at: 'b' }, { updated_at: 'c' }]), {
    pagina: [{ updated_at: 'a' }, { updated_at: 'b' }], temMais: true, proximoCursor: 'b'
  });
});

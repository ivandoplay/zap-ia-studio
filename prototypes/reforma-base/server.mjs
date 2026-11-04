// Servidor estático exclusivo do protótipo. Não importa o backend, .env ou WhatsApp.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
export function createPreviewServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors *");
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Este protótipo não executa operações de escrita.'); }
      const pathname = decodeURIComponent(new URL(req.url, 'http://preview.invalid').pathname);
      if (pathname.includes('..') || pathname.split('/').some(segment => segment.startsWith('.')) || pathname.startsWith('/api')) { res.writeHead(404); return res.end('Não encontrado.'); }
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(404); return res.end('Não encontrado.'); }
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, 'index.html');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Página não encontrada nesta prévia.'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createPreviewServer().listen(port, '0.0.0.0', () => console.log(`Prévia isolada disponível na porta ${port}; sem API ou conexão real.`));
}

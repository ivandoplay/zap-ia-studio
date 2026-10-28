import net from 'node:net';
import os from 'node:os';

// Origens recebidas do navegador devem corresponder ao Host que serviu a
// própria aplicação. Um domínio de hospedagem compartilhado NÃO é confiança.
export function isTrustedBrowserOrigin(origin, host, { cloud = false } = {}) {
  if (!origin) return true; // CLI e integrações não-browser, sem credenciais de navegador
  try {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || !host || /[\s\\/@]/.test(host)) return false;
    const target = new URL(`${u.protocol}//${host}`);
    if (target.host !== u.host) return false;
    if (cloud) return true; // Na Vercel o Host já é roteado pelo projeto.
    const name = u.hostname.toLowerCase();
    if (name === 'localhost' || name === '[::1]' || name === os.hostname().toLowerCase() || name.endsWith('.local') || name.endsWith('.e2b.app') || name.endsWith('.vercel.app')) return true;
    if (net.isIP(name) !== 4) return false;
    const [a,b] = name.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  } catch { return false; }
}

export function rejectUntrustedBrowserRequest(req, { cloud = false } = {}) {
  const origin = req.headers?.origin;
  if (origin && !isTrustedBrowserOrigin(origin, req.headers?.host, { cloud })) return true;
  // Formulários entre sites podem agir mesmo que não possam ler a resposta CORS.
  // Navegação/CLI sem Origin continua permitida; bloqueia escrita cross-site.
  if (!origin && req.headers?.['sec-fetch-site'] === 'cross-site' && !['GET','HEAD','OPTIONS'].includes(String(req.method || '').toUpperCase())) return true;
  return false;
}

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_HEADERS = ['accept', 'content-type', 'authorization', 'x-panel-pin', 'x-zapia-act-as'];

function validOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  try { return new URL(origin).origin === request.nextUrl.origin; }
  catch { return false; }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!ALLOWED_METHODS.has(request.method)) return NextResponse.json({ ok: false, error: 'Método não permitido.' }, { status: 405 });
  if (!validOrigin(request)) return NextResponse.json({ ok: false, error: 'Origem não autorizada.' }, { status: 403 });
  if (!['1'].includes(request.headers.get('x-ienvia-request') || '')) return NextResponse.json({ ok: false, error: 'Requisição inválida.' }, { status: 403 });

  const backend = process.env.IENVIA_BACKEND_URL;
  if (!backend) return NextResponse.json({ ok: false, error: 'Backend não configurado neste ambiente.' }, { status: 503 });
  let base: URL;
  try { base = new URL(backend); } catch { return NextResponse.json({ ok: false, error: 'Configuração de backend inválida.' }, { status: 500 }); }
  if (!['https:', 'http:'].includes(base.protocol) || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) {
    return NextResponse.json({ ok: false, error: 'O backend de produção precisa usar HTTPS.' }, { status: 500 });
  }

  const { path } = await context.params;
  if (!path.length || path.some(part => !/^[a-zA-Z0-9._~-]+$/.test(part))) return NextResponse.json({ ok: false, error: 'Caminho inválido.' }, { status: 400 });
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, base);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of ALLOWED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.delete('host');
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > 15 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'Requisição excede o limite permitido.' }, { status: 413 });

  try {
    const upstream = await fetch(target, { method: request.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(55_000), redirect: 'manual' });
    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    responseHeaders.set('cache-control', 'no-store');
    const payload = await upstream.arrayBuffer();
    return new NextResponse(payload, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível conectar ao serviço Ienvia.' }, { status: 502 });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

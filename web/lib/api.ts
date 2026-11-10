import { readAuth } from './auth';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = readAuth();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Ienvia-Request', '1');
  if (auth?.session.access_token) headers.set('Authorization', `Bearer ${auth.session.access_token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/backend/${path.replace(/^\/+/, '')}`, { ...init, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Falha na API (${response.status}).`;
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('ienvia:unauthorized'));
    throw new Error(message);
  }
  return data as T;
}

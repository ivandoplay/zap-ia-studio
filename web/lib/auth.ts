export type IenviaSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  token_type?: string;
};

export type IenviaUser = {
  id?: string;
  username?: string;
  displayName?: string;
  role?: string;
};

const STORAGE_KEY = 'zapia_cloud_auth';

export function readAuth(): { session: IenviaSession; user?: IenviaUser } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.session ?? parsed;
    if (typeof session?.access_token !== 'string' || typeof session?.refresh_token !== 'string') return null;
    return { session, user: parsed?.user };
  } catch { return null; }
}

export function saveAuth(session: IenviaSession, user?: IenviaUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ session, user: user ?? null }));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

// Configuração Pública da Nuvem ZAP-IA Studio (Supabase Auth + RLS Isolado por Conta)
// Nota de Segurança: SUPABASE_ANON_KEY é uma chave pública de cliente desenhada para uso com Row Level Security (RLS).
// A chave administrativa SUPABASE_SERVICE_ROLE_KEY NUNCA fica no código — fica apenas nas variáveis criptografadas da Vercel.

export const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://iuysmojhaxplnhfrxqkv.supabase.co'
).trim();

export const SUPABASE_ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1eXNtb2poYXhwbG5oZnJ4cWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODQ2NTYsImV4cCI6MjEwODU2MDY1Nn0.g5aleELjiV3S0PJq4VvGtCN0zMvtamd8YwaexwWaCqs'
).trim();

export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export const MEDIA_BUCKET = 'zapia-media';

export function isCloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Permite login simples apenas com nome de usuário (ex: "jeffersonivan") ou e-mail completo.
 */
export function normalizeUsername(input = '') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) return raw.split('@')[0].replace(/[^a-z0-9._-]/g, '');
  return raw.replace(/[^a-z0-9._-]/g, '');
}

export function usernameToAuthEmail(input = '') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  const clean = normalizeUsername(raw);
  return clean ? `${clean}@zapia.local` : '';
}

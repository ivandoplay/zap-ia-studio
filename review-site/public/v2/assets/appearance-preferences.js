// Preferência visual não é autorização. O sujeito deve vir da sessão já verificada.
export const DEFAULT_APPEARANCE = 'dark';
export function appearanceKey(subject) {
  return typeof subject === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(subject)
    ? `ienvia:appearance:v1:${subject}` : null;
}
export function normalizeAppearance(value) { return value === 'light' ? 'light' : DEFAULT_APPEARANCE; }
export function resolveAppearanceSubject(currentUser) {
  if (!currentUser || typeof currentUser !== 'object') return null;
  // Em suporte, a aparência pertence ao operador autenticado, nunca ao cliente acessado.
  const subject = currentUser.impersonating ? currentUser.impersonatedBy?.id : currentUser.id;
  return appearanceKey(subject) ? subject : null;
}
export function readAppearance(storage, subject) {
  const key = appearanceKey(subject);
  if (!key) return DEFAULT_APPEARANCE;
  try { return normalizeAppearance(storage?.getItem(key)); } catch { return DEFAULT_APPEARANCE; }
}
export function saveAppearance(storage, subject, theme) {
  const key = appearanceKey(subject);
  if (!key || !storage || !['dark', 'light'].includes(theme)) return false;
  try { storage.setItem(key, theme); return true; } catch { return false; }
}

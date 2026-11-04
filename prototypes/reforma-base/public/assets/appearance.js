import { readAppearance, saveAppearance, resolveAppearanceSubject, appearanceKey } from './appearance-preferences.js';
import { icon } from './icons.js';

export function mountAppearance({ preview = false, currentUser = null } = {}) {
  const subject = preview ? 'preview-demo' : resolveAppearanceSubject(currentUser);
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const button = document.querySelector('#theme-toggle');
  const feedback = document.querySelector('#appearance-feedback');
  let timer;
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101815' : '#f4f7f5');
    const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  }
  apply(readAppearance(storage, subject));
  function onClick() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const saved = saveAppearance(storage, subject, next);
    apply(next);
    const themeName = next === 'dark' ? 'escuro' : 'claro';
    feedback.textContent = `Tema ${themeName} ativado. ${saved ? (preview ? 'Salvo neste navegador da prévia.' : 'Salvo neste navegador para este usuário.') : 'Ativo nesta aba; não foi possível salvar a preferência.'}`;
    feedback.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => { feedback.hidden = true; }, 5000);
  }
  function onStorage(event) { if (event.storageArea === storage && (event.key === appearanceKey(subject) || event.key === null)) apply(readAppearance(storage, subject)); }
  button.addEventListener('click', onClick);
  window.addEventListener('storage', onStorage);
  return () => { clearTimeout(timer); button.removeEventListener('click', onClick); window.removeEventListener('storage', onStorage); };
}

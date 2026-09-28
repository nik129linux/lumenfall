import { STRINGS, DEFAULT_LANG } from './strings.js';

let lang = DEFAULT_LANG;

export function getLang() { return lang; }

export function setLang(next) {
  lang = STRINGS[next] ? next : DEFAULT_LANG;
  try { localStorage.setItem('lumenfall.lang', lang); } catch (e) { /* private mode */ }
  return lang;
}

export function toggleLang() { return setLang(lang === 'es' ? 'en' : 'es'); }

// Restores the stored preference before the first paint, so nobody sees a flash
// of the wrong language on the title screen.
export function loadStoredLang() {
  try {
    const saved = localStorage.getItem('lumenfall.lang');
    if (saved && STRINGS[saved]) lang = saved;
  } catch (e) { /* private mode */ }
  return lang;
}

export function t(key) {
  const table = STRINGS[lang];
  return (table && table[key]) !== undefined ? table[key] : (STRINGS[DEFAULT_LANG][key] ?? key);
}

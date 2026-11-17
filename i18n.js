import fr from './locales/fr.js?v=5';
import de from './locales/de.js?v=5';
import it from './locales/it.js?v=5';
import en from './locales/en.js?v=5';
import gsw from './locales/gsw.js?v=5';
export const catalogs = { fr, de, it, en, gsw };

export const languages = ['fr', 'de', 'it', 'en', 'gsw'];
// Swiss German UI, Swiss German numeric/date conventions; never infer gsw from de-CH.
export const locales = { fr: 'fr-CH', de: 'de-CH', it: 'it-CH', en: 'en-GB', gsw: 'de-CH' };
export function detectLanguage(saved, preferred = []) {
  if (languages.includes(saved)) return saved;
  for (const candidate of preferred) {
    const base = String(candidate).toLowerCase().split(/[-_]/)[0];
    if (languages.includes(base)) return base;
  }
  return 'fr';
}
export function translate(lang, key, params = {}, dictionaries = catalogs) {
  if (/\.(one|other)$/.test(key) && typeof params.count === 'number') key = key.replace(/\.(one|other)$/, `.${new Intl.PluralRules(locales[lang] || locales.fr).select(params.count)}`);
  const template = dictionaries[lang]?.[key] ?? (lang === 'gsw' ? dictionaries.de?.[key] : undefined) ?? dictionaries.fr?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (typeof value === 'number') return new Intl.NumberFormat(locales[lang] || locales.fr).format(value);
    if (value?.key) return translate(lang, `${value.key}.${new Intl.PluralRules(locales[lang] || locales.fr).select(value.count)}`, { count: value.count }, dictionaries);
    if (value?.date) return new Intl.DateTimeFormat(locales[lang] || locales.fr, {
      timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric',
      ...(value.kind === 'datetime' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    }).format(new Date(value.date));
    return String(value ?? `{${name}}`);
  });
}
let language = 'fr';
export const getLanguage = () => language;
export const getLocale = () => locales[language];
export const t = (key, params) => translate(language, key, params);
export function plural(key, count) {
  return t(`${key}.${new Intl.PluralRules(getLocale()).select(count)}`, { count });
}
export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function tx(key, params = {}) {
  return `<span data-i18n="${escapeText(key)}" data-i18n-params="${escapeText(JSON.stringify(params))}">${escapeText(t(key, params))}</span>`;
}
export function px(key, count) {
  return tx(`${key}.${new Intl.PluralRules(getLocale()).select(count)}`, { count });
}
export function setText(node, key, params = {}) {
  node.dataset.i18n = key;
  node.dataset.i18nParams = JSON.stringify(params);
  node.textContent = t(key, params);
}
export function setHtml(node, markup) {
  delete node.dataset.i18n;
  delete node.dataset.i18nParams;
  node.innerHTML = markup;
}
export function formatDate(value, kind = 'time') {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  const options = kind === 'time' ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { day: '2-digit', month: '2-digit', year: 'numeric', ...(kind === 'datetime' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) };
  return new Intl.DateTimeFormat(getLocale(), { timeZone: 'Europe/Zurich', ...options }).format(new Date(value));
}
export function dateHtml(value, kind = 'time') {
  return `<span data-date="${escapeText(value || '')}" data-date-kind="${kind}">${escapeText(formatDate(value, kind))}</span>`;
}
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const params = JSON.parse(node.dataset.i18nParams || '{}');
    // Re-evaluate plurals after a language change (French treats zero as singular).
    const key = /\.(one|other)$/.test(node.dataset.i18n) && typeof params.count === 'number'
      ? node.dataset.i18n.replace(/\.(one|other)$/, `.${new Intl.PluralRules(getLocale()).select(params.count)}`) : node.dataset.i18n;
    node.textContent = t(key, params);
  }
  for (const attribute of ['aria-label', 'title', 'placeholder', 'content']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const node of root.querySelectorAll('[data-date]')) node.textContent = formatDate(node.dataset.date, node.dataset.dateKind);
}
export function setLanguage(next, { persist = true } = {}) {
  language = languages.includes(next) ? next : 'fr';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    const select = document.querySelector('#languageSelect');
    if (select) select.value = language;
    applyTranslations();
  }
  if (persist) { try { globalThis.localStorage?.setItem('aletrainLanguage', language); } catch { /* Optional preference. */ } }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aletrain:language', { detail: language }));
}
if (typeof document !== 'undefined') {
  let saved;
  try { saved = globalThis.localStorage?.getItem('aletrainLanguage'); } catch { /* Browser storage may be disabled. */ }
  setLanguage(detectLanguage(saved, globalThis.navigator?.languages || [globalThis.navigator?.language]), { persist: false });
  document.querySelector('#languageSelect')?.addEventListener('change', event => setLanguage(event.target.value));
}

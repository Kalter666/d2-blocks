import { app, save } from '../store.svelte.js';
import en from './en.js';
import ru from './ru.js';

// Language name shown in the switcher — in its own language, so it reads to the
// person who speaks it whatever the current UI locale is.
export const LOCALES = { en: 'English', ru: 'Русский' };
const DICTS = { en, ru };

/** The active bundle. Reads app.locale, so anything calling it re-runs on change. */
export const messages = () => DICTS[app.locale] ?? en;

/** t('toolbar.flow') / t('block.duplicate', { kind }) — falls back to en, then the key. */
export function t(key, params) {
  let s = messages().ui[key] ?? en.ui[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Translated category label, falling back to the canonical name. */
export const category = (name) => messages().categories[name] ?? en.categories[name] ?? name;

/** Translated {title, description, tags} for a catalog id, falling back to en. */
export const example = (id) => messages().examples[id] ?? en.examples[id] ?? { title: id, description: '', tags: [] };

/**
 * plural('examples.count', n) -> t('examples.count.<one|few|many|other>', { n }).
 * Intl.PluralRules picks the right form per locale (Russian needs one/few/many);
 * `.other` is the guaranteed fallback every language defines.
 */
export function plural(base, n) {
  const form = new Intl.PluralRules(app.locale).select(n);
  const key = messages().ui[`${base}.${form}`] != null ? `${base}.${form}` : `${base}.other`;
  return t(key, { n });
}

/** Reflect the locale onto <html lang> and the tab title — outside the Svelte tree. */
export function applyDocumentLocale() {
  document.documentElement.lang = app.locale;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

/** Switch language: update the store, persist it, and re-title the document. */
export function setLocale(locale) {
  app.locale = locale;
  save();
  applyDocumentLocale();
}

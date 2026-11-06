import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app, load, reset } from './store.svelte.js';
import { applyDocumentLocale } from './i18n/index.svelte.js';
import { SHAPES } from './blocks.js';
import en from './i18n/en.js';

// `?gallery` puts one of every shape on screen at once. models.test.js can prove
// a body sits on the floor and fits its footprint; it cannot say whether the
// thing looks like a database. This is how you check that, in one glance.
//
// It deliberately does not call load(), which leaves the store's `loaded` flag
// down — so autosave stays off and browsing the gallery can't overwrite whatever
// diagram you were working on.
// First-visit default from the browser; a saved locale (restored in load()) wins.
if (navigator.language?.toLowerCase().startsWith('ru')) app.locale = 'ru';

if (new URLSearchParams(location.search).has('gallery')) {
  app.blocks = [
    { type: 'direction', value: 'right' },
    // Named in English whatever the locale: these are d2 keys, and stay stable.
    ...SHAPES.map((shape) => ({ type: 'box', name: en.ui[`shape.${shape || 'default'}`], label: '', shape })),
  ];
} else {
  // Before mount, deliberately. Restoring the save replaces app.blocks, and state
  // created while a component is initialising belongs to that component — which
  // makes every later edit from a Block look, to Svelte's dev-only ownership
  // check, like a child mutating someone else's state.
  load();
}

applyDocumentLocale(); // reflect the resolved locale onto <html lang> and the tab title

export default mount(App, { target: document.getElementById('app') });

// Dev server only (tree-shaken from builds): e2e/helpers.js resets a warm page
// between tests with this instead of paying for a reload.
if (import.meta.env.DEV) window.__d2blocks = { reset };

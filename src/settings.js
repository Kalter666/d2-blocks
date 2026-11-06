// The diagram-wide settings: their defaults, the values each may take, and how
// they are saved. Pure, so settings.test.js can pin the save format; the store
// holds the live values.
//
// Adding a persisted setting is one entry in SETTINGS. It used to be four edits
// (the $state defaults, save(), load(), and the preview calls in Examples and
// MermaidImport), and missing load() reset it on every reload without a sound.

// ids only — the display name comes from t('theme.<id>') so it follows the locale.
export const THEMES = [0, 1, 3, 4, 5, 6, 7, 8, 100, 302, 300];
// d2 emits both and picks via prefers-color-scheme, so the diagram follows the
// OS theme like the rest of the app. Otherwise it's a white slab in dark mode.
export const DARK_THEMES = [200, 201, 301];
export const LAYOUTS = ['dagre', 'elk'];
// Language name shown in the switcher — in its own language, so it reads to the
// person who speaks it whatever the current UI locale is. Each needs src/i18n/<code>.js.
export const LOCALES = { en: 'English', ru: 'Русский' };

/** name → [default, allowed values]. Order is the order they are saved in. */
const SETTINGS = {
  layout: ['dagre', LAYOUTS],
  theme: [0, THEMES],
  darkTheme: [200, DARK_THEMES],
  appearance: ['system', ['system', 'light', 'dark']],
  locale: ['en', Object.keys(LOCALES)],
  sketch: [false, [false, true]],
  look: ['3d', ['3d', 'flat']], // see Canvas.svelte and Scene.svelte
};

export const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS).map(([k, [v]]) => [k, v]));

/** What a preview renders with: the app's defaults, not whatever is on the canvas. */
export const PREVIEW = { layout: DEFAULTS.layout, themeID: DEFAULTS.theme, darkThemeID: DEFAULTS.darkTheme, sketch: DEFAULTS.sketch };

/** Bump when the saved shape changes in a way an older reader would misread. */
export const VERSION = 1;

export function toSave(src, settings) {
  return JSON.stringify({
    v: VERSION, src,
    ...Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, settings[k]])),
  });
}

/**
 * The saved diagram and settings, or null when nothing is saved. Throws on a
 * save it can't read (corrupt, or written by a newer version); the caller keeps
 * a copy before carrying on. A value that is no longer allowed — a theme d2
 * dropped, a layout that went paid — falls back to its default on its own
 * rather than reaching d2.
 */
export function fromSave(raw) {
  const saved = JSON.parse(raw ?? 'null');
  if (saved == null) return null;
  if (typeof saved !== 'object' || typeof saved.src !== 'string') throw new Error('not a d2-blocks save');
  if ((saved.v ?? 1) > VERSION) throw new Error(`saved by a newer version (${saved.v})`);
  const settings = {};
  for (const [k, [, allowed]] of Object.entries(SETTINGS)) {
    if (allowed.includes(saved[k])) settings[k] = saved[k];
  }
  return { src: saved.src, settings };
}

/**
 * The theme ids d2 should render with. Forcing an appearance makes both slots
 * the chosen palette, so the OS preference can't swap it back.
 */
export function themeIds(appearance, theme, darkTheme) {
  return {
    themeID: appearance === 'dark' ? darkTheme : theme,
    darkThemeID: appearance === 'light' ? theme : darkTheme,
  };
}

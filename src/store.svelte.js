import { empty, serialize, parse, remove, moveInto, reorderIn } from './blocks.js';
import { encode, decode } from './share.js';

export const app = $state({
  blocks: empty(),
  layout: 'dagre',
  theme: 0,
  darkTheme: 200,
  sketch: false,
  hover: null,   // d2 id of the shape/connection under the pointer, either side
  dragging: null,
  svg: '',
  diagram: null,
  error: '',
  busy: true,
});

export const source = () => serialize(app.blocks) + '\n';

// ------------------------------------------------------------------ history

const past = [];
const future = [];
const snapshot = () => structuredClone($state.snapshot(app.blocks));

/** Call before any mutation. ponytail: whole-tree snapshots, fine at this size. */
export function commit() {
  past.push(snapshot());
  if (past.length > 100) past.shift();
  future.length = 0;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function undo() {
  if (!past.length) return;
  future.push(snapshot());
  app.blocks = past.pop();
}

export function redo() {
  if (!future.length) return;
  past.push(snapshot());
  app.blocks = future.pop();
}

// ---------------------------------------------------------------- mutations

/** Wrap a blocks.js operation so it lands in the undo history only if it did something. */
const edit = (fn) => (...args) => {
  const before = snapshot();
  if (fn(app.blocks, ...args) === false) return false;
  past.push(before);
  if (past.length > 100) past.shift();
  future.length = 0;
  return true;
};

export const move = edit(moveInto);
export const reorder = edit(reorderIn);
export const del = edit(remove);

export function add(block) {
  commit();
  app.blocks.push(block);
  return block;
}

// -------------------------------------------------------------- persistence

const KEY = 'd2-blocks';
let loaded = false; // until load() settles, autosave would overwrite the save

export function save() {
  if (!loaded) return;
  localStorage.setItem(KEY, JSON.stringify({
    src: source(), layout: app.layout, theme: app.theme, darkTheme: app.darkTheme, sketch: app.sketch,
  }));
}

export async function load() {
  try {
    const fromUrl = location.hash.slice(1);
    if (fromUrl) {
      try {
        app.blocks = parse(await decode(fromUrl));
        return;
      } catch { app.error = 'That share link could not be read.'; }
    }
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return;
    app.blocks = parse(saved.src);
    app.layout = saved.layout ?? app.layout;
    app.theme = saved.theme ?? app.theme;
    app.darkTheme = saved.darkTheme ?? app.darkTheme;
    app.sketch = saved.sketch ?? app.sketch;
  } catch {
    /* corrupt save, start fresh */
  } finally {
    loaded = true;
  }
}

export async function shareLink() {
  return `${location.origin}${location.pathname}#${await encode(source())}`;
}

import { empty, serialize, parse, remove, moveInto, reorderIn } from './blocks.js';
import { toMermaid, fromMermaid } from './mermaid.js';

export const app = $state({
  blocks: empty(),
  layout: 'dagre',
  theme: 0,
  darkTheme: 200,
  appearance: 'system', // 'system' | 'light' | 'dark'
  sketch: false,
  look: '3d',    // '3d' | 'flat' — see Canvas.svelte and Scene.svelte
  hover: null,   // d2 id of the shape/connection under the pointer, either side
  dragging: null,
  svg: '',
  diagram: null,
  error: '',
  busy: true,
});

export const source = () => serialize(app.blocks) + '\n';

// ------------------------------------------------------------------ history

// $state, not plain arrays: the toolbar's disabled bindings need something
// reactive to re-evaluate, or they latch on their first (empty) reading.
const past = $state([]);
const future = $state([]);

const snapshot = () => structuredClone($state.snapshot(app.blocks));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Call before any mutation. ponytail: whole-tree snapshots, fine at this size. */
export function commit() {
  past.push(snapshot());
  if (past.length > 100) past.shift();
  future.length = 0;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

/**
 * commit() fires on every field focus, so tabbing through inputs without typing
 * stacks up identical states. Rather than trying to detect "did this focus lead
 * to a change", step over entries that match where we already are — otherwise
 * the first press of undo visibly does nothing.
 */
function step(from, to) {
  const current = snapshot();
  while (from.length) {
    const state = from.pop();
    if (same(state, current)) continue;
    to.push(current);
    app.blocks = $state.snapshot(state); // unwrap: it came out of a $state array
    return true;
  }
  return false;
}

export const undo = () => step(past, future);
export const redo = () => step(future, past);

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

/**
 * The root direction belongs in the toolbar next to layout and theme, not in the
 * stack — it's one setting for the whole diagram, and as a block it could be
 * deleted with no way to get it back. It stays a block underneath so pasted d2
 * round-trips; the stack just doesn't render the root one.
 *
 * `down` is d2's own default, so a file with no direction statement reads as
 * down rather than inventing one the source doesn't say.
 */
export const direction = () => app.blocks.find((b) => b.type === 'direction')?.value ?? 'down';

export function setDirection(value) {
  commit();
  const found = app.blocks.find((b) => b.type === 'direction');
  if (found) found.value = value;
  else app.blocks.unshift({ type: 'direction', value });
}

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
    src: source(), layout: app.layout, theme: app.theme, darkTheme: app.darkTheme,
    appearance: app.appearance, sketch: app.sketch, look: app.look,
  }));
}

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return;
    app.blocks = parse(saved.src);
    app.layout = saved.layout ?? app.layout;
    app.theme = saved.theme ?? app.theme;
    app.darkTheme = saved.darkTheme ?? app.darkTheme;
    app.appearance = saved.appearance ?? app.appearance;
    app.sketch = saved.sketch ?? app.sketch;
    app.look = saved.look ?? app.look;
  } catch {
    /* corrupt save, start fresh */
  } finally {
    loaded = true;
  }
}

/**
 * Replace the whole tree from edited or pasted d2. The other direction of the
 * same loop `source()` closes: blocks are still the truth for block edits, but
 * text wins while the code pane has focus.
 */
export function setSource(text) {
  app.blocks = parse(text);
}

/** Export the current diagram as mermaid flowchart text. */
export const mermaid = () => toMermaid(app.blocks);

/** Replace the tree from pasted mermaid. Throws (undoably) on non-flowcharts. */
export function importMermaid(text) {
  commit();
  app.blocks = fromMermaid(text);
}

import { empty, serialize, parse, removeBlock, moveInto, reorderIn } from './blocks.js';
import { toMermaid, fromMermaid } from './mermaid.js';
import { DEFAULTS, toSave, fromSave } from './settings.js';
import { record, step as stepIn } from './history.js';

export const app = $state({
  blocks: empty(),
  // layout, theme, darkTheme, appearance, locale, sketch, look — the persisted
  // settings; their values and allowed ranges live in settings.js.
  ...DEFAULTS,
  hover: null,   // d2 id of the shape/connection under the pointer, either side
  dragging: null,
  svg: '',
  diagram: null,
  board: '',     // d2 target path of the board on screen; '' is the root
  boards: [],    // every layer/scenario/step in the source — see boards.js
  error: '',
  busy: true,
  renders: 0,    // finished draws, success or error; e2e waits on it (helpers.js drawn())
});

export const source = () => `${serialize(app.blocks)}\n`;

// ------------------------------------------------------------------ history

// $state, not plain arrays: the toolbar's disabled bindings need something
// reactive to re-evaluate, or they latch on their first (empty) reading.
const past = $state([]);
const future = $state([]);

const snapshot = () => structuredClone($state.snapshot(app.blocks));

/**
 * Call before any mutation, or it can't be undone. Block fields call it on
 * focus, the code pane on focus, and every function below that changes
 * app.blocks either calls it or goes through edit().
 */
export function commit() {
  record(past, future, snapshot());
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

function step(from, to) {
  const state = stepIn(from, to, snapshot());
  if (state == null) return false;
  app.blocks = $state.snapshot(state); // unwrap: it came out of a $state array
  return true;
}

export const undo = () => step(past, future);
export const redo = () => step(future, past);

// ---------------------------------------------------------------- mutations

/** Wrap a blocks.js operation so it lands in the undo history only if it did something. */
const edit = (fn) => (...args) => {
  const before = snapshot();
  if (fn(app.blocks, ...args) === false) return false;
  record(past, future, before);
  return true;
};

export const move = edit(moveInto);
export const reorder = edit(reorderIn);
export const del = edit(removeBlock);

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
// Until load() settles, autosave would overwrite the save. ?gallery never calls
// load() (main.js), so it never saves either — that is how it can't clobber yours.
let loaded = false;

/** The save as it would be written now, or null before load(). Reading it subscribes to everything saved. */
export const saving = () => (loaded ? toSave(source(), app) : null);

export function save(data = saving()) {
  if (data != null) localStorage.setItem(KEY, data);
}

export function load() {
  try {
    const saved = fromSave(localStorage.getItem(KEY));
    if (!saved) return;
    app.blocks = parse(saved.src);
    Object.assign(app, saved.settings);
  } catch {
    // Corrupt, from a newer version, or one a parse bug can't read. Start
    // fresh, but keep the bytes: the first autosave would otherwise overwrite
    // the only copy.
    try { localStorage.setItem(`${KEY}.bak`, localStorage.getItem(KEY)); } catch { /* full or blocked */ }
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

/**
 * Back to a first visit without reloading: empty diagram, default settings, no
 * history. Only for the e2e suite (main.js exposes it in dev builds), which
 * reuses one warm page per worker because a cold one costs ~6 s of wasm compile.
 */
export function reset() {
  Object.assign(app, DEFAULTS, { blocks: empty(), board: '', hover: null, error: '' });
  past.length = 0;
  future.length = 0;
}

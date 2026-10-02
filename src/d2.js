import { D2 } from '@terrastruct/d2';
import { sanitize } from './sanitize.js';
import { serial } from './serial.js';
import { boardAt, boardPaths } from './boards.js';

// One instance, one worker — until one dies. d2 runs as Go compiled to wasm in a
// web worker, and a panic in there takes the worker with it *silently*: no error
// event, no rejection, the pending promise simply never settles. Left alone that
// shows up as a spinner that never stops and a canvas that never updates again,
// including after a reload, since the input is restored from localStorage.
let d2 = new D2();

const PATIENCE = 8000; // generous: a cold first compile loads ~6 MB of wasm

/** Turn "never settles" into a real rejection, and replace the dead worker. */
function watch(work) {
  let timer;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        d2 = new D2(); // the old one is gone; the next attempt gets a live worker
        reject(new Error('The d2 engine stopped responding, so it was restarted. If this keeps happening, the last edit is crashing it — undo it, or clear the saved diagram.'));
      }, PATIENCE);
    }),
  ]);
}

// One worker means one job at a time: overlapping compile/render calls interleave
// on the single Go instance and hand back a corrupted SVG. Every draw goes through
// the gate so its compile+render runs to completion before the next starts.
const gate = serial();

/** Compile + render, serialised against the shared worker. Throws d2's own message on a syntax error. */
export function draw(src, opts = {}) {
  return gate(() => render(src, opts));
}

/**
 * `scale: 1` matters: without it d2 renders a fit-to-screen SVG with no
 * width/height at all, which stretches to its container and makes our own zoom
 * a no-op. With it the SVG has an intrinsic size we can scale predictably.
 *
 * `darkThemeID` makes d2 emit a prefers-color-scheme block, so the diagram
 * follows the OS theme the same way the rest of the app does.
 */
async function render(src, { layout = 'dagre', themeID = 0, darkThemeID = 200, sketch = false, board = '' }) {
  const r = await watch(d2.compile(src || '', { layout, themeID, darkThemeID, sketch, pad: 24 }));
  // A board that was renamed or deleted in the source falls back to the root.
  const shown = boardAt(r.diagram, board) ? board : '';
  const svg = await watch(d2.render(r.diagram, { ...r.renderOptions, scale: 1, noXMLTag: true, ...(shown && { target: shown }) }));
  return { svg: sanitize(svg), diagram: boardAt(r.diagram, shown), boards: boardPaths(r.diagram), board: shown };
}

/**
 * d2 tags every shape and connection <g> with base64(xml-escaped(id)).
 * Decoding what's in the document beats encoding a guess — the escaping rules
 * are d2's, not ours. See compile.test.js for the verification.
 *
 * Returns both directions: byId to light a shape up, idByEl to answer "what is
 * the pointer over?". A container's <g> wraps its children's, so that question
 * has to be answered by walking *up* from the event target — scanning the map
 * would report the outermost container every time.
 */
export function index(root) {
  const byId = new Map();
  const idByEl = new Map();
  for (const g of root.querySelectorAll('g[class]')) {
    const token = g.getAttribute('class').split(' ')[0];
    if (token === 'shape' || !token) continue;
    try {
      const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const id = unescapeXml(new TextDecoder().decode(bytes));
      byId.set(id, g);
      idByEl.set(g, id);
    } catch { /* not one of ours */ }
  }
  return { byId, idByEl };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#34;': '"', '&#39;': "'" };
const unescapeXml = (s) => s.replace(/&(?:amp|lt|gt|#34|#39);/g, (e) => ENTITIES[e]);

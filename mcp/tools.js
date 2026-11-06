// What the MCP server can do, as plain async functions so tools.test.js can
// call them without a transport. Everything here is the app's own code running
// under node: draw() from src/d2.js (with its serial gate and watchdog — the
// node build of d2 corrupts output on concurrent calls just like the browser
// one), the block parser, the mermaid bridge, the bundled examples, and the
// share-link codec. Nothing is reimplemented, so the server can't drift from
// the editor.
import { readFile } from 'node:fs/promises';
import { draw } from '../src/d2.js';
import { parse, serialize } from '../src/blocks.js';
import { toMermaid, mermaidToD2 } from '../src/mermaid.js';
import { DEFAULTS, THEMES, DARK_THEMES, LAYOUTS } from '../src/settings.js';
import { EXAMPLE_DEFINITIONS } from '../src/examples/catalog.js';
import { encode } from '../src/share.js';
import en from '../src/i18n/en.js';

export { THEMES, DARK_THEMES, LAYOUTS };

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
/** The hosted editor; package.json `homepage` is what Pages serves. */
export const EDITOR = pkg.homepage;

/**
 * d2 reports compile errors as a JSON array of `{range, errmsg}`; each errmsg
 * already carries `index:<line>:<col>:`. Anything else is passed through.
 */
export function d2Error(e) {
  const message = String(e?.message ?? e);
  try {
    const list = JSON.parse(message);
    if (Array.isArray(list)) return list.map((x) => x.errmsg.replace(/^index:/, 'line ')).join('\n');
  } catch { /* not d2's JSON */ }
  return message;
}

const withNewline = (src) => (src.endsWith('\n') ? src : `${src}\n`);

/** Compile and render d2. Returns the SVG, or throws d2's error, formatted. */
export async function renderD2({ source, theme = DEFAULTS.theme, darkTheme = DEFAULTS.darkTheme, layout = DEFAULTS.layout, sketch = DEFAULTS.sketch, board = '' }) {
  try {
    const r = await draw(source, { layout, themeID: theme, darkThemeID: darkTheme, sketch, board });
    return { svg: r.svg, boards: r.boards.map((b) => b.path), board: r.board };
  } catch (e) {
    throw new Error(d2Error(e));
  }
}

/** Every `raw` block in the tree: the lines the editor keeps as plain d2 text. */
function rawBlocks(blocks, out = []) {
  for (const b of blocks) {
    if (b.type === 'raw') out.push(b.text);
    else if (b.type === 'group') rawBlocks(b.children, out);
  }
  return out;
}

/** What a compiled diagram *means*: every shape and connection with its kind and text. */
const meaning = (d) => JSON.stringify([
  (d.shapes ?? []).map((x) => [x.id, x.type, x.label]).sort(),
  (d.connections ?? []).map((x) => [x.id, x.label, x.srcArrow, x.dstArrow]).sort(),
]);

/**
 * Does it compile, what does the editor do to it, and what stays as plain text
 * instead of editable blocks. `roundTrip` is the editor's promise (CLAUDE.md):
 * - "exact": back byte-for-byte;
 * - "reformatted": reprinted in the editor's canonical spacing (`{ shape: x }`
 *   becomes `{shape: x}`), compiling to the same diagram — `editorSource` shows it;
 * - "changed": the reprint draws something else. That is a bug in blocks.js.
 */
export async function checkD2({ source }) {
  const src = withNewline(source);
  const blocks = parse(src);
  const reprinted = `${serialize(blocks)}\n`;
  const result = {
    compiles: true,
    error: null,
    roundTrip: 'exact',
    rawBlocks: rawBlocks(blocks),
    shapes: 0,
    connections: 0,
    boards: [],
  };
  try {
    const r = await draw(src, {});
    result.shapes = r.diagram.shapes?.length ?? 0;
    result.connections = r.diagram.connections?.length ?? 0;
    result.boards = r.boards.map((b) => b.path);
    if (reprinted !== src) {
      const again = await draw(reprinted, {}).catch(() => null);
      result.roundTrip = again && meaning(again.diagram) === meaning(r.diagram) ? 'reformatted' : 'changed';
      result.editorSource = reprinted;
    }
  } catch (e) {
    result.compiles = false;
    result.error = d2Error(e);
    if (reprinted !== src) {
      result.roundTrip = 'reformatted'; // can't compare meaning without a compile
      result.editorSource = reprinted;
    }
  }
  return result;
}

/** mermaid flowchart → d2, or d2 → mermaid. Best-effort; mermaid.js says what is dropped. */
export function convert({ from, source }) {
  if (from === 'mermaid') return mermaidToD2(source);
  if (from === 'd2') return toMermaid(parse(withNewline(source)));
  throw new Error(`from must be "mermaid" or "d2", not ${JSON.stringify(from)}`);
}

const summarize = ({ id, category }) => ({ id, category, title: en.examples[id]?.title, description: en.examples[id]?.description, tags: en.examples[id]?.tags });

/** The bundled gallery: every example's metadata, or one example with its source. */
export async function examples({ id } = {}) {
  if (!id) return EXAMPLE_DEFINITIONS.map(summarize);
  const def = EXAMPLE_DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`no example ${JSON.stringify(id)}; call examples with no id for the list`);
  // id comes from the catalog, never the caller, so it can't walk the filesystem.
  const source = await readFile(new URL(`../src/examples/${def.id}.d2`, import.meta.url), 'utf8');
  return { ...summarize(def), source };
}

/** A link that opens `source` in the hosted editor (or `base`, e.g. a dev server). */
export async function openInEditor({ source, base = EDITOR }) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('base must be https, or a localhost dev server');
  }
  return `${url.origin}${url.pathname}${await encode(withNewline(source))}`;
}

// What the MCP server can do, as plain async functions so tools.test.js can
// call them without a transport. Everything here is the app's own code running
// under node: draw() from src/d2.js (with its serial gate and watchdog — the
// node build of d2 corrupts output on concurrent calls just like the browser
// one), the block parser, the mermaid bridge, the bundled examples, and the
// share-link codec. Nothing is reimplemented, so the server can't drift from
// the editor.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { draw } from '../src/d2.js';
import { parse, serialize, keys, SHAPES } from '../src/blocks.js';
import { FAMILY, LOOK_3D, PALETTE, familyOf, bodyFor, resolvedType } from '../src/models.js';
import { topology } from '../src/3d/layout.js';
import { toMermaid, mermaidToD2 } from '../src/mermaid.js';
import { DEFAULTS, THEMES, DARK_THEMES, LAYOUTS } from '../src/settings.js';
import { EXAMPLE_DEFINITIONS } from '../src/examples/catalog.js';
import { encode, EDITOR } from '../src/share.js';
import en from '../src/i18n/en.js';

export { THEMES, DARK_THEMES, LAYOUTS };

export { EDITOR };

// The bundled server (scripts/build-mcp.mjs) ships the .d2 files beside itself;
// run from the repo, they're in src/. Never a caller-supplied path.
const EXAMPLES = [new URL('./examples/', import.meta.url), new URL('../src/examples/', import.meta.url)]
  .find((dir) => existsSync(dir));

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

/**
 * draw(), retrying once with elk when dagre crashes — d2.js tags that, and elk
 * lays out the diagrams dagre chokes on (links between nested containers).
 * The result says which layout was used, so a link can carry it.
 */
async function drawAnyLayout(src, opts) {
  try {
    return { ...(await draw(src, opts)), layout: opts.layout ?? DEFAULTS.layout };
  } catch (e) {
    if (e?.code !== 'dagre-crash') throw e;
    return {
      ...(await draw(src, { ...opts, layout: 'elk' })),
      layout: 'elk',
      note: 'dagre crashed on this diagram, so it was laid out with elk; pass layout "elk" to open_in_editor too.',
    };
  }
}

/**
 * Past this an SVG goes to a file instead of the reply. d2 inlines its fonts
 * and CSS, so even 2 shapes are ~18 KB and 20 are ~46 KB; Claude Code cuts tool
 * output at 25k tokens (~85 KB) by default. ponytail: one client's default.
 */
export const MAX_INLINE_SVG = 80 * 1024;

/**
 * Compile and render d2 (always the flat, 2D look: 3D needs WebGL, so for 3D
 * use open_in_editor with look "3d"). Returns `{ svg }`, or with `out` writes
 * it there and returns `{ path }`; either way with boards, layout and size.
 */
export async function renderD2({ source, theme = DEFAULTS.theme, darkTheme = DEFAULTS.darkTheme, layout = DEFAULTS.layout, sketch = DEFAULTS.sketch, board = '', out }) {
  if (out != null && !/\.svg$/i.test(out)) throw new Error('out must be a path ending in .svg');
  let r;
  try {
    r = await drawAnyLayout(source, { layout, themeID: theme, darkThemeID: darkTheme, sketch, board });
  } catch (e) {
    throw new Error(d2Error(e));
  }
  const meta = { boards: r.boards.map((b) => b.path), board: r.board, layout: r.layout, bytes: r.svg.length, ...(r.note && { note: r.note }) };
  if (out != null) {
    const path = resolve(out);
    await writeFile(path, r.svg);
    return { ...meta, path };
  }
  if (r.svg.length > MAX_INLINE_SVG) {
    throw new Error(`The SVG is ${Math.round(r.svg.length / 1024)} KB, more than fits in a tool reply (${MAX_INLINE_SVG / 1024} KB). `
      + 'Pass out: "<file>.svg" to write it to disk, or use open_in_editor to view it.');
  }
  return { ...meta, svg: r.svg };
}

// ------------------------------------------------------------------- 3D cost

// Meshes per family, measured by building each body with a stub palette — the
// same builders the scene uses, so the numbers can't drift from what renders.
const stub = new THREE.MeshBasicMaterial();
const STUB = Object.fromEntries(PALETTE.map((k) => [k, k === 'rim' ? () => new THREE.Object3D() : () => stub]));
const meshes = (o) => { let n = 0; o.traverse((x) => { if (x.isMesh || x.isLineSegments) n += 1; }); return n; };
const familyCost = new Map();
const costOf = (type) => {
  const family = familyOf(type);
  if (!familyCost.has(family)) familyCost.set(family, meshes(bodyFor({ type, width: 120, height: 80 }, STUB)));
  return familyCost.get(family);
};
const PANELS = new Set(['sql_table', 'class', 'code']);
const ARROW_MESHES = 5; // plate, socket, collar, two lit inserts (3d/cables.js physicalArrow)

/**
 * ponytail: rough budget for a smooth orbit on an integrated GPU, and the point
 * where a 3D scene stops reading at a glance. Past either, split into layers.
 */
export const BUDGET_3D = { shapes: 40, drawCalls: 1500 };

/**
 * What the 3D view will build for a compiled diagram: draw calls (one per
 * mesh, plus one per label), and advice for keeping it readable. Flat view
 * draws every shape as a single SVG element; 3D builds 3–50 meshes per shape.
 */
function estimate3d(diagram, src) {
  const source = new Map(keys(parse(src)).map(({ key, shape, md }) => [key, { shape, md }]));
  const shapes = diagram.shapes ?? [];
  const { isContainer } = topology(shapes);
  let drawCalls = 0;
  let plain = 0;
  let depth = 0;
  const advice = [];
  for (const s of shapes) {
    const type = resolvedType(s.type, source.get(s.id));
    if (s.label) drawCalls += 1;
    depth = Math.max(depth, s.level ?? 1);
    if (isContainer(s.id)) drawCalls += 2;
    else if (PANELS.has(s.type) || s.language === 'latex') drawCalls += 2;
    else if (s.type === 'text' || s.type === 'image') drawCalls += 1;
    else {
      drawCalls += costOf(type);
      if (!type || type === 'rectangle') plain += 1;
    }
  }
  for (const c of diagram.connections ?? []) {
    const heads = [c.srcArrow, c.dstArrow].filter((a) => a && a !== 'none').length;
    drawCalls += 2 + heads * ARROW_MESHES + (c.label ? 1 : 0);
  }
  const solids = shapes.filter((s) => !isContainer(s.id)).length;
  if (solids > BUDGET_3D.shapes) advice.push(`${solids} objects is a lot to read in 3D (aim for ≤ ${BUDGET_3D.shapes}); split detail into layers, or use the flat view.`);
  if (drawCalls > BUDGET_3D.drawCalls) advice.push(`~${drawCalls} draw calls may orbit slowly on a laptop GPU (budget ~${BUDGET_3D.drawCalls}); fewer shapes or connections, or the flat view.`);
  if (plain > solids / 2 && solids > 2) advice.push(`${plain} of ${solids} shapes have no shape role, so they render as generic blocks; in 3D a role (cylinder → server cabinet, person → figure…) is what makes them readable. See the shapes tool.`);
  if (depth > 3) advice.push(`Nesting ${depth} levels deep stacks platforms on platforms; flatten to 2–3 levels for 3D.`);
  if (shapes.some((s) => s.icon)) advice.push('Icons show in 3D only if their host sends CORS headers; others are left out.');
  if (shapes.some((s) => source.get(s.id)?.md)) advice.push('Markdown labels show their first line in 3D, with the rest behind a click.');
  return { objects: solids, containers: shapes.length - solids, drawCalls, advice };
}

/** The d2 shapes, with the role the editor names them by and what each becomes in 3D. */
export function shapes() {
  return SHAPES.map((shape) => ({
    shape: shape || '(none)',
    role: en.ui[`shape.${shape || 'default'}`],
    model3d: LOOK_3D[FAMILY[shape]],
    meshes3d: costOf(shape),
  }));
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
export async function checkD2({ source, look }) {
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
    const r = await drawAnyLayout(src, {});
    result.layout = r.layout;
    if (r.note) result.note = r.note;
    result.shapes = r.diagram.shapes?.length ?? 0;
    result.connections = r.diagram.connections?.length ?? 0;
    result.boards = r.boards.map((b) => b.path);
    if (look === '3d') result.threeD = estimate3d(r.diagram, src);
    if (reprinted !== src) {
      const again = await draw(reprinted, { layout: r.layout }).catch(() => null);
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
  const source = await readFile(new URL(`${def.id}.d2`, EXAMPLES), 'utf8');
  return { ...summarize(def), source };
}

/**
 * A link that opens `source` in the hosted editor (or `base`, e.g. a dev
 * server), in the `look` ("3d" or "flat") and `layout` given; without them the
 * reader's own last choice applies.
 */
export async function openInEditor({ source, base = EDITOR, look, layout }) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('base must be https, or a localhost dev server');
  }
  return `${url.origin}${url.pathname}${await encode(withNewline(source), { look, layout })}`;
}

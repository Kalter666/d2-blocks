// The block tree is the source of truth. `serialize` turns it into d2, `parse`
// turns d2 back into blocks. Anything parse doesn't recognise becomes a `raw`
// block holding the line verbatim, so nothing is ever silently destroyed.
//
// Guarantees, in order of how much they matter:
//   1. parse(serialize(tree))       deep-equals tree        (always)
//   2. serialize(parse(src)) === src                        (for src we emitted)
//   3. lines parse didn't understand survive byte-for-byte  (always)

export const ARROWS = ['->', '<-', '--', '<->'];

/**
 * d2's shapes, labelled by what people actually draw with them — nobody picks
 * `stored_data` on purpose, they're looking for a disk. The value is still d2's
 * name, so the source pane and every round-trip are unaffected; only the word in
 * the dropdown changes. Common roles first, geometry-for-its-own-sake last.
 *
 * All 18 stay listed even where the role is thin (square, circle): dropping one
 * would leave the select blank for a pasted file that uses it.
 */
export const SHAPES = [
  ['', 'Box (default)'],
  ['rectangle', 'Service'],
  ['cylinder', 'Database'],
  ['queue', 'Queue / stream'],
  ['stored_data', 'Storage / volume'],
  ['person', 'User / actor'],
  ['cloud', 'Cloud / external'],
  ['package', 'Package / module'],
  ['hexagon', 'Gateway / hub'],
  ['diamond', 'Decision'],
  ['step', 'Process step'],
  ['oval', 'Start / end'],
  ['circle', 'State'],
  ['document', 'Document / file'],
  ['page', 'Page / screen'],
  ['parallelogram', 'Input / output'],
  ['callout', 'Note / callout'],
  ['square', 'Component (square)'],
];
/**
 * Every style property d2 accepts, with the editor it needs and a default that
 * actually validates. Ranges are d2's own (`d2graph.go`), not guesses — feeding
 * a colour to `stroke-dash` is a compile error, so the picker has to change
 * with the property rather than always offering a swatch.
 */
export const STYLE_PROPS = {
  fill: { kind: 'color', value: '#c9d6ff' },
  stroke: { kind: 'color', value: '#3a5bd9' },
  'font-color': { kind: 'color', value: '#0f172a' },
  'stroke-width': { kind: 'number', value: '2', min: 0, max: 15, step: 1 },
  'stroke-dash': { kind: 'number', value: '3', min: 0, max: 10, step: 1 },
  // d2 only requires >= 0 here, so no max: inventing one blocks valid values.
  'border-radius': { kind: 'number', value: '8', min: 0, max: null, step: 1 },
  opacity: { kind: 'number', value: '0.8', min: 0, max: 1, step: 0.1 },
  'font-size': { kind: 'number', value: '16', min: 8, max: 100, step: 1 },
  'fill-pattern': { kind: 'enum', value: 'dots', options: ['none', 'dots', 'lines', 'grain', 'paper'] },
  'text-transform': { kind: 'enum', value: 'uppercase', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  bold: { kind: 'bool', value: 'true' },
  italic: { kind: 'bool', value: 'true' },
  underline: { kind: 'bool', value: 'true' },
  shadow: { kind: 'bool', value: 'true' },
  '3d': { kind: 'bool', value: 'true' },
  multiple: { kind: 'bool', value: 'true' },
  'double-border': { kind: 'bool', value: 'true' },
  filled: { kind: 'bool', value: 'true' },
  animated: { kind: 'bool', value: 'true' },
};

/** A value that validates for `prop` — used when a style block switches property. */
export const defaultStyle = (prop) => STYLE_PROPS[prop]?.value ?? '';
export const DIRECTIONS = ['up', 'down', 'right', 'left'];

export const empty = () => [{ type: 'direction', value: 'right' }];

// ---------------------------------------------------------------- serialize

// ponytail: names are quoted unless they're plainly safe. Over-quoting is
// harmless in d2; under-quoting silently changes the diagram (a `.` nests, a
// `->` connects), so the regex errs toward quoting.
const SAFE_NAME = /^[A-Za-z_][\w -]*$/;
const q = (s) => (SAFE_NAME.test(s) && !/-[->]/.test(s) ? s : JSON.stringify(s));

/** A name as it appears in a d2 key — what links and styles must reference. */
export { q as safeKey };

// Labels are freer than names, but `#` opens a comment and braces open a map.
const qLabel = (s) => (/[#{}|;\n]/.test(s) || s !== s.trim() ? JSON.stringify(s) : s);

/**
 * Blocks store root-qualified keys (that's what the dropdowns offer and what the
 * canvas matches on), but d2 resolves a key against the map it is written in. A
 * link inside `AUTH` that says `AUTH.db` means `AUTH.AUTH.db` — a phantom group.
 * So rewrite the key relative to the scope it's being emitted into, using d2's
 * `_` parent reference to climb back out when the target lives elsewhere.
 */
export function relativize(key, scope) {
  for (let i = scope.length; i > 0; i--) {
    const prefix = scope.slice(0, i).join('.');
    if (key.startsWith(`${prefix}.`)) return '_.'.repeat(scope.length - i) + key.slice(prefix.length + 1);
  }
  return '_.'.repeat(scope.length) + key;
}

/** The inverse: what a scoped key in the source refers to from the root. */
export function absolutize(key, scope) {
  const path = [...scope];
  let rest = key;
  while (rest.startsWith('_.')) { path.pop(); rest = rest.slice(2); }
  return [...path, rest].join('.');
}

/**
 * d2 ends a block string at the first occurrence of its fence *anywhere* on a
 * line, so content holding a `|` needs a wider one — `a: |md\n  x | y\n|` is a
 * compile error, `||md … ||` is not.
 */
const fenceFor = (text) => '|'.repeat(1 + Math.max(0, ...[...text.matchAll(/\|+/g)].map((m) => m[0].length)));

// Blank lines stay empty rather than padded: trailing whitespace would survive
// serialize but not parse, breaking the byte round-trip.
const indent = (text, pad) => text.split('\n').map((l) => (l.trim() ? pad + l : '')).join('\n');

/**
 * A box or connection whose label is markdown. Without a shape that's the short
 * form a person would write by hand; with one it has to be a map, since
 * `{shape: x}` and a block string can't share a line.
 */
function mdBlock(b, pad, scope) {
  const fence = fenceFor(b.label);
  if (b.type === 'link') {
    const conn = `${relativize(b.src, scope)} ${b.arrow} ${relativize(b.dst, scope)}`;
    return `${pad}${conn}: ${fence}md\n${indent(b.label, `${pad}  `)}\n${pad}${fence}`;
  }
  if (!b.shape) {
    return `${pad}${q(b.name)}: ${fence}md\n${indent(b.label, `${pad}  `)}\n${pad}${fence}`;
  }
  return [
    `${pad}${q(b.name)}: {`,
    `${pad}  label: ${fence}md`,
    indent(b.label, `${pad}    `),
    `${pad}  ${fence}`,
    `${pad}  shape: ${b.shape}`,
    `${pad}}`,
  ].join('\n');
}

function line(b, scope) {
  switch (b.type) {
    case 'direction':
      return `direction: ${b.value}`;
    case 'box': {
      const head = b.label ? `${q(b.name)}: ${qLabel(b.label)}` : q(b.name);
      return b.shape
        ? `${head}${b.label ? ' ' : ': '}{shape: ${b.shape}}`
        : head;
    }
    case 'link': {
      const conn = `${relativize(b.src, scope)} ${b.arrow} ${relativize(b.dst, scope)}`;
      return b.label ? `${conn}: ${qLabel(b.label)}` : conn;
    }
    case 'style':
      return `${relativize(b.target, scope)}.style.${b.prop}: ${qLabel(b.value)}`;
    default:
      return '';
  }
}

export function serialize(blocks, depth = 0, scope = []) {
  const pad = '  '.repeat(depth);
  const out = [];
  for (const b of blocks) {
    if (b.type === 'raw') {
      out.push(b.text); // verbatim, including its original indentation
    } else if (b.type === 'group') {
      // `name: {` unlabelled, `name: Label {` labelled — a second colon before
      // the brace gets swallowed into the label ("Label:").
      const head = b.label ? `${q(b.name)}: ${qLabel(b.label)} ` : `${q(b.name)}: `;
      out.push(`${pad}${head}{`);
      if (b.children.length) out.push(serialize(b.children, depth + 1, [...scope, q(b.name)]));
      out.push(`${pad}}`);
    } else if ((b.type === 'box' || b.type === 'link') && b.md && b.label.trim()) {
      out.push(mdBlock(b, pad, scope));
    } else {
      // ponytail: an empty rich box degrades to a plain one — d2 rejects an
      // empty block string, and emitting d2 that won't compile is worse than
      // losing a toggle the user hasn't typed into yet.
      out.push(pad + line(b, scope));
    }
  }
  return out.join('\n');
}

// -------------------------------------------------------------------- parse

// ponytail: a line scanner, not a d2 parser. Exact on what we emit, verbatim
// fallback on everything else. compile() returns graph.ast (a real d2ast.Map
// with source ranges) — switch to walking that if foreign-file fidelity matters.

const unq = (s) => {
  const t = s.trim();
  if ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) {
    try { return JSON.parse(t[0] === '"' ? t : `"${t.slice(1, -1)}"`); } catch { /* fall through */ }
  }
  return t;
};

const RE = {
  quoted: /^("(?:[^"\\]|\\.)*"|'[^']*')$/,
  group: /^(.+?):\s*(.*?)\s*\{$/,
  boxShape: /^(.+?):\s*(?:(.*?)\s+)?\{\s*shape:\s*(\w+)\s*\}$/,
  link: /^(.+?)\s+(->|<-|--|<->)\s+(.+?)(?::\s*(.*))?$/,
  style: /^(.+)\.style\.([\w-]+):\s*(.*)$/,
  direction: /^direction:\s*(up|down|left|right)$/,
  labelled: /^([^:{}]+?):\s*([^{}]*)$/,
  bare: /^[A-Za-z_][\w -]*$/,
  // A block string opener: `key: |md`, `key: ||latex`, `key: |`. The tag decides
  // whether we can model it; the fence has to be captured either way so the body
  // gets consumed rather than scanned.
  blockOpen: /^(.+?):\s*(\|+)(\w*)\s*$/,
  mdLabel: /^label:\s*(\|+)md\s*$/,
  shapeOnly: /^shape:\s*(\w+)$/,
  // d2's own keywords. As a line on their own they set something on the
  // enclosing map, so they are never boxes; as a map they hold definitions or
  // whole other boards, never children.
  keyword: /^(?:label|shape|icon|width|height|constraint|tooltip|link|near|class|top|left|filled|grid-[\w-]+|vertical-gap|horizontal-gap|(?:source|target)-arrowhead|style)(?:\.[\w-]+)*\s*:/,
  defs: /^(?:classes|vars|layers|scenarios|steps)\s*:\s*\{$/,
};

/** Consume a block string opened at `lines[i]`. Null if it never closes. */
function takeBlock(lines, i, fence) {
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === fence) return { text: dedent(lines.slice(i + 1, j)), next: j + 1 };
  }
  return null;
}

/** Strip the common leading whitespace, which is what d2 itself does. */
function dedent(lines) {
  const filled = lines.filter((l) => l.trim());
  const n = Math.min(Infinity, ...filled.map((l) => l.length - l.trimStart().length));
  return lines.map((l) => (l.trim() ? l.slice(n) : '')).join('\n');
}

/**
 * `name: { label: |md … | shape: x }` — the only way to have markdown *and* a
 * shape. Recognised as one box rather than a group, so it round-trips.
 */
function takeMdMap(lines, i, g) {
  if (g[2]) return null; // the map head already carries a plain label
  const open = RE.mdLabel.exec((lines[i + 1] ?? '').trim());
  if (!open) return null;
  const body = takeBlock(lines, i + 1, open[1]);
  if (!body) return null;

  let j = body.next;
  const s = RE.shapeOnly.exec((lines[j] ?? '').trim());
  if (s) j++;
  if ((lines[j] ?? '').trim() !== '}') return null;

  return {
    block: { type: 'box', name: unq(g[1]), label: body.text, shape: s ? s[1] : '', md: true },
    next: j + 1,
  };
}

function parseLine(text, scope) {
  const t = text.trim();
  if (!t) return null;

  let m;
  // A fully quoted line is a name we quoted precisely so it wouldn't be read as
  // a connection or a path — so it has to be checked before either of those.
  if (RE.quoted.test(t)) return { type: 'box', name: unq(t), label: '', shape: '' };
  if ((m = RE.direction.exec(t))) return { type: 'direction', value: m[1] };
  if (RE.keyword.test(t)) return null;
  if ((m = RE.boxShape.exec(t))) {
    return { type: 'box', name: unq(m[1]), label: m[2] ? unq(m[2]) : '', shape: m[3] };
  }
  // Any other brace is an inline map (`a: { b; c }`), which none of the patterns
  // below understand — `x: { y.style.fill: red }` reads as a style on `x: { y`.
  if (/[{}]/.test(t)) return null;
  if ((m = RE.style.exec(t))) {
    return { type: 'style', target: absolutize(m[1], scope), prop: m[2], value: unq(m[3]) };
  }
  // A link's src/dst are keys, not free text — bail out if they look like prose.
  if ((m = RE.link.exec(t)) && !m[1].includes(':')) {
    return {
      type: 'link',
      src: absolutize(m[1].trim(), scope),
      arrow: m[2],
      dst: absolutize(m[3].trim(), scope),
      label: m[4] ? unq(m[4]) : '',
    };
  }
  if ((m = RE.labelled.exec(t))) return { type: 'box', name: unq(m[1]), label: unq(m[2]), shape: '' };
  if (RE.bare.test(t)) return { type: 'box', name: t, label: '', shape: '' };
  return null;
}

/** The line that closes the map opened at `lines[i]`. ponytail: counts braces, blind to ones in quotes. */
function closing(lines, i) {
  let depth = 0;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    if (depth === 0) return j;
  }
  return null;
}

/** A table or class: its body is columns and members (`+id: int`), not boxes. */
function isRecord(lines, i) {
  let depth = 0;
  for (let j = i + 1; j < lines.length && depth >= 0; j++) {
    if (depth === 0 && /^\s*shape:\s*(sql_table|class)\s*$/.test(lines[j])) return true;
    for (const ch of lines[j]) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  }
  return false;
}

export function parse(src) {
  const lines = src.split('\n');
  if (lines.at(-1) === '') lines.pop(); // trailing newline is not a blank line
  const root = [];
  const stack = [root];
  const scope = []; // enclosing group keys, to resolve links back to root keys
  const top = () => stack.at(-1);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const t = text.trim();
    const raw = { type: 'raw', text };

    // A block string swallows whole lines, braces included, so it has to be
    // consumed before the brace scanner ever sees its body.
    const open = RE.blockOpen.exec(t);
    if (open) {
      const body = takeBlock(lines, i, open[2]);
      if (body) {
        // The part before the fence is an ordinary head — `Notes`, `"a.b"`,
        // `a -> b` — so let parseLine identify it and just swap in the label.
        const head = open[3] === 'md' && open[1].trim() !== 'label' ? parseLine(open[1], scope) : null;
        top().push(head && (head.type === 'box' || head.type === 'link')
          ? { ...head, label: body.text, md: true }
          // |latex, |code, or markdown somewhere we can't put an editor: keep
          // every line verbatim in one raw block rather than letting the body
          // loose on the scanner.
          : { type: 'raw', text: lines.slice(i, body.next).join('\n') });
        i = body.next - 1;
        continue;
      }
    }

    if (t === '}' && stack.length > 1) { stack.pop(); scope.pop(); continue; }

    // Ends in `{`, so an inline map (`x: {shape: y}`) can't reach here. A
    // connection with a map body isn't something we emit — leave it to raw.
    const g = RE.group.exec(t);
    // A connection with a map body (arrowheads, per-link styles), classes, vars,
    // boards, tables and UML classes aren't something we emit, so the whole body goes to one raw block — line by line it would be
    // read as a label of "{" and a run of stray boxes.
    if (g && (/(->|<-|--|<->)/.test(g[1]) || RE.defs.test(t) || RE.keyword.test(t) || isRecord(lines, i))) {
      const end = closing(lines, i);
      if (end != null) {
        top().push({ type: 'raw', text: lines.slice(i, end + 1).join('\n') });
        i = end;
        continue;
      }
    }
    if (g && !/(->|<-|--|<->)/.test(g[1])) {
      const md = takeMdMap(lines, i, g);
      if (md) { top().push(md.block); i = md.next - 1; continue; }

      const group = { type: 'group', name: unq(g[1]), label: g[2] ? unq(g[2]) : '', children: [] };
      top().push(group);
      stack.push(group.children);
      scope.push(q(group.name));
      continue;
    }

    top().push(parseLine(text, scope) ?? raw);
  }

  // Unbalanced braces mean the scanner lost the plot. Refuse to guess: hand the
  // whole file back as one raw block so the caller can fall back to code-only.
  if (stack.length !== 1) return [{ type: 'raw', text: src.replace(/\n$/, '') }];
  return root;
}

// `Backend: My Backend` -> ['Backend', 'My Backend']; `Backend` -> ['Backend', '']
function splitLabel(head) {
  const i = head.indexOf(':');
  return i === -1 ? [head, ''] : [head.slice(0, i).trim(), head.slice(i + 1).trim()];
}

// ------------------------------------------------------------------ helpers

/**
 * Fully-qualified keys of every box and group, for the dropdowns.
 * Quoted the same way serialize quotes them — a box called `a.b` is the key
 * `"a.b"`, and feeding the bare name to a link would nest instead of connect.
 * Returns the source shape too: d2 normalises some compiled types (`circle`
 * becomes `oval`), while the 3D renderer must preserve the role the user chose.
 */
export function keys(blocks, prefix = '', depth = 0) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'box' && b.type !== 'group') continue;
    const key = prefix + q(b.name);
    out.push({
      key, name: b.name, depth,
      shape: b.type === 'box' ? b.shape : undefined,
      md: b.type === 'box' ? !!b.md : undefined,
    });
    if (b.type === 'group') out.push(...keys(b.children, `${key}.`, depth + 1));
  }
  return out;
}

/** Depth-first walk, so the UI can find and mutate a block by identity. */
export function remove(blocks, target) {
  const i = blocks.indexOf(target);
  if (i !== -1) return blocks.splice(i, 1), true;
  return blocks.some((b) => b.type === 'group' && remove(b.children, target));
}

/** The list a block currently sits in, or null. */
export function parentOf(blocks, target) {
  if (blocks.includes(target)) return blocks;
  for (const b of blocks) {
    if (b.type !== 'group') continue;
    const found = parentOf(b.children, target);
    if (found) return found;
  }
  return null;
}

/** Would moving `block` into `list` put it inside itself? */
export function wouldNest(block, list) {
  if (block.type !== 'group') return false;
  return block.children === list || block.children.some((c) => wouldNest(c, list));
}

/**
 * Move `block` to position `index` of `list`. Returns false if the drop is a
 * no-op or would nest a group inside itself.
 *
 * The index is measured against the list as the user sees it, i.e. with the
 * dragged block still in place. Removing it first shifts everything after it
 * down by one, so a same-list move to a later slot has to compensate.
 */
/**
 * Does `list` already hold a box or group whose d2 key matches `name`?
 * d2 merges repeated keys into one shape, so two boxes called `auth` in the
 * same scope become one — silently, and with both sets of edges attached.
 * Compared by key rather than raw name because the key is what d2 actually
 * resolves. (`q` happens to be injective, so today the two agree — but the key
 * is the thing that has to be unique, so that's what this checks.)
 */
export function collides(list, name, ignore) {
  const key = q(name);
  return list.some((b) => b !== ignore && (b.type === 'box' || b.type === 'group') && q(b.name) === key);
}

/** Can `block` be dropped into `list` at all? Same checks moveInto enforces. */
export function canMoveInto(block, list) {
  if (wouldNest(block, list)) return false;
  const named = block.type === 'box' || block.type === 'group';
  return !(named && collides(list, block.name, block));
}

export function moveInto(blocks, block, list, index) {
  if (!canMoveInto(block, list)) return false;
  const from = parentOf(blocks, block);
  if (!from) return false;
  const shift = from === list && from.indexOf(block) < index ? 1 : 0;
  const to = Math.max(0, Math.min(index - shift, list.length - shift));
  if (from === list && to === from.indexOf(block)) return false;

  // Dragging across groups renames the block just as surely as typing does —
  // `svc` inside AUTH is the key `AUTH.svc` — so references have to follow.
  const was = keyOf(blocks, block);
  remove(blocks, block);
  list.splice(to, 0, block);
  const now = keyOf(blocks, block);
  if (was && now) renameKey(blocks, was, now);
  return true;
}

/** The fully-qualified key a box or group currently has, or null. */
export function keyOf(blocks, target, prefix = '') {
  for (const b of blocks) {
    if (b.type !== 'box' && b.type !== 'group') continue;
    const key = prefix + q(b.name);
    if (b === target) return key;
    if (b.type === 'group') {
      const found = keyOf(b.children, target, `${key}.`);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Repoint every connect and style block from `from` to `to`. Renaming a group
 * has to carry its whole subtree, hence the prefix case: renaming `AUTH` to
 * `Auth` must turn `AUTH.db` into `Auth.db`, not leave a dangling key that d2
 * would happily materialise as a new empty box.
 */
export function renameKey(blocks, from, to) {
  if (!from || from === to) return false;
  let changed = false;
  const swap = (k) => {
    if (k === from) { changed = true; return to; }
    if (k.startsWith(`${from}.`)) { changed = true; return to + k.slice(from.length); }
    return k;
  };
  (function walk(list) {
    for (const b of list) {
      if (b.type === 'link') { b.src = swap(b.src); b.dst = swap(b.dst); }
      else if (b.type === 'style') b.target = swap(b.target);
      else if (b.type === 'group') walk(b.children);
    }
  })(blocks);
  return changed;
}

/** Nudge a block up or down within its own list — the keyboard route to drag. */
export function reorderIn(blocks, block, delta) {
  const list = parentOf(blocks, block);
  if (!list) return false;
  const i = list.indexOf(block);
  const to = i + delta;
  if (to < 0 || to >= list.length) return false;
  list.splice(to, 0, ...list.splice(i, 1));
  return true;
}

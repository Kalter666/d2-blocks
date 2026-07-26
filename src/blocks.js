// The block tree is the source of truth. `serialize` turns it into d2, `parse`
// turns d2 back into blocks. Anything parse doesn't recognise becomes a `raw`
// block holding the line verbatim, so nothing is ever silently destroyed.
//
// Guarantees, in order of how much they matter:
//   1. parse(serialize(tree))       deep-equals tree        (always)
//   2. serialize(parse(src)) === src                        (for src we emitted)
//   3. lines parse didn't understand survive byte-for-byte  (always)

export const ARROWS = ['->', '<-', '--', '<->'];
export const SHAPES = [
  '', 'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder',
  'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond',
  'oval', 'circle', 'hexagon', 'cloud',
];
export const STYLE_PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-dash', 'border-radius', 'opacity',
  'font-size', 'font-color', 'bold', 'italic', 'shadow', '3d', 'multiple',
];
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

function line(b, scope) {
  switch (b.type) {
    case 'direction':
      return `direction: ${b.value}`;
    case 'box': {
      const head = b.label ? `${q(b.name)}: ${qLabel(b.label)}` : q(b.name);
      return b.shape ? `${head}${b.label ? ' ' : ': '}{shape: ${b.shape}}` : head;
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
    } else {
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
};

function parseLine(text, scope) {
  const t = text.trim();
  if (!t) return null;

  let m;
  // A fully quoted line is a name we quoted precisely so it wouldn't be read as
  // a connection or a path — so it has to be checked before either of those.
  if (RE.quoted.test(t)) return { type: 'box', name: unq(t), label: '', shape: '' };
  if ((m = RE.direction.exec(t))) return { type: 'direction', value: m[1] };
  if ((m = RE.style.exec(t))) {
    return { type: 'style', target: absolutize(m[1], scope), prop: m[2], value: unq(m[3]) };
  }
  if ((m = RE.boxShape.exec(t))) {
    return { type: 'box', name: unq(m[1]), label: m[2] ? unq(m[2]) : '', shape: m[3] };
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

export function parse(src) {
  const lines = src.split('\n');
  if (lines.at(-1) === '') lines.pop(); // trailing newline is not a blank line
  const root = [];
  const stack = [root];
  const scope = []; // enclosing group keys, to resolve links back to root keys
  const top = () => stack.at(-1);

  for (const text of lines) {
    const t = text.trim();
    const raw = { type: 'raw', text };

    if (t === '}' && stack.length > 1) { stack.pop(); scope.pop(); continue; }

    // Ends in `{`, so an inline map (`x: {shape: y}`) can't reach here. A
    // connection with a map body isn't something we emit — leave it to raw.
    const g = RE.group.exec(t);
    if (g && !/(->|<-|--|<->)/.test(g[1])) {
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
 * Returns { key, name, depth } so the UI can show the friendly name.
 */
export function keys(blocks, prefix = '', depth = 0) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'box' && b.type !== 'group') continue;
    const key = prefix + q(b.name);
    out.push({ key, name: b.name, depth });
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

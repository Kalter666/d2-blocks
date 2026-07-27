// A bridge between mermaid flowcharts and the block tree (see blocks.js). d2 is
// far richer than mermaid, so this is import/export only, not an editor mode.
//
// It is best-effort, not a round-trip guarantee like blocks.js: mermaid and d2
// aren't the same language. What crosses cleanly and what is dropped is spelled
// out in the README-worthy notes below and in the plan. In particular the block
// model has no per-edge style, so mermaid's dotted/thick edge *lines* collapse
// to plain edges, and import can't use the `raw` escape hatch (a raw mermaid
// line would serialise to invalid d2), so unrecognised lines are dropped.

import { serialize, safeKey } from './blocks.js';

const D2_TO_MM_DIR = { down: 'TD', up: 'BT', right: 'LR', left: 'RL' };
const MM_TO_D2_DIR = { TD: 'down', TB: 'down', BT: 'up', LR: 'right', RL: 'left' };

// d2 shape -> the mermaid bracket that draws it. Anything not here falls back to
// a plain `[rectangle]` node — mermaid simply has fewer shapes than d2.
const SHAPE_BRACKETS = {
  cylinder: ['[(', ')]'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  oval: ['([', '])'],
  circle: ['((', '))'],
  parallelogram: ['[/', '/]'],
};
// Longest-first so `[(` wins over `[` and `([` over `(`.
const BRACKET_SHAPES = [
  ['[(', ')]', 'cylinder'],
  ['([', '])', 'oval'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['{', '}', 'diamond'],
  ['[', ']', ''],
  ['(', ')', ''], // rounded — no distinct d2 shape
];

const D2_ARROW_TO_MM = { '->': '-->', '--': '---', '<->': '<-->' };
const MM_STYLE_FROM_D2 = { fill: 'fill', stroke: 'stroke', 'stroke-width': 'stroke-width', opacity: 'opacity' };
const MM_STYLE_TO_D2 = {
  fill: 'fill', stroke: 'stroke', 'stroke-width': 'stroke-width',
  color: 'font-color', opacity: 'opacity', 'stroke-dasharray': 'stroke-dash',
};

// Mermaid node text can hold specials if quoted; quote when it would otherwise
// be read as a bracket, a pipe, or markup.
const escapeLabel = (s) =>
  /[[\]{}()|<>"#]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '&quot;')}"` : s;

const unquote = (s) => {
  let t = s.trim();
  if ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")) t = t.slice(1, -1);
  return t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<br\s*\/?>/gi, '\n');
};

// ------------------------------------------------------------------- export

export function toMermaid(blocks) {
  const dir = D2_TO_MM_DIR[blocks.find((b) => b.type === 'direction')?.value] ?? 'TD';
  const idMap = new Map(); // d2 key -> mermaid id (stable so edges/styles line up)
  const used = new Set();
  const mmId = (key) => {
    if (idMap.has(key)) return idMap.get(key);
    let base = key.replace(/[^A-Za-z0-9_]/g, '_') || 'n';
    if (/^[0-9]/.test(base)) base = `n${base}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    idMap.set(key, id);
    return id;
  };

  const node = (id, b) => {
    const [o, c] = SHAPE_BRACKETS[b.shape] ?? ['[', ']'];
    return `${id}${o}${escapeLabel(b.label || b.name)}${c}`;
  };
  const edge = (b) => {
    const s = mmId(b.src), d = mmId(b.dst);
    // d2 `<-` is arrow-from-dst; emit it reversed rather than lean on `<--`.
    if (b.arrow === '<-') return b.label ? `${d} -->|${escapeLabel(b.label)}| ${s}` : `${d} --> ${s}`;
    const op = D2_ARROW_TO_MM[b.arrow] ?? '-->';
    return b.label ? `${s} ${op}|${escapeLabel(b.label)}| ${d}` : `${s} ${op} ${d}`;
  };

  const lines = [`flowchart ${dir}`];
  const styleMap = new Map(); // d2 key -> { prop: value }

  const walk = (list, prefix, depth) => {
    const pad = '  '.repeat(depth + 1);
    for (const b of list) {
      if (b.type === 'box') {
        lines.push(pad + node(mmId(prefix + safeKey(b.name)), b));
      } else if (b.type === 'group') {
        const key = prefix + safeKey(b.name);
        lines.push(`${pad}subgraph ${mmId(key)}${b.label ? ` [${escapeLabel(b.label)}]` : ''}`);
        walk(b.children, `${key}.`, depth + 1);
        lines.push(`${pad}end`);
      } else if (b.type === 'link') {
        lines.push(pad + edge(b));
      } else if (b.type === 'style' && MM_STYLE_FROM_D2[b.prop]) {
        const m = styleMap.get(b.target) ?? styleMap.set(b.target, {}).get(b.target);
        m[b.prop] = b.value;
      }
    }
  };
  walk(blocks, '', 0);

  for (const [key, props] of styleMap) {
    const decls = Object.entries(props).map(([p, v]) => (p === 'stroke-width' ? `stroke-width:${v}px` : `${p}:${v}`));
    lines.push(`  style ${mmId(key)} ${decls.join(',')}`);
  }
  return `${lines.join('\n')}\n`;
}

// ------------------------------------------------------------------- import

// A node token: id plus an optional shape bracket. Longest bracket forms first.
const NODE_RE = /^([A-Za-z0-9_]+)(\[\(.*?\)\]|\(\(.*?\)\)|\(\[.*?\]\)|\[\/.*?\/\]|\{\{.*?\}\}|\{.*?\}|\[.*?\]|\(.*?\))?/;
const EDGE_RE = /^(<-->|<--|-->|---|-\.->|-\.-|===|==>|--)(?:\s*\|([^|]*)\|)?/;
// [d2 arrow, reverse src/dst?]. Dotted/thick collapse to plain — no edge style.
const ARROW_MAP = {
  '-->': ['->', false], '---': ['--', false], '<-->': ['<->', false], '<--': ['->', true],
  '-.->': ['->', false], '-.-': ['--', false], '==>': ['->', false], '===': ['--', false], '--': ['--', false],
};

function shapeOf(bracket) {
  if (!bracket) return { shape: '', label: null };
  for (const [o, c, shape] of BRACKET_SHAPES) {
    if (bracket.startsWith(o) && bracket.endsWith(c) && bracket.length >= o.length + c.length) {
      return { shape, label: unquote(bracket.slice(o.length, bracket.length - c.length)) };
    }
  }
  return { shape: '', label: null };
}

// One statement: nodes (possibly chained by edges) on a single line.
function parseStatement(line) {
  // Fold mid-arrow labels ("A-- text -->B") into pipe form ("A-->|text|B").
  let s = line
    .replace(/(?:--|-\.|==)\s+([^|>]+?)\s+(-->|---|\.->|==>|===)/g,
      (_, label, tail) => `${tail === '.->' ? '-.->' : tail}|${label.trim()}|`)
    .trim();

  const nodes = [];
  const edges = [];
  let pending = null;
  let last = null;
  let m;
  while (s.length) {
    if ((m = NODE_RE.exec(s))) {
      const { shape, label } = shapeOf(m[2]);
      nodes.push({ id: m[1], shape, label });
      if (pending) {
        const [arrow, rev] = ARROW_MAP[pending.op] ?? ['->', false];
        edges.push({ srcId: last, dstId: m[1], arrow, rev, label: pending.label });
        pending = null;
      }
      last = m[1];
      s = s.slice(m[0].length).trimStart();
    } else if (last && (m = EDGE_RE.exec(s))) {
      pending = { op: m[1], label: m[2] ? unquote(m[2]) : '' };
      s = s.slice(m[0].length).trimStart();
    } else {
      break; // couldn't make sense of the rest — drop it
    }
  }
  return nodes.length ? { nodes, edges } : null;
}

function* parseDecls(text) {
  for (const part of text.split(',')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    const prop = MM_STYLE_TO_D2[part.slice(0, i).trim().toLowerCase()];
    if (!prop) continue;
    let v = part.slice(i + 1).trim();
    if (prop === 'stroke-width') v = v.replace(/px$/i, '').trim();
    if (prop === 'stroke-dash') v = v.match(/\d+/)?.[0] ?? '3';
    yield [prop, v];
  }
}

export function fromMermaid(text) {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && (!lines[start].trim() || lines[start].trim().startsWith('%%'))) start++;

  const header = (lines[start] ?? '').trim();
  const hm = /^(?:flowchart|graph)\s+([A-Za-z]{2})?/i.exec(header);
  if (!hm) {
    const kw = header.split(/[\s:]/)[0] || 'empty diagram';
    throw new Error(`Only mermaid flowcharts are supported (got: ${kw})`);
  }

  const root = [{ type: 'direction', value: MM_TO_D2_DIR[(hm[1] || 'TD').toUpperCase()] ?? 'down' }];
  const stack = [root]; // children lists, innermost last
  const scope = []; // group ids, for absolute keys
  const nodes = new Map(); // id -> { block, key }
  const groups = new Map(); // subgraph id -> key (a valid edge endpoint too)
  const links = [];
  const styleLines = []; // { id, decls }
  const classDefs = new Map();
  const classAssign = [];
  const used = new Set();

  const container = () => stack[stack.length - 1];
  const freeId = (base) => {
    let id = base;
    for (let i = 2; used.has(id) || nodes.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    return id;
  };
  const endpoint = (id) => nodes.get(id) ?? (groups.has(id) ? { key: groups.get(id) } : null);
  const ensureNode = (id, shape, label) => {
    if (groups.has(id)) return { key: groups.get(id) }; // an edge to/from a subgraph
    let rec = nodes.get(id);
    if (!rec) {
      const block = { type: 'box', name: id, label: label ?? '', shape: shape || '' };
      container().push(block);
      used.add(id);
      rec = { block, key: [...scope, id].join('.') };
      nodes.set(id, rec);
    } else {
      if (label != null && !rec.block.label) rec.block.label = label;
      if (shape && !rec.block.shape) rec.block.shape = shape;
    }
    return rec;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim().replace(/;+$/, '');
    if (!line || line.startsWith('%%')) continue;

    if (/^end$/i.test(line)) {
      if (stack.length > 1) { stack.pop(); scope.pop(); }
      continue;
    }
    let m;
    if ((m = /^subgraph\b\s*(.*)$/i.exec(line))) {
      const rest = m[1].trim();
      const titled = /^([A-Za-z0-9_]+)\s*\[(.*)\]$/.exec(rest);
      let id, label;
      if (titled) { id = titled[1]; label = unquote(titled[2]); used.add(id); }
      else if (/^[A-Za-z0-9_]+$/.test(rest)) { id = rest; label = ''; used.add(id); }
      else { label = unquote(rest); id = freeId('group'); }
      const group = { type: 'group', name: id, label, children: [] };
      groups.set(id, [...scope, id].join('.'));
      container().push(group);
      stack.push(group.children);
      scope.push(id);
      continue;
    }
    if ((m = /^direction\s+([A-Za-z]{2})$/i.exec(line))) {
      container().push({ type: 'direction', value: MM_TO_D2_DIR[m[1].toUpperCase()] ?? 'down' });
      continue;
    }
    if ((m = /^style\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line))) { styleLines.push({ id: m[1], decls: m[2] }); continue; }
    if ((m = /^classDef\s+([A-Za-z0-9_]+)\s+(.+)$/i.exec(line))) { classDefs.set(m[1], m[2]); continue; }
    if ((m = /^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z0-9_]+)$/i.exec(line))) {
      classAssign.push({ ids: m[1].split(',').map((x) => x.trim()).filter(Boolean), className: m[2] });
      continue;
    }
    if (/^(?:linkStyle|click)\b/i.test(line)) continue; // no home in the block model

    const parsed = parseStatement(line);
    if (!parsed) continue;
    for (const n of parsed.nodes) ensureNode(n.id, n.shape, n.label);
    for (const e of parsed.edges) {
      const s = endpoint(e.srcId), d = endpoint(e.dstId);
      if (!s || !d) continue;
      const [a, b] = e.rev ? [d, s] : [s, d];
      links.push({ type: 'link', src: a.key, arrow: e.arrow, dst: b.key, label: e.label });
    }
  }

  for (const l of links) root.push(l);
  for (const { ids, className } of classAssign) {
    const decls = classDefs.get(className);
    if (decls) for (const id of ids) styleLines.push({ id, decls });
  }
  for (const { id, decls } of styleLines) {
    const rec = nodes.get(id);
    if (!rec) continue;
    for (const [prop, value] of parseDecls(decls)) root.push({ type: 'style', target: rec.key, prop, value });
  }
  return root;
}

// A convenience for the preview: mermaid text -> d2 source, or throw.
export const mermaidToD2 = (text) => serialize(fromMermaid(text)) + '\n';

// Every piece of d2 syntax, pasted into the source pane. Each case must:
//   - compile without a d2 error,
//   - come back byte-for-byte after the editor parses and reprints it (the
//     lossless round-trip the README promises — unknown syntax becomes raw
//     blocks, never a mangled box),
//   - draw what it says in d2's own SVG,
//   - and build the 3D scene without throwing.
// Organised like the d2 tour (d2lang.com/tour), so a gap is easy to spot.
import { test, expect } from '@playwright/test';
import { open, source } from './helpers.js';

// A 1×1 PNG, so icon cases need no network and can't fail on CORS. Quoted: the
// `;` in a data URL would otherwise end the statement.
const PNG = '"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="';

const lines = (...l) => l.join('\n');

/** name → { src, texts?: strings the SVG must contain, boards?: picker options } */
const CASES = {
  // ------------------------------------------------------------------ shapes
  'shape declaration': { src: 'imAShape', texts: ['imAShape'] },
  'shape with label': { src: 'pg: PostgreSQL', texts: ['PostgreSQL'] },
  'several shapes on one line': { src: 'a; b; c', texts: ['a', 'b', 'c'] },
  'quoted key': { src: '"a key with: colon"', texts: ['a key with: colon'] },
  'unicode key and label': { src: 'café: Кофе ☕', texts: ['Кофе ☕'] },
  'label keyword': { src: lines('x: {', '  label: Hello', '}'), texts: ['Hello'] },
  'dimensions': { src: lines('x: {', '  width: 300', '  height: 120', '}'), texts: ['x'] },
  ...Object.fromEntries([
    'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder', 'queue',
    'package', 'step', 'callout', 'stored_data', 'person', 'diamond', 'oval',
    'circle', 'hexagon', 'cloud', 'c4-person',
  ].map((shape) => [`shape: ${shape}`, { src: `s: ${shape} {shape: ${shape}}`, texts: [shape] }])),
  'shape: text': { src: lines('t: some words {', '  shape: text', '}'), texts: ['some words'] },
  'shape: image': { src: lines('i: {', '  shape: image', `  icon: ${PNG}`, '}') },
  'icon': { src: lines('svc: Service {', `  icon: ${PNG}`, '}'), texts: ['Service'] },
  'icon near': { src: lines('svc: {', `  icon: ${PNG}`, '  icon.near: top-left', '}') },
  'label near': { src: lines('box: Caption {', '  label.near: outside-bottom-center', '}'), texts: ['Caption'] },
  'near constant': { src: lines('main', 'title: Big title {', '  near: top-center', '}'), texts: ['Big title'] },
  'near another object': { src: lines('a', 'b', 'note: hi {', '  near: a', '}'), texts: ['hi'] },

  // ------------------------------------------------------------- connections
  ...Object.fromEntries(['->', '<-', '<->', '--'].map((arrow) =>
    [`connection ${arrow}`, { src: `a ${arrow} b`, texts: ['a', 'b'] }])),
  'connection label': { src: 'a -> b: talks to', texts: ['talks to'] },
  'chained connections': { src: 'a -> b -> c: chain', texts: ['a', 'b', 'c'] },
  'repeated connections': { src: lines('a -> b: one', 'a -> b: two'), texts: ['one', 'two'] },
  'self connection': { src: 'a -> a: loop', texts: ['loop'] },
  'connection between nested shapes': { src: lines('x: {', '  a', '}', 'y: {', '  b', '}', 'x.a -> y.b'), texts: ['a', 'b'] },
  'connection inside a container': { src: lines('g: {', '  a -> b: inner', '}'), texts: ['inner'] },
  'parent reference _': { src: lines('outer: {', '  inner: {', '    a -> _.b', '  }', '  b', '}') },
  'connection reference by index': {
    src: lines('a -> b', '(a -> b)[0].style.stroke: red'),
  },
  'connection map body': {
    src: lines('a -> b: label {', '  style.stroke-width: 4', '}'), texts: ['label'],
  },
  ...Object.fromEntries([
    'triangle', 'arrow', 'diamond', 'circle', 'box', 'cross',
    'cf-one', 'cf-one-required', 'cf-many', 'cf-many-required',
  ].map((shape) => [`arrowhead ${shape}`, {
    src: lines('a -> b: {', '  target-arrowhead: {', `    shape: ${shape}`, '  }', '}'),
  }])),
  'filled arrowheads': {
    src: lines('a -> b: {', '  source-arrowhead: {', '    shape: diamond', '    style.filled: true', '  }',
      '  target-arrowhead: {', '    shape: circle', '    style.filled: false', '  }', '}'),
  },
  'arrowhead labels': {
    src: lines('a -> b: {', '  source-arrowhead: 1', '  target-arrowhead: {', '    label: "*"', '  }', '}'),
    texts: ['1', '*'],
  },
  'arrowhead dot syntax': { src: lines('a -> b: {', '  target-arrowhead.shape: cf-many', '}') },

  // -------------------------------------------------------------- containers
  'container map': { src: lines('cloud: AWS {', '  ec2', '  rds', '}'), texts: ['AWS', 'ec2', 'rds'] },
  'container by dot path': { src: 'a.b.c', texts: ['a', 'b', 'c'] },
  'deep nesting': { src: lines('l1: {', '  l2: {', '    l3: {', '      leaf', '    }', '  }', '}'), texts: ['leaf'] },
  'container label keyword': { src: lines('g: {', '  label: Group label', '  x', '}'), texts: ['Group label'] },
  'container direction': { src: lines('g: {', '  direction: right', '  a -> b', '}') },

  // -------------------------------------------------------------- text & code
  'markdown block': { src: lines('md: |md', '  # Title', '  - item', '|'), texts: ['Title'] },
  'markdown label on a box': { src: lines('docs: {', '  label: |md', '    **bold**', '  |', '  shape: rectangle', '}') },
  'latex block': { src: lines('eq: |latex', '  E = mc^2', '|') },
  'code block': { src: lines('c: |go', '  fmt.Println("hi")', '|'), texts: ['fmt'] },
  'code block, other languages': {
    src: lines('py: |python', '  print(1)', '|', 'ts: |ts', '  let x = 1', '|'), texts: ['print'],
  },
  'double fence block string': { src: lines('c: ||go', '  s := "|"', '||'), texts: ['s'] },
  'plain block string': { src: lines('t: |', '  plain text', '|'), texts: ['plain text'] },

  // ---------------------------------------------------------------- styles
  ...Object.fromEntries([
    ['opacity', '0.4'], ['stroke', 'red'], ['fill', '"#ffeeaa"'], ['fill-pattern', 'dots'],
    ['stroke-width', '5'], ['stroke-dash', '4'], ['border-radius', '8'], ['shadow', 'true'],
    ['3d', 'true'], ['multiple', 'true'], ['double-border', 'true'], ['font', 'mono'],
    ['font-size', '24'], ['font-color', 'blue'], ['animated', 'true'], ['bold', 'false'],
    ['italic', 'true'], ['underline', 'true'], ['text-transform', 'uppercase'],
  ].map(([prop, value]) => [`style.${prop}`, { src: lines('x', `x.style.${prop}: ${value}`), texts: [] }])),
  'style map': { src: lines('x: {', '  style: {', '    fill: red', '    stroke: blue', '  }', '}') },
  'style inside the shape map': { src: lines('x: {', '  style.fill: red', '}') },
  'connection styles': {
    src: lines('a -> b: {', '  style.stroke: green', '  style.stroke-dash: 3', '  style.animated: true', '}'),
  },
  'root style': { src: lines('style.fill: "#f5f5f5"', 'a') },

  // ------------------------------------------------------------- interactive
  'tooltip': { src: lines('x: {', '  tooltip: hello there', '}') },
  'link': { src: lines('x: {', '  link: https://d2lang.com', '}') },
  'connection tooltip': { src: lines('a -> b: {', '  tooltip: why', '}') },

  // -------------------------------------------------------------- special
  'sql_table': {
    src: lines('users: {', '  shape: sql_table', '  id: int {constraint: primary_key}',
      '  org: int {constraint: foreign_key}', '  email: string {constraint: unique}', '}'),
    texts: ['users', 'id', 'email'],
  },
  'sql_table foreign key connection': {
    src: lines('users: {', '  shape: sql_table', '  id: int', '}', 'orders: {', '  shape: sql_table',
      '  user_id: int', '}', 'orders.user_id -> users.id'),
  },
  'uml class': {
    src: lines('Order: {', '  shape: class', '  +id: int', '  -total: float', '  #secret: string',
      '  "place()": bool', '}'),
    texts: ['Order', 'place()'],
  },
  'sequence diagram': {
    src: lines('chat: {', '  shape: sequence_diagram', '  alice -> bob: hi', '  bob -> alice: hey', '}'),
    texts: ['alice', 'bob', 'hi'],
  },
  'sequence diagram spans, notes, groups and self-messages': {
    src: lines('s: {', '  shape: sequence_diagram', '  a; b', '  a.t -> b: start', '  b."a note"',
      '  phase: {', '    a -> b: inside', '  }', '  b -> b: self', '}'),
    texts: ['start', 'inside', 'self'],
  },
  'grid rows and columns': {
    src: lines('g: {', '  grid-rows: 2', '  grid-columns: 2', '  grid-gap: 10', '  a; b; c; d', '}'),
    texts: ['a', 'd'],
  },
  'grid gaps': { src: lines('g: {', '  grid-columns: 3', '  vertical-gap: 4', '  horizontal-gap: 20', '  a; b; c', '}') },

  // ---------------------------------------------------- classes, vars, globs
  'classes': {
    src: lines('classes: {', '  hot: {', '    style.fill: red', '  }', '}', 'x: {', '  class: hot', '}'),
  },
  'multiple classes': {
    src: lines('classes: {', '  a: {', '    style.bold: true', '  }', '  b: {', '    shape: circle', '  }', '}',
      'x.class: [a; b]'),
  },
  'class on a connection': {
    src: lines('classes: {', '  dashed: {', '    style.stroke-dash: 3', '  }', '}', 'a -> b: {', '  class: dashed', '}'),
  },
  'vars substitution': {
    src: lines('vars: {', '  name: Server', '}', 'x: ${name}'), texts: ['Server'],
  },
  'd2-config vars': {
    src: lines('vars: {', '  d2-config: {', '    layout-engine: elk', '    theme-id: 4', '  }', '}', 'a -> b'),
  },
  'glob': { src: lines('a; b; c', '*.style.fill: pink') },
  'recursive glob': { src: lines('g: {', '  a', '}', '**.style.stroke: red') },
  'glob connection': { src: lines('a; b; hub', '* -> hub') },
  'glob filter': {
    src: lines('a; b: {shape: circle}', '*: {', '  &shape: circle', '  style.fill: yellow', '}'),
  },
  'null deletes': { src: lines('a; b', 'b: null'), texts: ['a'] },
  'comments': { src: lines('# a comment', 'a # trailing', 'b'), texts: ['a', 'b'] },
  'block comment': { src: lines('"""', 'not drawn', '"""', 'a'), texts: ['a'] },
  'escaped hash': { src: 'tag: \\#hashtag', texts: ['#hashtag'] },
  'direction': { src: lines('direction: right', 'a -> b') },
  'legend': {
    src: lines('vars: {', '  d2-legend: {', '    l: Legend item', '  }', '}', 'a'),
  },

  // ------------------------------------------------------------------ boards
  'layers': {
    src: lines('a', 'layers: {', '  detail: {', '    x -> y', '  }', '}'), boards: ['main', 'layer: detail'],
  },
  'scenarios': {
    src: lines('a', 'scenarios: {', '  down: {', '    a.style.opacity: 0.3', '  }', '}'), boards: ['main', 'scenario: down'],
  },
  'steps': {
    src: lines('steps: {', '  one: {', '    a', '  }', '  two: {', '    a -> b', '  }', '}'),
    boards: ['main', 'step: one', 'step: two'],
  },
  'link to a board': {
    src: lines('a: {', '  link: layers.more', '}', 'layers: {', '  more: {', '    b', '  }', '}'),
    boards: ['main', 'layer: more'],
  },
  'nested boards': {
    src: lines('layers: {', '  l: {', '    x', '    scenarios: {', '      s: {', '        x.style.fill: red', '      }', '    }', '  }', '}'),
    boards: ['main', 'layer: l', 'scenario: l › s'],
  },
};

// One warm page per worker, reused by every case it runs. A fresh page per test
// spent ~6 s of each one on d2's cold wasm compile and well under one on the
// case itself; only the source changes between cases, so nothing else leaks.
const it = test.extend({
  warm: [async ({ browser }, use, workerInfo) => {
    const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
    await open(page);
    await use(page);
    await page.close();
  }, { scope: 'worker' }],
});

for (const [name, { src, texts = [], boards }] of Object.entries(CASES)) {
  it(`d2 syntax: ${name}`, async ({ warm: page }) => {
    const crashes = [];
    const onCrash = (e) => crashes.push(e.message);
    page.on('pageerror', onCrash);

    // A board left selected by the previous case would hide this one's root.
    const picker = page.locator('header label:has-text("board") select');
    if (await picker.count() && await picker.inputValue()) await picker.selectOption('');

    // `busy` goes up in the same tick the source changes (the render itself is
    // debounced), so seeing it rise and fall means *this* case was drawn — not
    // the previous one, even when both draw the same picture.
    const pane = source(page);
    const busy = page.locator('.busy');
    await expect(busy).toHaveCount(0, { timeout: 20_000 });
    await pane.fill(src);
    await expect(busy).toHaveCount(1);
    await pane.blur(); // drops the draft, so what's shown is the editor's own reprint
    await expect(busy).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.error')).toHaveCount(0);
    await expect(pane).toHaveValue(`${src}\n`);

    const svg = page.locator('.paper > svg');
    for (const t of texts) await expect(svg).toContainText(t);
    if (boards) await expect(picker.locator('option')).toHaveText(boards);

    await expect(page.locator('.stage canvas')).toBeVisible();
    page.off('pageerror', onCrash);
    expect(crashes).toEqual([]);
  });
}

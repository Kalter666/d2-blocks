import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parse, keys, remove, relativize, absolutize } from './blocks.js';

const tree = [
  { type: 'direction', value: 'right' },
  { type: 'box', name: 'Database', label: '', shape: 'cylinder' },
  { type: 'box', name: 'Cache', label: 'Redis', shape: '' },
  { type: 'box', name: 'CDN', label: 'Edge cache', shape: 'cloud' },
  {
    type: 'group', name: 'Backend', label: '', children: [
      { type: 'box', name: 'API', label: '', shape: '' },
      { type: 'box', name: 'Worker', label: '', shape: '' },
    ],
  },
  { type: 'link', src: 'Backend.API', arrow: '->', dst: 'Database', label: '' },
  { type: 'link', src: 'Backend.API', arrow: '->', dst: 'Backend.Worker', label: 'queues' },
  { type: 'style', target: 'Database', prop: 'fill', value: '#c9d6ff' },
];

test('tree -> d2 -> tree round-trips', () => {
  assert.deepEqual(parse(serialize(tree)), tree);
});

test('emitted d2 is what a human would have written', () => {
  assert.equal(serialize(tree), [
    'direction: right',
    'Database: {shape: cylinder}',
    'Cache: Redis',
    'CDN: Edge cache {shape: cloud}',
    'Backend: {',
    '  API',
    '  Worker',
    '}',
    'Backend.API -> Database',
    'Backend.API -> Backend.Worker: queues',
    'Database.style.fill: "#c9d6ff"',
  ].join('\n'));
});

test('nested groups round-trip', () => {
  const nested = [
    { type: 'group', name: 'a', label: '', children: [
      { type: 'group', name: 'b', label: 'Bee', children: [
        { type: 'box', name: 'c', label: '', shape: '' },
      ] },
    ] },
  ];
  assert.equal(serialize(nested), 'a: {\n  b: Bee {\n    c\n  }\n}');
  assert.deepEqual(parse(serialize(nested)), nested);
});

test('names that would change meaning get quoted', () => {
  for (const name of ['a.b', 'a -> b', 'a: b', 'a#b', '', ' a']) {
    const t = [{ type: 'box', name, label: '', shape: '' }];
    assert.deepEqual(parse(serialize(t)), t, `failed for ${JSON.stringify(name)}`);
  }
});

// Blocks hold root-qualified keys; d2 resolves them against the enclosing map.
// A link written inside AUTH saying `AUTH.db` would mean AUTH.AUTH.db.
test('a link inside a group is written relative to that group', () => {
  const t = [
    { type: 'group', name: 'AUTH', label: '', children: [
      { type: 'box', name: 'auth service', label: '', shape: 'rectangle' },
      { type: 'box', name: 'auth db', label: '', shape: '' },
      { type: 'link', src: 'AUTH.auth service', arrow: '->', dst: 'AUTH.auth db', label: '' },
      { type: 'style', target: 'AUTH.auth db', prop: 'fill', value: '#eee' },
    ] },
  ];
  assert.equal(serialize(t), [
    'AUTH: {',
    '  auth service: {shape: rectangle}',
    '  auth db',
    '  auth service -> auth db',
    '  auth db.style.fill: "#eee"',
    '}',
  ].join('\n'));
  assert.deepEqual(parse(serialize(t)), t);
});

test('a link inside a group can still reach outside it', () => {
  const t = [
    { type: 'box', name: 'Gateway', label: '', shape: '' },
    { type: 'group', name: 'AUTH', label: '', children: [
      { type: 'box', name: 'svc', label: '', shape: '' },
      { type: 'link', src: 'AUTH.svc', arrow: '->', dst: 'Gateway', label: '' },
    ] },
  ];
  assert.match(serialize(t), /^ {2}svc -> _\.Gateway$/m, 'needs d2’s parent reference');
  assert.deepEqual(parse(serialize(t)), t);
});

test('relative keys climb out of deep nesting', () => {
  assert.equal(relativize('A.B.x', ['A', 'B']), 'x');
  assert.equal(relativize('A.C', ['A', 'B']), '_.C');
  assert.equal(relativize('Z', ['A', 'B']), '_._.Z');
  assert.equal(relativize('A', ['A', 'B']), '_._.A', 'the group itself, from inside');
  for (const [key, scope] of [['A.B.x', ['A', 'B']], ['A.C', ['A', 'B']], ['Z', ['A', 'B']], ['A', ['A']]]) {
    assert.equal(absolutize(relativize(key, scope), scope), key, `${key} in ${scope}`);
  }
});

test('unrecognised lines survive verbatim', () => {
  const src = [
    'vars: {',
    '  d2-config: {',
    '    theme-id: 4',
    '  }',
    '}',
    '# a comment',
    'classes: {',
    '  load: {style.multiple: true}',
    '}',
    'x -> y',
  ].join('\n');
  const out = serialize(parse(src));
  for (const l of ['# a comment', '    theme-id: 4', '  load: {style.multiple: true}']) {
    assert.ok(out.includes(l), `lost: ${l}`);
  }
});

// The code pane is an input, so this is the guarantee paste rests on: a file
// mixing things we model with things we don't comes back byte-for-byte.
test('a pasted d2 file survives the editor untouched', () => {
  const pasted = [
    '# Architecture',
    'vars: {',
    '  d2-config: {',
    '    theme-id: 4',
    '  }',
    '}',
    'direction: right',
    'Client: {shape: person}',
    'Backend: The Backend {',
    '  API',
    '  Worker: Background worker',
    '  API -> Worker: jobs',
    '}',
    'Client -> Backend.API: HTTPS',
    'Backend.style.fill: "#eef"',
  ].join('\n');

  assert.equal(serialize(parse(pasted)), pasted);

  // …and the parts we do model came through as real blocks, not raw fallbacks.
  const blocks = parse(pasted);
  assert.equal(blocks.filter((b) => b.type === 'raw').length, 2, 'only the comment and vars');
  const backend = blocks.find((b) => b.type === 'group' && b.name === 'Backend');
  assert.equal(backend.label, 'The Backend');
  assert.deepEqual(
    backend.children.filter((b) => b.type === 'link').map((b) => [b.src, b.dst]),
    [['Backend.API', 'Backend.Worker']],
    'a nested link resolves to root-qualified keys',
  );
});

// ---------------------------------------------------------------- rich text

const md = (label, shape = '') => [{ type: 'box', name: 'Notes', label, shape, md: true }];

test('a markdown box is the short form a human would write', () => {
  assert.equal(serialize(md('# Payment flow\n\n- charges the card')), [
    'Notes: |md',
    '  # Payment flow',
    '',
    '  - charges the card',
    '|',
  ].join('\n'));
});

test('markdown plus a shape needs the map form', () => {
  assert.equal(serialize(md('**bold**', 'cylinder')), [
    'Notes: {',
    '  label: |md',
    '    **bold**',
    '  |',
    '  shape: cylinder',
    '}',
  ].join('\n'));
});

test('markdown boxes round-trip', () => {
  const cases = [
    md('# Heading'),
    md('# Heading\n\n- a\n- b\n\nclosing text'),
    md('**bold**', 'cylinder'),
    // d2 ends a block string at the first fence it sees, so this must widen it.
    md('| a | b |\n| - | - |'),
    md('a || b'),
    // Braces on their own lines used to pop the brace scanner mid-file.
    md('use a map:\n\n}\n{'),
    [{ type: 'group', name: 'G', label: '', children: md('# Nested', 'cloud') }],
    [...md('# Note'), { type: 'box', name: 'x', label: '', shape: '' },
      { type: 'link', src: 'Notes', arrow: '->', dst: 'x', label: '' }],
  ];
  for (const t of cases) {
    assert.deepEqual(parse(serialize(t)), t, serialize(t));
  }
});

test('a connection label can be markdown too', () => {
  const t = [
    { type: 'box', name: 'a', label: '', shape: '' },
    { type: 'box', name: 'b', label: '', shape: '' },
    { type: 'link', src: 'a', arrow: '->', dst: 'b', label: '# Why\n\n- because', md: true },
  ];
  assert.equal(serialize(t), ['a', 'b', 'a -> b: |md', '  # Why', '', '  - because', '|'].join('\n'));
  assert.deepEqual(parse(serialize(t)), t);
});

test('a markdown connection inside a group stays relative to it', () => {
  const t = [
    { type: 'group', name: 'G', label: '', children: [
      { type: 'box', name: 'a', label: '', shape: '' },
      { type: 'box', name: 'b', label: '', shape: '' },
      { type: 'link', src: 'G.a', arrow: '->', dst: 'G.b', label: '**hi**', md: true },
    ] },
  ];
  assert.match(serialize(t), /^ {2}a -> b: \|md$/m);
  assert.deepEqual(parse(serialize(t)), t);
});

test('a wide fence is only used when the content forces it', () => {
  assert.match(serialize(md('plain')), /^Notes: \|md$/m);
  assert.match(serialize(md('a | b')), /^Notes: \|\|md$/m);
  assert.match(serialize(md('a || b')), /^Notes: \|\|\|md$/m);
});

test('an empty rich box degrades to a plain one, because d2 rejects empty block strings', () => {
  assert.equal(serialize(md('')), 'Notes');
  // A whitespace-only label goes down the same path a plain box would, quotes
  // and all — no special case worth carrying for a state nobody stays in.
  assert.equal(serialize(md('   ')), 'Notes: "   "');
});

test('hand-written markdown source survives the editor', () => {
  const pasted = [
    'direction: right',
    'Notes: |md',
    '  # Title',
    '',
    '  Some **bold** text.',
    '|',
    'Notes -> x',
  ].join('\n');
  assert.equal(serialize(parse(pasted)), pasted);
  const box = parse(pasted).find((b) => b.md);
  assert.equal(box.label, '# Title\n\nSome **bold** text.', 'the body is dedented, as d2 does');
});

// Block strings we can't put an editor behind still can't be allowed to reach
// the line scanner — their bodies contain arbitrary text.
test('non-markdown block strings survive as one raw block', () => {
  const src = ['eq: |latex', '  x = {1 \\over 2}', '|', 'a -> b'].join('\n');
  const blocks = parse(src);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'raw');
  assert.equal(blocks[1].type, 'link');
  assert.equal(serialize(blocks), src);
});

test('a markdown label on a group keeps the group', () => {
  // d2 turns such a group into a text shape and orphans its children, so the
  // editor doesn't model it — but it must still come back byte-for-byte.
  const src = ['G: {', '  label: |md', '    # G', '  |', '  x', '}'].join('\n');
  assert.equal(serialize(parse(src)), src);
  assert.equal(parse(src)[0].type, 'group');
});

test('a file we cannot scan is preserved whole', () => {
  const src = 'a: {\n  b\n'; // unbalanced
  const blocks = parse(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'raw');
  assert.equal(serialize(blocks), src.replace(/\n$/, ''));
});

test('keys are fully qualified for the dropdowns', () => {
  assert.deepEqual(keys(tree).map((k) => k.key),
    ['Database', 'Cache', 'CDN', 'Backend', 'Backend.API', 'Backend.Worker']);
});

test('a key quotes names that would otherwise nest', () => {
  const t = [{ type: 'group', name: 'a.b', label: '', children: [{ type: 'box', name: 'c', label: '', shape: '' }] }];
  assert.deepEqual(keys(t).map((k) => k.key), ['"a.b"', '"a.b".c']);
});

test('remove finds blocks nested in groups', () => {
  const t = structuredClone(tree);
  const worker = t[4].children[1];
  assert.equal(remove(t, worker), true);
  assert.deepEqual(keys(t).map((k) => k.key), ['Database', 'Cache', 'CDN', 'Backend', 'Backend.API']);
  assert.equal(remove(t, { type: 'box' }), false);
});

test('a connection with a map body and inline maps survive verbatim', () => {
  const src = [
    'a -> b: reads {',
    '  target-arrowhead: {',
    '    shape: cf-many',
    '  }',
    '}',
    'layers: { detail: { x -> y } }',
    'scenarios: { s: { a.style.opacity: 0.4 } }',
    'Order: {',
    '  shape: class',
    '  +id: int',
    '}',
    '',
  ].join('\n');
  assert.equal(serialize(parse(src)) + '\n', src);
});

test('a group holding a table is still a group', () => {
  const blocks = parse('db: {\n  users: {\n    shape: sql_table\n    id: int\n  }\n}\n');
  assert.equal(blocks[0].type, 'group');
  assert.equal(blocks[0].children[0].type, 'raw');
});

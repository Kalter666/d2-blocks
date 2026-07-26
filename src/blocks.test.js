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
  assert.equal(blocks.filter((b) => b.type === 'raw').length, 1, 'only the comment');
  const backend = blocks.find((b) => b.type === 'group' && b.name === 'Backend');
  assert.equal(backend.label, 'The Backend');
  assert.deepEqual(
    backend.children.filter((b) => b.type === 'link').map((b) => [b.src, b.dst]),
    [['Backend.API', 'Backend.Worker']],
    'a nested link resolves to root-qualified keys',
  );
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

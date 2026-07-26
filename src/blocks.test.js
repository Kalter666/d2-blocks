import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parse, keys, remove } from './blocks.js';

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

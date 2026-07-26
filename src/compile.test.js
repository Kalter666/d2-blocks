// blocks.test.js proves the tree survives a round-trip. This proves the d2 we
// emit means what we think it means — round-tripping garbage is still garbage.
// Slower (loads the wasm), so it's a separate file.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { D2 } from '@terrastruct/d2';
import { serialize, keys } from './blocks.js';

// The d2 worker holds the event loop open, hence --test-force-exit in the
// npm script. Don't exit from an after() hook — it swallows late failures.
let d2;
before(() => { d2 = new D2(); });

const compile = (tree) => d2.compile(serialize(tree), { layout: 'dagre' });

test('every dropdown key addresses a real shape', async () => {
  const tree = [
    { type: 'box', name: 'Database', label: '', shape: 'cylinder' },
    { type: 'group', name: 'Backend', label: 'The Backend', children: [
      { type: 'box', name: 'API', label: '', shape: '' },
      { type: 'group', name: 'Jobs', label: '', children: [
        { type: 'box', name: 'Worker', label: 'Queue worker', shape: 'queue' },
      ] },
    ] },
  ];
  const { diagram } = await compile(tree);
  assert.deepEqual(diagram.shapes.map((s) => s.id).sort(), keys(tree).map((k) => k.key).sort());
});

test('labels land on the shape, not swallowed by syntax', async () => {
  const { diagram } = await compile([
    { type: 'box', name: 'a', label: 'Plain label', shape: '' },
    { type: 'box', name: 'b', label: 'Label and shape', shape: 'cloud' },
    { type: 'group', name: 'c', label: 'Group label', children: [] },
  ]);
  const labels = Object.fromEntries(diagram.shapes.map((s) => [s.id, s.label]));
  assert.deepEqual(labels, { a: 'Plain label', b: 'Label and shape', c: 'Group label' });
  assert.equal(diagram.shapes.find((s) => s.id === 'b').type, 'cloud');
});

test('awkward names connect instead of nesting', async () => {
  // The bug this guards: an unquoted `a.b` in a link would address a *child*
  // called b, silently creating it, instead of the box actually named "a.b".
  const tree = [
    { type: 'box', name: 'a.b', label: '', shape: '' },
    { type: 'box', name: 'plain', label: '', shape: '' },
  ];
  const [awkward] = keys(tree);
  tree.push({ type: 'link', src: awkward.key, arrow: '->', dst: 'plain', label: 'hi' });

  const { diagram } = await compile(tree);
  assert.equal(diagram.shapes.length, 2, 'a phantom shape was created');
  assert.equal(diagram.connections.length, 1);
  assert.equal(diagram.connections[0].label, 'hi');
});

test('a connection inside a group does not spawn a phantom group', async () => {
  // The bug: blocks hold root-qualified keys, but d2 resolves a key against the
  // map it is written in, so `AUTH.svc` inside AUTH meant AUTH.AUTH.svc.
  const tree = [
    { type: 'direction', value: 'right' },
    { type: 'group', name: 'AUTH', label: '', children: [
      { type: 'box', name: 'auth service', label: '', shape: 'rectangle' },
      { type: 'box', name: 'auth db', label: '', shape: '' },
      { type: 'link', src: 'AUTH.auth service', arrow: '->', dst: 'AUTH.auth db', label: '' },
    ] },
  ];
  const { diagram } = await compile(tree);
  assert.deepEqual(diagram.shapes.map((s) => s.id).sort(),
    ['AUTH', 'AUTH.auth db', 'AUTH.auth service']);
  assert.equal(diagram.connections.length, 1);
  assert.equal(diagram.connections[0].src, 'AUTH.auth service');
  assert.equal(diagram.connections[0].dst, 'AUTH.auth db');
});

test('a connection inside a group can reach a box outside it', async () => {
  const tree = [
    { type: 'box', name: 'Gateway', label: '', shape: '' },
    { type: 'group', name: 'AUTH', label: '', children: [
      { type: 'box', name: 'svc', label: '', shape: '' },
      { type: 'link', src: 'AUTH.svc', arrow: '->', dst: 'Gateway', label: '' },
    ] },
  ];
  const { diagram } = await compile(tree);
  assert.deepEqual(diagram.shapes.map((s) => s.id).sort(), ['AUTH', 'AUTH.svc', 'Gateway']);
  assert.deepEqual(
    diagram.connections.map((c) => [c.src, c.dst]), [['AUTH.svc', 'Gateway']]);
});

test('styles apply to the shape they name', async () => {
  const { diagram } = await compile([
    { type: 'box', name: 'x', label: '', shape: '' },
    { type: 'style', target: 'x', prop: 'fill', value: '#c9d6ff' },
  ]);
  assert.equal(diagram.shapes.length, 1, '"#c9d6ff" was probably read as a comment');
  assert.equal(diagram.shapes[0].fill, '#c9d6ff');
});

test('rendered SVG tags every shape with its id, so the canvas can link back', async () => {
  const tree = [
    { type: 'box', name: 'Database', label: '', shape: 'cylinder' },
    { type: 'group', name: 'Backend', label: '', children: [{ type: 'box', name: 'API', label: '', shape: '' }] },
    { type: 'link', src: 'Backend.API', arrow: '->', dst: 'Database', label: '' },
  ];
  const r = await compile(tree);
  const svg = await d2.render(r.diagram, r.renderOptions);

  // d2 base64s the XML-escaped id onto the <g> class, so decode rather than
  // encode: `a -> b` is stored as `a -&gt; b`, and there may be extra classes.
  const found = [...svg.matchAll(/<g class="([^"]+)"/g)]
    .map((m) => unescapeXml(Buffer.from(m[1].split(' ')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()));

  for (const id of [...r.diagram.shapes.map((s) => s.id), ...r.diagram.connections.map((c) => c.id)]) {
    assert.ok(found.includes(id), `no <g> for ${id}; found ${JSON.stringify(found)}`);
  }
});

const unescapeXml = (s) =>
  s.replace(/&(?:amp|lt|gt|#34|#39);/g, (e) =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#34;': '"', '&#39;': "'" })[e]);

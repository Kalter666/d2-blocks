import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid, fromMermaid } from './mermaid.js';

const find = (blocks, pred) => blocks.find(pred);

test('shapes map both ways', () => {
  const blocks = fromMermaid('flowchart TD\n  A[(DB)] --> B{Go}');
  assert.equal(find(blocks, (b) => b.name === 'A')?.shape, 'cylinder');
  assert.equal(find(blocks, (b) => b.name === 'B')?.shape, 'diamond');
  const mm = toMermaid(blocks);
  assert.match(mm, /A\[\(DB\)\]/);
  assert.match(mm, /B\{Go\}/);
});

test('edge label survives a round-trip', () => {
  const blocks = fromMermaid('flowchart LR\n  A --> |sends| B');
  const link = find(blocks, (b) => b.type === 'link');
  assert.equal(link.label, 'sends');
  assert.match(toMermaid(blocks), /A -->\|sends\| B/);
});

test('subgraph becomes a group with its children', () => {
  const blocks = fromMermaid([
    'flowchart TD',
    '  subgraph AUTH [Auth service]',
    '    login --> token',
    '  end',
  ].join('\n'));
  const group = find(blocks, (b) => b.type === 'group');
  assert.equal(group.name, 'AUTH');
  assert.equal(group.label, 'Auth service');
  assert.equal(group.children.filter((c) => c.type === 'box').length, 2);
  // link is at root, referencing the group-qualified keys
  const link = find(blocks, (b) => b.type === 'link');
  assert.equal(link.src, 'AUTH.login');
  assert.equal(link.dst, 'AUTH.token');
});

test('direction maps and defaults', () => {
  assert.equal(find(fromMermaid('flowchart LR\n A'), (b) => b.type === 'direction').value, 'right');
  assert.equal(find(fromMermaid('graph BT\n A'), (b) => b.type === 'direction').value, 'up');
  assert.match(toMermaid([{ type: 'direction', value: 'right' }]), /^flowchart LR/);
});

test('mermaid style maps to a d2 style block', () => {
  const blocks = fromMermaid('flowchart TD\n A\n style A fill:#f9f,stroke-width:2px');
  const fill = find(blocks, (b) => b.type === 'style' && b.prop === 'fill');
  assert.equal(fill.value, '#f9f');
  assert.equal(find(blocks, (b) => b.prop === 'stroke-width').value, '2');
});

test('non-flowchart diagrams are rejected', () => {
  assert.throws(() => fromMermaid('sequenceDiagram\n  A->>B: hi'), /flowchart/);
  assert.throws(() => fromMermaid('classDiagram\n  class A'), /flowchart/);
});

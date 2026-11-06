// The MCP tools against the real d2 engine, called as plain functions. The
// protocol wiring in server.js is checked separately, over stdio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderD2, checkD2, convert, examples, openInEditor, d2Error, EDITOR } from './tools.js';
import { decode } from '../src/share.js';

test('render_d2 returns an SVG, and d2\'s error with line numbers', async () => {
  const { svg } = await renderD2({ source: 'a -> b: hello' });
  assert.match(svg, /^<svg/);
  assert.match(svg, /hello/);
  await assert.rejects(renderD2({ source: 'a -> {\n' }), /line 1:/);
});

test('check_d2 reports compile, round-trip and what stays raw', async () => {
  const ok = await checkD2({ source: 'x -> y\nvars: {\n  n: 1\n}' });
  assert.equal(ok.compiles, true);
  assert.equal(ok.roundTrips, true);
  assert.deepEqual(ok.rawBlocks, ['vars: {\n  n: 1\n}']);
  assert.deepEqual([ok.shapes, ok.connections], [2, 1]);

  const bad = await checkD2({ source: 'a -> \n' });
  assert.equal(bad.compiles, false);
  assert.ok(bad.error);
});

test('convert goes both ways and refuses what it can\'t read', () => {
  assert.match(convert({ from: 'mermaid', source: 'flowchart LR\n  A[Start] --> B' }), /->/);
  assert.match(convert({ from: 'd2', source: 'a -> b' }), /^flowchart/);
  assert.throws(() => convert({ from: 'mermaid', source: 'sequenceDiagram\n  A->>B: hi' }));
  assert.throws(() => convert({ from: 'plantuml', source: '' }), /must be/);
});

test('examples lists the gallery and returns sources that compile', async () => {
  const list = await examples();
  assert.ok(list.length > 5);
  assert.ok(list.every((e) => e.id && e.title && e.category));
  const one = await examples({ id: list[0].id });
  assert.equal((await checkD2({ source: one.source })).compiles, true);
  await assert.rejects(examples({ id: '../../package' }), /no example/);
});

test('open_in_editor links to the hosted editor with the diagram in the fragment', async () => {
  const url = await openInEditor({ source: 'a -> b' });
  assert.ok(url.startsWith(`${EDITOR}#d2=`));
  assert.equal(await decode(new URL(url).hash), 'a -> b\n');
  assert.ok((await openInEditor({ source: 'a', base: 'http://localhost:5173/d2-blocks/' })).startsWith('http://localhost:5173/d2-blocks/#d2='));
  await assert.rejects(openInEditor({ source: 'a', base: 'javascript:alert(1)' }), /https/);
});

test('d2Error passes through what isn\'t d2\'s JSON', () => {
  assert.equal(d2Error(new Error('plain')), 'plain');
});

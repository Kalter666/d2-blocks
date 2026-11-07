// The MCP tools against the real d2 engine, called as plain functions. The
// protocol wiring in server.js is checked separately, over stdio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderD2, checkD2, convert, examples, shapes, openInEditor, d2Error, EDITOR, MAX_INLINE_SVG, BUDGET_3D } from './tools.js';
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
  assert.equal(ok.roundTrip, 'exact');
  assert.deepEqual(ok.rawBlocks, ['vars: {\n  n: 1\n}']);
  assert.deepEqual([ok.shapes, ok.connections], [2, 1]);

  // Hand-written spacing is reprinted canonically, and still draws the same.
  const spaced = await checkD2({ source: 'u: User { shape: person }\nu -> v' });
  assert.equal(spaced.roundTrip, 'reformatted');
  assert.match(spaced.editorSource, /\{shape: person\}/);

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
  assert.equal((await decode(new URL(url).hash)).source, 'a -> b\n');
  assert.ok((await openInEditor({ source: 'a', base: 'http://localhost:5173/d2-blocks/' })).startsWith('http://localhost:5173/d2-blocks/#d2='));
  await assert.rejects(openInEditor({ source: 'a', base: 'javascript:alert(1)' }), /https/);
});

test('d2Error passes through what isn\'t d2\'s JSON', () => {
  assert.equal(d2Error(new Error('plain')), 'plain');
});

// Links between nested containers: dagre panics on this from ~100 shapes.
const nested = (groups) => {
  let s = '';
  for (let g = 0; g < groups; g++) s += `svc${g}: {\n${Array.from({ length: 10 }, (_, i) => `  n${i}\n`).join('')}}\n`;
  for (let g = 0; g < groups; g++) for (let i = 0; i < 10; i++) s += `svc${g}.n${i} -> svc${(g * 7 + i * 3 + 1) % groups}.n${(i + 1) % 10}\n`;
  return s;
};

test('a big SVG goes to a file, never into the reply', async () => {
  const big = nested(10);
  await assert.rejects(renderD2({ source: big, layout: 'elk' }), /out:/);
  const out = join(tmpdir(), `d2-blocks-${process.pid}.svg`);
  try {
    const r = await renderD2({ source: big, layout: 'elk', out });
    assert.equal(r.path, out);
    assert.ok(r.bytes > MAX_INLINE_SVG);
    assert.match(await readFile(out, 'utf8'), /^<svg/);
  } finally { await rm(out, { force: true }); }
  await assert.rejects(renderD2({ source: 'a', out: '/tmp/x.sh' }), /\.svg/);
});

test('when dagre crashes, elk takes over and says so', async () => {
  const r = await checkD2({ source: nested(10) });
  assert.equal(r.compiles, true);
  assert.equal(r.layout, 'elk');
  assert.match(r.note, /dagre crashed/);
});

test('check_d2 look "3d" estimates the scene and advises', async () => {
  const small = await checkD2({ source: 'db: {shape: cylinder}\nu: {shape: person}\nu -> db', look: '3d' });
  assert.equal(small.threeD.objects, 2);
  assert.ok(small.threeD.drawCalls > 50, 'a server cabinet alone is ~50 meshes');
  assert.deepEqual(small.threeD.advice, []);

  const crowded = await checkD2({ source: nested(6), look: '3d' });
  assert.ok(crowded.threeD.objects > BUDGET_3D.shapes);
  assert.ok(crowded.threeD.advice.some((a) => /objects/.test(a)));
  assert.ok(crowded.threeD.advice.some((a) => /shape role/.test(a)), 'unshaped nodes are called out');

  assert.equal((await checkD2({ source: 'a' })).threeD, undefined, 'only when asked');
});

test('shapes lists every role with its 3D model', () => {
  const list = shapes();
  assert.equal(list.length, 18);
  assert.ok(list.every((s) => s.role && s.model3d && s.meshes3d > 0));
  assert.match(list.find((s) => s.shape === 'cylinder').model3d, /server cabinet/);
});

test('a link can open in 3D with the layout that worked', async () => {
  const url = await openInEditor({ source: 'a', look: '3d', layout: 'elk' });
  assert.deepEqual(await decode(new URL(url).hash), { source: 'a\n', look: '3d', layout: 'elk' });
});

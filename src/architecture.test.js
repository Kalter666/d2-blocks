// Rules that hold only because every caller happens to follow them. An agent
// adding "export PNG" or a second preview would most likely break them by
// writing a direct d2 call — skipping the serial gate (corrupt SVG), the
// watchdog (spinner forever) and sanitize() (XSS through {@html}) all at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const files = readdirSync(dir, { recursive: true })
  .filter((f) => /\.(js|svelte)$/.test(f) && !f.endsWith('.test.js'))
  .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);

test('only d2.js talks to the d2 engine', () => {
  const direct = files.filter(([, s]) => s.includes('@terrastruct/d2')).map(([f]) => f);
  assert.deepEqual(direct, ['d2.js'], 'call draw() from d2.js instead');
});

test('{@html} only ever receives draw() output', () => {
  // Each of these is fed by draw(), which sanitizes. A new sink needs the same.
  const sinks = files.flatMap(([f, s]) => [...s.matchAll(/\{@html ([^}]+)\}/g)].map((m) => `${f}: ${m[1]}`));
  assert.deepEqual(sinks.sort(), [
    'Canvas.svelte: app.svg',
    'Examples.svelte: preview',
    'MermaidImport.svelte: preview',
  ]);
});

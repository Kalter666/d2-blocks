import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, PREFIX, MAX_SOURCE, EDITOR } from './share.js';

test('a diagram survives the link, unicode and all', async () => {
  const src = 'direction: right\nпользователь -> "api.v1": "запрос #1" {style.stroke: "#f00"}\n';
  const hash = await encode(src);
  assert.ok(hash.startsWith(PREFIX));
  assert.match(hash.slice(PREFIX.length), /^[A-Za-z0-9_-]+$/, 'url-safe, no padding');
  assert.deepEqual(await decode(hash), { source: src, look: undefined, layout: undefined });
});

test('a link can name the view it opens in, and only a real one', async () => {
  assert.deepEqual(await decode(await encode('a', { look: '3d', layout: 'elk' })), { source: 'a', look: '3d', layout: 'elk' });
  assert.deepEqual(await decode(await encode('a', { look: 'flat' })), { source: 'a', look: 'flat', layout: undefined });
  assert.equal((await encode('a', { layout: 'tala' })).includes('layout'), false);
  assert.equal((await encode('a', { look: 'vr' })).includes('look'), false);
  const forged = `${await encode('a')}&look=<script>`;
  assert.equal((await decode(forged)).look, undefined);
});

test('anything else in the fragment is not a diagram', async () => {
  assert.equal(await decode(''), null);
  assert.equal(await decode('#section-2'), null);
  assert.equal(await decode(undefined), null);
});

test('a corrupt or oversized link throws instead of opening', async () => {
  await assert.rejects(decode(`${PREFIX}not-deflate`));
  // Highly compressible, so the link is tiny but inflates past the cap.
  const bomb = await encode('a'.repeat(MAX_SOURCE + 1));
  assert.ok(bomb.length < 2000);
  await assert.rejects(decode(bomb), /over/);
});

test('links point where package.json says the editor is hosted', () => {
  assert.equal(EDITOR, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).homepage);
});

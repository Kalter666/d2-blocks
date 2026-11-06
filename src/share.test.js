import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, PREFIX, MAX_SOURCE } from './share.js';

test('a diagram survives the link, unicode and all', async () => {
  const src = 'direction: right\nпользователь -> "api.v1": "запрос #1" {style.stroke: "#f00"}\n';
  const hash = await encode(src);
  assert.ok(hash.startsWith(PREFIX));
  assert.match(hash.slice(PREFIX.length), /^[A-Za-z0-9_-]+$/, 'url-safe, no padding');
  assert.equal(await decode(hash), src);
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

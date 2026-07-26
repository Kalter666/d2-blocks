import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveInto, reorderIn, parentOf, wouldNest, keys, renameKey, serialize } from './blocks.js';
import { encode, decode } from './share.js';

const box = (name) => ({ type: 'box', name, label: '', shape: '' });
const group = (name, children) => ({ type: 'group', name, label: '', children });

// a, b, G{ c, d }, e
const fixture = () => [box('a'), box('b'), group('G', [box('c'), box('d')]), box('e')];
const names = (t) => keys(t).map((k) => k.key).join(' ');

test('moving down in the same list accounts for its own removal', () => {
  const t = fixture();
  // Drop "a" at the slot before "e" — as the user sees it, index 3.
  assert.equal(moveInto(t, t[0], t, 3), true);
  assert.equal(names(t), 'b G G.c G.d a e');
});

test('moving up in the same list does not shift', () => {
  const t = fixture();
  const e = t[3];
  assert.equal(moveInto(t, e, t, 1), true);
  assert.equal(names(t), 'a e b G G.c G.d');
});

test('dropping a block where it already is changes nothing', () => {
  const t = fixture();
  assert.equal(moveInto(t, t[1], t, 1), false);
  assert.equal(moveInto(t, t[1], t, 2), false);
  assert.equal(names(t), 'a b G G.c G.d e');
});

test('a block moves into and back out of a group', () => {
  const t = fixture();
  const a = t[0], g = t[2];
  assert.equal(moveInto(t, a, g.children, 1), true);
  assert.equal(names(t), 'b G G.c G.a G.d e');
  assert.equal(moveInto(t, a, t, 0), true);
  assert.equal(names(t), 'a b G G.c G.d e');
});

test('a group cannot be dropped inside itself', () => {
  const t = [group('outer', [group('inner', [box('x')])])];
  const outer = t[0], inner = outer.children[0];
  assert.equal(wouldNest(outer, inner.children), true);
  assert.equal(moveInto(t, outer, inner.children, 0), false);
  assert.equal(moveInto(t, outer, outer.children, 0), false);
  assert.equal(names(t), 'outer outer.inner outer.inner.x');
  // The other direction is fine.
  assert.equal(moveInto(t, inner, t, 0), true);
  assert.equal(names(t), 'inner inner.x outer');
});

test('an out-of-range index clamps instead of tearing a hole', () => {
  const t = fixture();
  assert.equal(moveInto(t, t[0], t, 99), true);
  assert.equal(names(t), 'b G G.c G.d e a');
});

test('reorder stops at the ends of its own list', () => {
  const t = fixture();
  const c = t[2].children[0];
  assert.equal(reorderIn(t, c, -1), false, 'c is already first in G');
  assert.equal(reorderIn(t, c, 1), true);
  assert.equal(names(t), 'a b G G.d G.c e');
  assert.equal(reorderIn(t, c, 1), false, 'c is now last in G');
});

test('parentOf finds the owning list', () => {
  const t = fixture();
  assert.equal(parentOf(t, t[0]), t);
  assert.equal(parentOf(t, t[2].children[1]), t[2].children);
  assert.equal(parentOf(t, box('nowhere')), null);
});

test('dragging a box into a group repoints links at its new key', () => {
  const svc = box('svc');
  const auth = group('AUTH', []);
  const link = { type: 'link', src: 'svc', arrow: '->', dst: 'db', label: '' };
  const t = [svc, box('db'), auth, link];

  assert.equal(moveInto(t, svc, auth.children, 0), true);
  assert.deepEqual(auth.children, [svc]);
  assert.equal(link.src, 'AUTH.svc');
  assert.equal(link.dst, 'db', 'an unrelated key must not move');
});

test('dragging a group out carries its children’s links', () => {
  const t = [
    group('outer', [group('inner', [box('x')])]),
    { type: 'link', src: 'outer.inner.x', arrow: '->', dst: 'outer.inner', label: '' },
  ];
  const inner = t[0].children[0];
  const link = t[1];
  assert.equal(moveInto(t, inner, t, 0), true);
  assert.equal(link.src, 'inner.x');
  assert.equal(link.dst, 'inner');
});

test('renaming a box repoints everything aimed at it', () => {
  const t = [
    box('api'), box('db'),
    { type: 'link', src: 'api', arrow: '->', dst: 'db', label: '' },
    { type: 'style', target: 'api', prop: 'fill', value: '#eee' },
  ];
  assert.equal(renameKey(t, 'api', 'gateway'), true);
  assert.equal(t[2].src, 'gateway');
  assert.equal(t[2].dst, 'db', 'an unrelated key must not move');
  assert.equal(t[3].target, 'gateway');
});

test('renaming a group carries its whole subtree', () => {
  const t = [
    group('AUTH', [
      box('svc'),
      { type: 'link', src: 'AUTH.svc', arrow: '->', dst: 'AUTH.db', label: '' },
    ]),
    { type: 'style', target: 'AUTH.svc', prop: 'fill', value: '#eee' },
    { type: 'link', src: 'AUTHORITY', arrow: '->', dst: 'AUTH', label: '' },
  ];
  assert.equal(renameKey(t, 'AUTH', 'Auth'), true);
  assert.equal(t[0].children[1].src, 'Auth.svc');
  assert.equal(t[0].children[1].dst, 'Auth.db');
  assert.equal(t[1].target, 'Auth.svc');
  assert.equal(t[2].dst, 'Auth');
  assert.equal(t[2].src, 'AUTHORITY', 'a key that merely starts with AUTH is not a child');
});

test('renaming into a name that needs quoting keeps links valid', () => {
  const t = [
    box('a'), box('b'),
    { type: 'link', src: 'a', arrow: '->', dst: 'b', label: '' },
  ];
  t[0].name = 'a.b';
  renameKey(t, 'a', '"a.b"');
  assert.match(serialize(t), /^"a\.b" -> b$/m);
});

test('renaming to the same key is a no-op', () => {
  const t = [box('a'), { type: 'link', src: 'a', arrow: '->', dst: 'a', label: '' }];
  assert.equal(renameKey(t, 'a', 'a'), false);
  assert.equal(renameKey(t, '', 'x'), false);
});

test('share links survive the round trip', async () => {
  const src = 'direction: right\nDatabase: {shape: cylinder}\n"a.b" -> Database: héllo ✨\n';
  const token = await encode(src);
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'token must be URL-safe and unpadded');
  assert.equal(await decode(token), src);
});

test('a share link is meaningfully smaller than the source', async () => {
  const src = 'x -> y\n'.repeat(200);
  assert.ok((await encode(src)).length < src.length / 4);
});

// The save format is the one thing a user can't get back if it goes wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, VERSION, toSave, fromSave, themeIds } from './settings.js';

test('a save round-trips every setting', () => {
  const settings = { ...DEFAULTS, layout: 'elk', theme: 4, look: 'flat', sketch: true, locale: 'ru' };
  const back = fromSave(toSave('a -> b\n', settings));
  assert.equal(back.src, 'a -> b\n');
  assert.deepEqual(back.settings, settings);
  assert.equal(JSON.parse(toSave('', DEFAULTS)).v, VERSION);
});

test('a value that is no longer allowed falls back to its default', () => {
  const raw = JSON.stringify({ src: '', layout: 'tala', theme: 9999, look: 'flat' });
  const { settings } = fromSave(raw);
  assert.equal(settings.layout, undefined, 'dropped, so the default stays');
  assert.equal(settings.theme, undefined);
  assert.equal(settings.look, 'flat');
});

test('a save from before versioning still loads', () => {
  assert.equal(fromSave(JSON.stringify({ src: 'x', theme: 1 })).settings.theme, 1);
});

test('nothing saved is null; an unreadable save throws for the caller to back up', () => {
  assert.equal(fromSave(null), null);
  assert.throws(() => fromSave('{not json'));
  assert.throws(() => fromSave(JSON.stringify({ layout: 'dagre' })), /not a d2-blocks save/);
  assert.throws(() => fromSave(JSON.stringify({ v: VERSION + 1, src: '' })), /newer version/);
});

test('forcing an appearance pins both theme slots', () => {
  assert.deepEqual(themeIds('system', 4, 201), { themeID: 4, darkThemeID: 201 });
  assert.deepEqual(themeIds('dark', 4, 201), { themeID: 201, darkThemeID: 201 });
  assert.deepEqual(themeIds('light', 4, 201), { themeID: 4, darkThemeID: 4 });
});

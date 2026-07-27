// Guards the two things that break a hand-maintained set of dictionaries: a key
// present in one language but not the other, and plural forms that don't cover
// what Intl.PluralRules actually asks for. Imports the plain bundles directly —
// index.svelte.js pulls in the $state store, which node --test can't run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from './en.js';
import ru from './ru.js';

const LOCALES = { en, ru };

test('every language defines the same keys', () => {
  const enUi = Object.keys(en.ui).sort();
  const ruUi = Object.keys(ru.ui).sort();
  assert.deepEqual(ruUi, enUi, 'ui keys differ between en and ru');

  assert.deepEqual(Object.keys(ru.categories).sort(), Object.keys(en.categories).sort());
  assert.deepEqual(Object.keys(ru.examples).sort(), Object.keys(en.examples).sort());
});

test('every example carries title, description, and a tag list', () => {
  for (const [id, langs] of Object.entries(LOCALES)) {
    for (const [exId, ex] of Object.entries(langs.examples)) {
      assert.ok(ex.title, `${id}/${exId}: missing title`);
      assert.ok(ex.description, `${id}/${exId}: missing description`);
      assert.ok(Array.isArray(ex.tags) && ex.tags.length, `${id}/${exId}: missing tags`);
      // en is the reference for how many tags an example has.
      assert.equal(ex.tags.length, en.examples[exId].tags.length, `${id}/${exId}: tag count`);
    }
  }
});

// Mirror index.svelte.js's plural() against the plain dicts (no store here).
const plural = (dict, locale, base, n) => {
  const form = new Intl.PluralRules(locale).select(n);
  const key = dict.ui[`${base}.${form}`] != null ? `${base}.${form}` : `${base}.other`;
  return dict.ui[key].replaceAll('{n}', n);
};

test('plural picks the right form per locale', () => {
  // Russian: 1,21 -> one; 2 -> few; 5 -> many.
  assert.equal(plural(ru, 'ru', 'examples.count', 1), '1 пример');
  assert.equal(plural(ru, 'ru', 'examples.count', 2), '2 примера');
  assert.equal(plural(ru, 'ru', 'examples.count', 5), '5 примеров');
  assert.equal(plural(ru, 'ru', 'examples.count', 21), '21 пример');
  // English: 1 -> one, everything else -> other.
  assert.equal(plural(en, 'en', 'examples.count', 1), '1 example');
  assert.equal(plural(en, 'en', 'examples.count', 3), '3 examples');
});

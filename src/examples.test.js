import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { D2 } from '@terrastruct/d2';
import { readFile, readdir } from 'node:fs/promises';
import { EXAMPLE_DEFINITIONS, EXAMPLE_CATEGORIES } from './examples/catalog.js';
import en from './i18n/en.js';
import { parse, serialize } from './blocks.js';

let d2;
before(() => { d2 = new D2(); });

const walk = (blocks) => blocks.flatMap((block) =>
  block.type === 'group' ? [block, ...walk(block.children)] : [block]);

test('the gallery contains a substantial, well-categorized example collection', () => {
  assert.ok(EXAMPLE_DEFINITIONS.length >= 20);
  assert.equal(
    new Set(EXAMPLE_DEFINITIONS.map((example) => example.id)).size,
    EXAMPLE_DEFINITIONS.length,
  );
  for (const example of EXAMPLE_DEFINITIONS) {
    assert.ok(EXAMPLE_CATEGORIES.includes(example.category), example.id);
    // Display text lives in the i18n bundle now (en is the source of truth).
    const text = en.examples[example.id];
    assert.ok(text?.title, example.id);
    assert.ok(text?.description, example.id);
    assert.ok(text?.tags.length >= 2, example.id);
  }
});

test('every example is fully editable and compiles as D2', async () => {
  const files = (await readdir(new URL('./examples/', import.meta.url)))
    .filter((file) => file.endsWith('.d2'));
  assert.deepEqual(
    files.map((file) => file.slice(0, -3)).sort(),
    EXAMPLE_DEFINITIONS.map((example) => example.id).sort(),
    'the catalog and standalone .d2 files must have a one-to-one match',
  );

  for (const example of EXAMPLE_DEFINITIONS) {
    const source = await readFile(new URL(`./examples/${example.id}.d2`, import.meta.url), 'utf8');
    const blocks = parse(source);
    assert.equal(
      walk(blocks).filter((block) => block.type === 'raw').length,
      0,
      `${example.id} contains source the block editor cannot model`,
    );
    await assert.doesNotReject(
      d2.compile(serialize(blocks), { layout: 'dagre' }),
      `${example.id} does not compile`,
    );
  }
});

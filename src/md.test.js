// The bridge's whole safety story is one property: if `rich(md)` says yes, then
// mounting the WYSIWYG and touching nothing must not change a byte. Everything
// here is that property, plus the cases that must answer no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtml, toMd, rich } from './md.js';

const ROUND_TRIPS = [
  '',
  'just a line of text',
  'two lines\nin one paragraph',
  'first para\n\nsecond para',
  '# Heading',
  '# Heading\n\nand text',
  '# H1\n\n## H2\n\n### H3',
  '**bold**',
  '*italic*',
  'text with **bold** and *italic* inline',
  '**bold with *nested italic* inside**',
  '`code span`',
  'a `code` span with **bold** after',
  '[link](https://example.com)',
  'see [the docs](https://d2lang.com) for more',
  '- one\n- two\n- three',
  '1. first\n2. second',
  '# Title\n\n- a bullet\n- another\n\nclosing text',
  'a & b < c > d',
  '"quoted" text',
  // Emphasis needs non-space on both sides, or arithmetic turns italic.
  '5 * 3 * 2',
  // Unsupported constructs are not transformed, so they survive as literal text.
  '| a | b |\n| - | - |',
  '![alt](img.png)',
  '<div>raw html</div>',
  '__underscore bold__',
];

for (const md of ROUND_TRIPS) {
  test(`round-trips: ${JSON.stringify(md).slice(0, 48)}`, () => {
    assert.equal(toMd(toHtml(md)), md);
    assert.ok(rich(md), 'rich() should accept what round-trips');
  });
}

test('rich() refuses markdown it would reformat', () => {
  // Not damage — just a different blank-line layout than the canonical one.
  // The caller shows a textarea rather than quietly rewriting the user's file.
  assert.equal(rich('# Heading\n- tight list'), false);
  assert.equal(rich('para\n\n\n\nextra blank lines'), false);
  assert.equal(rich('1. a\n1. b'), false, 'lazy numbering would be renumbered');
  assert.equal(rich('- a\n  - nested'), false, 'the toolbar has no nesting to offer');
  // Refusing is not losing: the text is all still there, just reflowed.
  assert.equal(toMd(toHtml('- a\n  - nested')), '- a\n\n  - nested');
});

test('toHtml escapes rather than emitting markup', () => {
  assert.equal(toHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.ok(!toHtml('<img onerror=x>').includes('<img'));
});

test('an unsafe link scheme stays literal text', () => {
  const html = toHtml('[click](javascript:alert(1))');
  assert.ok(!html.includes('<a'), html);
  assert.ok(html.includes('javascript:alert(1)'), 'the text itself is still preserved');
});

test('toMd survives what contenteditable actually emits', () => {
  assert.equal(toMd('<b>bold</b>'), '**bold**');
  assert.equal(toMd('<i>it</i>'), '*it*');
  assert.equal(toMd('<b></b>hi'), 'hi', 'empty formatting shells are dropped');
  assert.equal(toMd('<div>one</div><div>two</div>'), 'one\n\ntwo');
  assert.equal(toMd('<p>a<br>b</p>'), 'a\nb');
  assert.equal(toMd('<span style="color:red">plain</span>'), 'plain');
  assert.equal(toMd('a&nbsp;b'), 'a b');
  assert.equal(toMd('<div><p>nested</p><ul><li>x</li></ul></div>'), 'nested\n\n- x');
  assert.equal(toMd('<p>stray</p></div>'), 'stray', 'a stray closer is ignored');
});

test('pasted HTML is laundered through the same subset', () => {
  // What a browser hands over on paste from a rich source.
  const pasted = '<meta charset="utf-8"><h1>Title</h1><p>Some <b>bold</b> text.</p>';
  const md = toMd(pasted);
  assert.equal(md, '# Title\n\nSome **bold** text.');
  assert.ok(rich(md), 'the laundered result is editable');
});

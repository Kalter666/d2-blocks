// sanitize.test.js pins the attribute policy; the DOM walk that applies it needs
// a browser, so it lives here. Replaces the old root-level xss-check.mjs, which
// printed what d2 lets through and asserted nothing.
import { test, expect } from '@playwright/test';
import { open, source } from './helpers.js';

test('raw HTML in a pasted markdown label never runs', async ({ page }) => {
  await open(page);
  const busy = page.locator('.busy');
  await source(page).fill([
    'x: |md',
    '  <img src="y" onerror="window.__xss = 1" />',
    '  <a href="javascript:window.__xss = 2">go</a>',
    '|',
  ].join('\n'));
  await expect(busy).toHaveCount(1);
  await expect(busy).toHaveCount(0, { timeout: 20_000 });

  const html = await page.locator('.paper').innerHTML();
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('javascript:');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the DOM walk strips tags, handlers and SMIL that writes a URL', async ({ page }) => {
  await open(page);
  // Vite serves the real module, so this is the code the canvas runs.
  const out = await page.evaluate(async () => {
    const { sanitize } = await import('/d2-blocks/src/sanitize.js');
    return sanitize(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <script>1</script>
      <a xlink:href="#ok"><set attributeName="href" to="javascript:1"/><text>t</text></a>
      <rect onload="1" fill="#fff"><animate attributeName="opacity" to="0.5"/></rect>
    </svg>`);
  });
  expect(out).not.toContain('<script');
  expect(out).not.toContain('<set');
  expect(out).not.toContain('onload');
  expect(out).toContain('<animate'); // harmless animation survives
  expect(out).toContain('fill="#fff"');
});

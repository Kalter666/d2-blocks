import { test, expect } from '@playwright/test';
import { open, source, addBox, control } from './helpers.js';

test.beforeEach(async ({ page }) => open(page));

test('add and edit a box shows up in the d2 source', async ({ page }) => {
  const box = await addBox(page, 'api');
  await box.getByPlaceholder('same as name').fill('API');
  await box.getByRole('combobox').selectOption('cylinder'); // the "shaped" select
  await expect(source(page)).toHaveValue(/api: API \{shape: cylinder\}/);
});

test('connecting two boxes emits an edge', async ({ page }) => {
  await addBox(page, 'a');
  await addBox(page, 'b');
  await page.getByRole('button', { name: '+ connect' }).click();
  await expect(source(page)).toHaveValue(/a -> b/);
});

test('the d2 source drawer can be resized from its top edge', async ({ page }) => {
  const footer = page.locator('footer');
  const resizer = page.getByRole('button', { name: 'Resize d2 source' });
  const before = await footer.boundingBox();
  const handle = await resizer.boundingBox();

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 80);
  await page.mouse.up();

  const after = await footer.boundingBox();
  expect(after.height).toBeGreaterThan(before.height + 60);

  await resizer.focus();
  await resizer.press('ArrowDown');
  await expect.poll(async () => (await footer.boundingBox()).height).toBeLessThan(after.height);
});

test('an existing markdown link can be edited without navigating away', async ({ page }) => {
  const box = await addBox(page, 'docs');
  await box.getByTitle('Rich text label (markdown)').click();
  await box.getByTitle('Open description').click();
  const editor = box.getByRole('textbox', { name: 'Rich text' });
  const linkButton = box.getByTitle('Link');
  await editor.fill('Read the docs');

  await editor.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode()) && !text.data.includes('docs'));
    const start = text.data.indexOf('docs');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 4);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  page.once('dialog', (dialog) => dialog.accept('https://example.com/old'));
  await linkButton.click();
  await expect(source(page)).toHaveValue(/\[docs\]\(https:\/\/example\.com\/old\)/);

  const anchor = editor.locator('a');
  await anchor.click();
  await expect(page).toHaveURL(/\/$/);
  await anchor.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  let promptDefault;
  page.once('dialog', (dialog) => {
    promptDefault = dialog.defaultValue();
    return dialog.accept('https://example.com/new');
  });
  await linkButton.click();

  expect(promptDefault).toBe('https://example.com/old');
  await expect(source(page)).toHaveValue(/\[docs\]\(https:\/\/example\.com\/new\)/);
  await expect(source(page)).not.toHaveValue(/example\.com\/old/);
  await expect(editor.locator('a')).toHaveCount(1);
});

test('styling a box emits a style block', async ({ page }) => {
  await addBox(page, 'a');
  await page.getByRole('button', { name: '+ style' }).click();
  await expect(source(page)).toHaveValue(/a\.style\.fill/);
});

test('deleting a box removes it from the source', async ({ page }) => {
  await addBox(page, 'gone');
  await expect(source(page)).toHaveValue(/gone/);
  await page.locator('.block.box').last().getByTitle('Delete this block').click();
  await expect(page.locator('.block.box')).toHaveCount(0);
  await expect(source(page)).not.toHaveValue(/gone/);
});

test('connect and style are disabled with no blocks', async ({ page }) => {
  await expect(page.getByRole('button', { name: '+ connect' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '+ style' })).toBeDisabled();
});

test('two same-named boxes warn about merging', async ({ page }) => {
  await addBox(page, 'x');
  await addBox(page, 'x');
  await expect(page.getByText(/will merge them/).first()).toBeVisible();
});

test('the canvas renders an svg (WASM path)', async ({ page }) => {
  await control(page, 'look').selectOption('flat');
  await addBox(page, 'render');
  await expect(page.locator('.paper svg').first()).toBeVisible(); // d2 nests an inner svg

  await expect(page.getByTitle('Reset to 100%')).toBeVisible();
});

// Regression: editing before the cold ~6 MB compile settled used to race the
// single shared d2 worker and blank the canvas with a parse error. This test
// deliberately skips open()'s idle wait and acts immediately.
test('editing during the cold render does not corrupt the canvas', async ({ page }) => {
  await page.goto('/');
  await control(page, 'look').selectOption('flat');
  await page.getByRole('button', { name: '+ box' }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.canvas .error')).toHaveCount(0);
  await expect(page.locator('.paper svg').first()).toBeVisible();
});

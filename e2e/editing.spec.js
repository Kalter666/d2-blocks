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

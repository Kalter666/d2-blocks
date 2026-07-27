import { test, expect } from '@playwright/test';
import { open, source, addBox, control } from './helpers.js';

test.beforeEach(async ({ page }) => open(page));

test('pasted d2 becomes blocks', async ({ page }) => {
  await source(page).fill('a -> b\nc: Hi');
  // `a -> b` parses to a connection (endpoints stay implicit, not box blocks);
  // `c: Hi` is the one explicit box.
  await expect(page.locator('.block.link')).toHaveCount(1);
  await expect(page.locator('.block.box')).toHaveCount(1);
  await expect(page.locator('.block.box').getByPlaceholder('name', { exact: true })).toHaveValue('c');
});

test('undo/redo buttons track history', async ({ page }) => {
  const undo = page.getByTitle('Undo (Ctrl+Z)');
  const redo = page.getByTitle('Redo (Ctrl+Shift+Z)');
  await expect(undo).toBeDisabled();

  await page.getByRole('button', { name: '+ box' }).click(); // unnamed: one history entry
  await expect(page.locator('.block.box')).toHaveCount(1);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(page.locator('.block.box')).toHaveCount(0);

  await redo.click();
  await expect(page.locator('.block.box')).toHaveCount(1);
});

test('keyboard undo/redo', async ({ page }) => {
  await page.getByRole('button', { name: '+ box' }).click(); // focus stays on the button, not an input
  await expect(page.locator('.block.box')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.block.box')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.block.box')).toHaveCount(1);
});

test('changing flow direction updates the source', async ({ page }) => {
  await control(page, 'flow').selectOption('up');
  await expect(source(page)).toHaveValue(/direction: up/);
});

test('toggling layout, sketch and look keeps rendering without error', async ({ page }) => {
  await addBox(page, 'a');
  await control(page, 'layout').selectOption('elk');
  await page.locator('header label:has-text("sketch") input').check();
  await control(page, 'look').selectOption('flat');
  await expect(page.locator('.canvas.mode3d')).toHaveCount(0);
  await expect(page.locator('.paper svg').first()).toBeVisible();
  await expect(page.locator('.canvas .error')).toHaveCount(0);

  await control(page, 'look').selectOption('3d');
  await expect(page.locator('.canvas.mode3d')).toBeVisible();
});

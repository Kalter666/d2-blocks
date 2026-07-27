import { test, expect } from '@playwright/test';
import { open, source } from './helpers.js';

test.beforeEach(async ({ page }) => open(page));

const FLOWCHART = 'flowchart TD\n A[(DB)] --> B{Go}';

test('examples: load one into the editor', async ({ page }) => {
  await page.getByRole('button', { name: /Examples/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /Three-tier web app/ }).click();
  await dialog.getByRole('button', { name: 'Use this example' }).click();

  await expect(dialog).toBeHidden();
  await expect(source(page)).toHaveValue(/Redis cache/);
});

test('examples: search filters the list, Esc closes', async ({ page }) => {
  await page.getByRole('button', { name: /Examples/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Search examples…').fill('chat');
  // Assert on the result cards (buttons); the preview pane keeps showing the
  // previously-selected title even when it's filtered out of the list.
  await expect(dialog.getByRole('button', { name: /Real-time chat/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Three-tier web app/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('mermaid: import a flowchart', async ({ page }) => {
  await page.getByRole('button', { name: 'Import Mermaid' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Mermaid source' }).fill(FLOWCHART);

  await expect(dialog.locator('.preview svg').first()).toBeVisible(); // fromMermaid -> serialize -> draw
  await dialog.getByRole('button', { name: 'Import' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('mermaid imported')).toBeVisible();
  await expect(source(page)).toHaveValue(/shape: cylinder/);
  await expect(source(page)).toHaveValue(/shape: diamond/);
});

test('mermaid: non-flowchart is rejected', async ({ page }) => {
  await page.getByRole('button', { name: 'Import Mermaid' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Mermaid source' }).fill('sequenceDiagram\n A->>B: hi');

  // Scope to the preview error span — the dialog header also contains "flowchart".
  await expect(dialog.locator('.preview-message.error')).toContainText(/flowchart/);
  await expect(dialog.getByRole('button', { name: 'Import' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(source(page)).toHaveValue(/direction: right/); // untouched
});

test('mermaid: import is undoable', async ({ page }) => {
  await page.getByRole('button', { name: 'Import Mermaid' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Mermaid source' }).fill(FLOWCHART);
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(source(page)).toHaveValue(/shape: cylinder/);

  await page.keyboard.press('Control+z');
  await expect(source(page)).not.toHaveValue(/shape: cylinder/);
});

test('clipboard: Copy d2 and Copy Mermaid', async ({ page }) => {
  await page.getByRole('button', { name: 'Copy d2' }).click();
  await expect(page.getByText('d2 copied to clipboard')).toBeVisible();
  const d2 = await page.evaluate(() => navigator.clipboard.readText());
  expect(d2).toBe(await source(page).inputValue());

  await page.getByRole('button', { name: 'Copy Mermaid' }).click();
  await expect(page.getByText('mermaid copied to clipboard')).toBeVisible();
  const mm = await page.evaluate(() => navigator.clipboard.readText());
  expect(mm).toMatch(/^flowchart/);
});

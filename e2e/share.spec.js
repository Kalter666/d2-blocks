// `#d2=` links: what the MCP server's open_in_editor hands out. Encoded here
// with the app's own share.js, so both ends are the same code.
import { test, expect, source } from './helpers.js';
import { encode } from '../src/share.js';

const boot = async (page, hash) => {
  await page.goto(`./${hash}`);
  await expect(page.getByRole('button', { name: '+ box' })).toBeVisible();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 20_000 });
};

test('a link opens its diagram, undoably, and leaves the URL clean', async ({ cold: page }) => {
  await boot(page, await encode('shared -> diagram: from a link\n'));
  await expect(source(page)).toHaveValue('shared -> diagram: from a link\n');
  await expect(page.locator('.paper > svg')).toContainText('from a link');
  // Dropped, so a reload doesn't import it again over later edits.
  expect(new URL(page.url()).hash).toBe('');

  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(source(page)).not.toHaveValue(/shared -> diagram/);
});

test('a broken link says so and leaves the diagram alone', async ({ cold: page }) => {
  await boot(page, '#d2=definitely-not-deflate');
  await expect(page.getByText(/the link could not be opened/)).toBeVisible();
  await expect(source(page)).toHaveValue('direction: right\n');
});

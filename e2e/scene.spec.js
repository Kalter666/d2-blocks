// Guards for contracts the 3D view and the canvas lean on, each of which an
// innocent-looking edit could break with no page error to show for it.
import { test, expect, open, source, control, drawn, paste } from './helpers.js';

test('in 3D the SVG stays mounted, because the scene reads colours off it', async ({ page }) => {
  await control(page, 'look').selectOption('3d');
  await drawn(page, () => source(page).fill('a -> b'));
  // Rendering it only in flat mode looks like a harmless optimisation; it turns
  // every 3D colour into the fallback and breaks Download SVG.
  await expect(page.locator('.paper > svg')).toHaveCount(1);
  await expect(page.locator('.stage canvas')).toBeVisible();
});

test('hovering a block lights its shape on the canvas, and the nth duplicate link its own', async ({ page }) => {
  await control(page, 'look').selectOption('flat');
  await drawn(page, () => source(page).fill('a -> b: first\na -> b: second'));
  const links = page.locator('.block.link');
  await expect(links).toHaveCount(2);

  await links.nth(1).hover();
  await expect(page.locator('.paper g.lit')).toHaveCount(1);
  // Decoded with the app's own ids.js, as the canvas does.
  const lit = await page.evaluate(async () => {
    const { decodeId } = await import('/d2-blocks/src/ids.js');
    return decodeId(document.querySelector('.paper g.lit').getAttribute('class').split(' ')[0]);
  });
  expect(lit).toBe('(a -> b)[1]');
});

test('?gallery never touches the saved diagram', async ({ cold: page }) => {
  await open(page);
  await drawn(page, () => source(page).fill('mine -> kept'));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('d2-blocks'))).toContain('mine -> kept');
  const before = await page.evaluate(() => localStorage.getItem('d2-blocks'));

  await page.goto('./?gallery');
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(500); // past the autosave debounce
  expect(await page.evaluate(() => localStorage.getItem('d2-blocks'))).toBe(before);
});

test('Download SVG hands over the rendered diagram', async ({ page }) => {
  await drawn(page, () => source(page).fill('x -> y'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('diagram.svg');
});

test('when dagre crashes, the error says to switch to elk, and elk draws it', async ({ page }) => {
  // Links between nested containers: dagre panics on this from ~100 shapes.
  let src = '';
  for (let g = 0; g < 10; g++) src += `svc${g}: {\n${Array.from({ length: 10 }, (_, i) => `  n${i}\n`).join('')}}\n`;
  for (let g = 0; g < 10; g++) for (let i = 0; i < 10; i++) src += `svc${g}.n${i} -> svc${(g * 7 + i * 3 + 1) % 10}.n${(i + 1) % 10}\n`;
  await control(page, 'look').selectOption('flat');
  await drawn(page, () => paste(page, src));
  await expect(page.locator('.canvas .error')).toContainText('Switch layout to elk');

  await drawn(page, () => control(page, 'layout').selectOption('elk'));
  await expect(page.locator('.canvas .error')).toHaveCount(0);
  await expect(page.locator('.paper > svg')).toBeVisible();
});

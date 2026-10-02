// Re-records docs/demo.gif, the README's demo. Needs the dev server on 5199 and ffmpeg:
//
//   npx vite --port 5199 --strictPort &
//   node scripts/record-demo.mjs /tmp/demo
//   ffmpeg -i /tmp/demo/*.webm -vf "select='gte(t\,1.2)',setpts=N/FRAME_RATE/TB,fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif
//
// The camera keeps its place across rebuilds, so the moment the example loads
// it sits close-up on the old framing; cut that stretch out with another
// not(between(t,…)) term in the select. Headless Chrome uses the real GPU via
// the launch flags — without them WebGL is software and every orbit crawls.
import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const size = { width: 1280, height: 760 };
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: size, recordVideo: { dir: OUT, size } });
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const idle = async () => {
  await wait(250);
  await page.locator('.busy').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
};

await page.goto('http://localhost:5199/d2-blocks/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole('button', { name: '+ box' }).waitFor();
await idle();
await wait(800);

// Build a two-box diagram from blocks.
async function box(name, shape) {
  await page.getByRole('button', { name: '+ box' }).click();
  const b = page.locator('.block.box').last();
  const input = b.getByPlaceholder('name', { exact: true });
  await input.fill('');
  await input.pressSequentially(name, { delay: 70 });
  if (shape) { await wait(300); await b.getByRole('combobox').selectOption(shape); }
  await idle();
  await wait(700);
}
await box('web', 'rectangle');
await box('api', 'hexagon');
await box('db', 'cylinder');
await page.getByRole('button', { name: '+ connect' }).click();
await idle();

const canvas = page.locator('.stage canvas');
/** Frame the model, then push in so it fills the view. */
async function frame(clicks) {
  await page.locator('.stage .reset').click();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < clicks; i++) { await page.mouse.wheel(0, -120); await wait(60); }
  await wait(700);
}
await frame(2);

// Orbit the 3D view.
async function orbit(dx, dy, steps = 30) {
  const b = await canvas.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
  await wait(600);
}
await orbit(220, -40);

// Load a bigger example from the gallery.
await page.getByRole('button', { name: /Examples/ }).click();
await wait(600);
await page.getByPlaceholder(/Search examples/).pressSequentially('rag', { delay: 90 });
await wait(600);
await page.locator('.dialog button', { hasText: 'Retrieval-augmented' }).first().click();
await wait(1800);
await page.getByRole('button', { name: 'Use this example' }).click();
await idle();
await wait(1500);
await frame(1);
await orbit(-260, 30, 50);
await orbit(160, -20, 30);

// Flat look, then back to 3D.
await page.locator('header label:has-text("look") select').selectOption('flat');
await idle();
await wait(1800);
await page.locator('header label:has-text("look") select').selectOption('3d');
await idle();
await wait(400);
await frame(1);
await orbit(120, -30, 30);
await wait(800);

await context.close();
await browser.close();

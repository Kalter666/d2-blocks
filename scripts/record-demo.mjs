// Re-records docs/demo.gif, the README's demo. Needs the dev server on 5199 and ffmpeg:
//
//   npx vite --port 5199 --strictPort &
//   node scripts/record-demo.mjs /tmp/demo
//   ffmpeg -i /tmp/demo/*.webm -vf "select='gte(t\,1.2)',setpts=N/FRAME_RATE/TB,fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif
//
// Headless Chrome uses the real GPU via the launch flags — without them WebGL is
// software and every orbit crawls. The 3D camera deliberately keeps its place
// across rebuilds, so after each wholesale change (paste, import, example) the
// new diagram shows for ~1 s through the old framing before the script reframes.
// Cut those stretches with extra not(between(t,a,b)) terms in the select — find
// them with a contact sheet (fps=10,tile=…). Names are set with fill(), not
// typed: each keystroke is a new layout and rebuild, which made objects blink.
import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const size = { width: 1280, height: 760 };
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({
  viewport: size, recordVideo: { dir: OUT, size },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const idle = async () => {
  await wait(250);
  await page.locator('.busy').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
};
const canvas = page.locator('.stage canvas');
const pane = page.getByRole('textbox', { name: 'd2 source' });

/** Frame the model, then push in so it fills the view. */
async function frame(clicks) {
  await page.locator('.stage .reset').click();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < clicks; i++) { await page.mouse.wheel(0, -120); await wait(60); }
  await wait(600);
}
async function orbit(dx, dy, steps = 30) {
  const b = await canvas.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
  await wait(500);
}
/** Paste through the real clipboard, the way a person would. */
async function paste(target, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await target.click();
  await page.keyboard.press('Control+A');
  await wait(250);
  await page.keyboard.press('Control+V');
}

await page.goto('http://localhost:5199/d2-blocks/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole('button', { name: '+ box' }).waitFor();
await idle();
await wait(600);

// 1. Blocks → d2 → 3D.
async function box(name, shape) {
  await page.getByRole('button', { name: '+ box' }).click();
  const b = page.locator('.block.box').last();
  // One edit, not a keystroke at a time: every keystroke is a new d2 layout and
  // 3D rebuild, so typed names made the objects jump and blink.
  await b.getByPlaceholder('name', { exact: true }).fill(name);
  await wait(250);
  await b.getByRole('combobox').selectOption(shape);
  await idle();
  await wait(450);
}
await box('web', 'rectangle');
await box('api', 'hexagon');
await box('db', 'cylinder');
await page.getByRole('button', { name: '+ connect' }).click();
await idle();
await frame(2);
await orbit(220, -40);

// 2. Paste d2 straight into the source pane — the blocks follow.
await paste(pane, `orders: {
  shape: sql_table
  id: int {constraint: primary_key}
  user_id: int {constraint: foreign_key}
  total: decimal
}
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  email: string {constraint: unique}
}
api: Orders API {
  shape: hexagon
  style.fill: "#c0392b"
}
orders.user_id -> users.id
api -> orders: writes`);
await wait(900);
await pane.blur();
await idle();
await wait(200);
await frame(1);
await orbit(-180, -30);

// 3. Paste a mermaid flowchart into the importer.
await page.getByRole('button', { name: 'Import Mermaid' }).click();
await wait(400);
await paste(page.getByRole('textbox', { name: 'Mermaid source' }), `flowchart LR
  user((User)) --> web[Web app]
  web --> auth{Signed in?}
  auth -->|yes| api[API]
  auth -->|no| login[Login]
  api --> db[(Database)]
  api --> queue[[Jobs]]`);
await wait(1800);
await page.getByRole('button', { name: 'Import', exact: true }).click();
await idle();
await wait(200);
await frame(1);
await orbit(200, -20);

// 4. Out again as d2.
await page.getByRole('button', { name: 'Copy d2' }).click();
await wait(1300);

// 5. A bigger example from the gallery, then the flat look and back.
await page.getByRole('button', { name: /Examples/ }).click();
await wait(500);
await page.getByPlaceholder(/Search examples/).pressSequentially('rag', { delay: 70 });
await wait(400);
await page.locator('.dialog button', { hasText: 'Retrieval-augmented' }).first().click();
await wait(1200);
await page.getByRole('button', { name: 'Use this example' }).click();
await idle();
await wait(200);
await frame(1);
await orbit(-240, 30, 40);

const look = page.locator('header label:has-text("look") select');
await look.selectOption('flat');
await idle();
await wait(1600);
await look.selectOption('3d');
await idle();
await wait(300);
await frame(1);
await orbit(120, -30);
await wait(500);

await context.close();
await browser.close();

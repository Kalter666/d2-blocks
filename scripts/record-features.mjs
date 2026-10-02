// Records one short GIF per feature into docs/features/, for docs/FEATURES.md.
// Needs the dev server on 5199 and ffmpeg on PATH:
//
//   npx vite --port 5199 --strictPort &
//   node scripts/record-features.mjs            # every feature
//   node scripts/record-features.mjs styles 3d  # just these
//
// Each feature runs in a fresh browser context, seeded through the app's own
// localStorage save so the setup isn't on camera. Headless Chrome uses the real
// GPU via the launch flags; without them WebGL is software and orbits crawl.
// Names are set with fill(), never typed: every keystroke is a new d2 layout and
// 3D rebuild, which reads as flicker in a GIF.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, renameSync } from 'node:fs';

const URL = 'http://localhost:5199/d2-blocks/';
const OUT = 'docs/features';
const TMP = `${OUT}/.raw`;
const size = { width: 1280, height: 760 };

// ------------------------------------------------------------------ helpers

const wait = (page, ms) => page.waitForTimeout(ms);

// Spans of the recording to cut, in seconds since the page opened. Anything
// done inside offCamera() — a tooltip hunt, the rebuild after a wholesale load
// before the camera is reframed — is left out of the GIF.
let clock = 0;
const cuts = [];
async function offCamera(fn) {
  const from = (Date.now() - clock) / 1000;
  const result = await fn();
  cuts.push([from, (Date.now() - clock) / 1000]);
  return result;
}
/** Wait for a wholesale change to draw, and reframe, all off camera. */
const settle = (page, clicks = 1) => offCamera(async () => { await idle(page); await frame(page, clicks); });
async function idle(page) {
  await wait(page, 250);
  await page.locator('.busy').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
}
const canvas = (page) => page.locator('.stage canvas');
const pane = (page) => page.getByRole('textbox', { name: 'd2 source' });
// By the label's own leading word: has-text would also match option text ("light").
const control = (page, label) => page.locator('header label')
  .filter({ hasText: new RegExp(`^\\s*${label}`) }).locator('select');

/** Frame the model, then push in. */
async function frame(page, clicks = 1) {
  await page.locator('.stage .reset').click();
  const b = await canvas(page).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < clicks; i++) { await page.mouse.wheel(0, -120); await wait(page, 50); }
  await wait(page, 500);
}
async function orbit(page, dx, dy, steps = 30) {
  const b = await canvas(page).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
  await wait(page, 400);
}
async function paste(page, target, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await target.click();
  await page.keyboard.press('Control+A');
  await wait(page, 200);
  await page.keyboard.press('Control+V');
}
async function addBox(page, name, shape) {
  await page.getByRole('button', { name: '+ box' }).click();
  const b = page.locator('.block.box').last();
  await b.getByPlaceholder('name', { exact: true }).fill(name);
  if (shape) { await wait(page, 200); await b.getByRole('combobox').selectOption(shape); }
  await idle(page);
  await wait(page, 400);
  return b;
}
/** Native drag and drop, as the e2e suite does it — Playwright's mouse never fires dragstart. */
async function drag(page, fromSel, toSel) {
  await page.evaluate(({ fromSel, toSel }) => {
    const src = document.querySelector(fromSel), tgt = document.querySelector(toSel);
    const dataTransfer = new DataTransfer();
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    fire(src, 'dragstart'); fire(tgt, 'dragenter'); fire(tgt, 'dragover'); fire(tgt, 'drop'); fire(src, 'dragend');
  }, { fromSel, toSel });
}
/** Sweep the canvas until a tooltip shows; the cursor itself isn't in the video. */
async function pointAtTooltip(page) {
  const b = await canvas(page).boundingBox();
  for (let y = 30; y < b.height - 30; y += 14) {
    for (let x = 30; x < b.width - 30; x += 14) {
      await page.mouse.move(b.x + x, b.y + y);
      if (await page.locator('.stage .tip').count()) return { x: b.x + x, y: b.y + y };
    }
  }
  return null;
}

const ICON = 'https://cdn.jsdelivr.net/npm/simple-icons@11/icons/postgresql.svg';

// ----------------------------------------------------------------- features

const FEATURES = {
  blocks: {
    async run(page) {
      await addBox(page, 'web', 'rectangle');
      await addBox(page, 'db', 'cylinder');
      await page.getByRole('button', { name: '+ connect' }).click();
      await idle(page);
      await page.locator('.block.link').last().getByPlaceholder('nothing').fill('queries');
      await idle(page);
      await frame(page, 2);
      await orbit(page, 160, -30);
      await wait(page, 600);
    },
  },

  source: {
    seed: 'web\ndb: {shape: cylinder}\nweb -> db\n',
    async run(page) {
      await wait(page, 600);
      await paste(page, pane(page), `direction: right
user: Customer {shape: person}
web: Storefront
api: Orders API {shape: hexagon}
db: Orders {shape: cylinder}
queue: Events {shape: queue}
user -> web -> api -> db
api -> queue: publishes`);
      await wait(page, 1200);
      await pane(page).blur();
      await settle(page);
      await orbit(page, -160, -20);
      await wait(page, 600);
    },
  },

  connections: {
    seed: 'web\napi\ncache\ndb: {shape: cylinder}\nweb -> api\n',
    async run(page) {
      await wait(page, 600);
      await frame(page, 1);
      const link = page.locator('.block.link').last();
      const [src, arrow, dst] = [0, 1, 2].map((i) => link.locator('select').nth(i));
      await dst.selectOption('db'); await idle(page); await wait(page, 500);
      await arrow.selectOption('<->'); await idle(page); await wait(page, 500);
      await page.getByRole('button', { name: '+ connect' }).click(); await idle(page);
      const second = page.locator('.block.link').last();
      await second.locator('select').nth(0).selectOption('api');
      await second.locator('select').nth(2).selectOption('cache');
      await second.getByPlaceholder('nothing').fill('reads');
      await idle(page);
      await frame(page, 1);
      await wait(page, 900);
      void src;
    },
  },

  shapes: {
    seed: 'thing: Thing\n',
    async run(page) {
      await frame(page, 3);
      const select = page.locator('.block.box').first().getByRole('combobox');
      for (const shape of ['cylinder', 'queue', 'person', 'cloud', 'diamond', 'stored_data', 'page']) {
        await select.selectOption(shape);
        await idle(page);
        await frame(page, 3);
        await wait(page, 500);
      }
    },
  },

  groups: {
    seed: 'Backend: {\n  API\n}\nWorker\nDatabase: {shape: cylinder}\nBackend.API -> Database\n',
    async run(page) {
      await frame(page, 1);
      await wait(page, 700);
      // Worker is the second top-level box; drop it into Backend's children.
      await drag(page, '.stack > .block.box:nth-of-type(2)', '.block.group .children .stack');
      await idle(page);
      await wait(page, 300);
      await frame(page, 1);
      await orbit(page, 180, -40);
      await wait(page, 600);
    },
  },

  styles: {
    seed: 'api: Orders API\ndb: {shape: cylinder}\napi -> db\n',
    async run(page) {
      await frame(page, 2);
      await page.getByRole('button', { name: '+ style' }).click();
      await idle(page); await wait(page, 300);
      const style = page.locator('.block.style').last();
      await style.getByLabel(/colour/).evaluate((el) => {
        el.value = '#e11d48';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await idle(page); await wait(page, 700);
      await page.getByRole('button', { name: '+ style' }).click();
      await idle(page);
      const second = page.locator('.block.style').last();
      await second.locator('select').nth(1).selectOption('animated');
      await idle(page); await wait(page, 300);
      await page.getByRole('button', { name: '+ style' }).click();
      await idle(page);
      const third = page.locator('.block.style').last();
      await third.locator('select').nth(0).selectOption('db');
      await third.locator('select').nth(1).selectOption('fill-pattern');
      await idle(page);
      await frame(page, 2);
      await orbit(page, 140, -20);
      await wait(page, 900);
    },
  },

  'rich-text': {
    seed: 'Notes\napi\nNotes -> api\n',
    async run(page) {
      await frame(page, 1);
      const box = page.locator('.block.box').first();
      await box.getByTitle('Rich text label (markdown)').click();
      await box.getByTitle('Open description').click().catch(() => {});
      const editor = box.getByRole('textbox', { name: 'Rich text' });
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Payment flow', { delay: 40 });
      await box.getByTitle('Heading', { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await box.getByTitle('Bullet list').click();
      await page.keyboard.type('charges the card', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('emails a receipt', { delay: 30 });
      await idle(page);
      await wait(page, 600);
      await control(page, 'look').selectOption('flat');
      await idle(page);
      await wait(page, 1500);
    },
  },

  '3d': {
    example: 'Three-tier web app',
    async run(page) {
      await frame(page, 2);
      await orbit(page, 260, 30, 50);
      const b = await canvas(page).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await wait(page, 80); }
      await orbit(page, -220, 20, 50);
      await wait(page, 600);
    },
  },

  hover: {
    seed: 'web\napi: {shape: hexagon}\ndb: {shape: cylinder}\nweb -> api -> db\n',
    async run(page) {
      await frame(page, 2);
      for (const i of [0, 1, 2]) {
        await page.locator('.block.box').nth(i).hover();
        await wait(page, 900);
      }
      await page.mouse.move(5, 5);
      await control(page, 'look').selectOption('flat');
      await idle(page);
      for (const i of [0, 1, 2]) {
        await page.locator('.block.box').nth(i).hover();
        await wait(page, 700);
      }
    },
  },

  layout: {
    seed: 'user: {shape: person}\nweb\napi\ndb: {shape: cylinder}\ncache\nuser -> web -> api -> db\napi -> cache\n',
    look: 'flat',
    async run(page) {
      await wait(page, 700);
      await control(page, 'flow').selectOption('down'); await idle(page); await wait(page, 900);
      await control(page, 'layout').selectOption('elk'); await idle(page); await wait(page, 900);
      await page.getByLabel('sketch').check(); await idle(page); await wait(page, 1200);
      await page.getByLabel('sketch').uncheck(); await idle(page);
      await control(page, 'look').selectOption('3d'); await idle(page);
      await frame(page, 1);
      await wait(page, 900);
    },
  },

  themes: {
    seed: 'user: {shape: person}\nweb\napi: {shape: hexagon}\ndb: {shape: cylinder}\nuser -> web -> api -> db\n',
    look: 'flat',
    async run(page) {
      await wait(page, 600);
      for (const id of ['4', '5', '100', '300']) {
        await control(page, 'light').selectOption(id); await idle(page); await wait(page, 700);
      }
      for (const id of ['200', '201']) {
        await control(page, 'dark').selectOption(id); await idle(page); await wait(page, 700);
      }
      await control(page, 'look').selectOption('3d'); await idle(page);
      await frame(page, 2);
      await wait(page, 700);
      await control(page, 'appearance').selectOption('light'); await idle(page); await wait(page, 900);
    },
  },

  examples: {
    async run(page) {
      await page.getByRole('button', { name: /Examples/ }).click();
      await wait(page, 700);
      await page.getByRole('button', { name: 'Distributed systems' }).click(); await wait(page, 700);
      await page.getByPlaceholder(/Search examples/).pressSequentially('saga', { delay: 70 });
      await wait(page, 600);
      await page.locator('.dialog .list button, .dialog button').filter({ hasText: /saga/i }).first().click();
      await wait(page, 1600);
      await page.getByRole('button', { name: 'Use this example' }).click();
      await settle(page);
      await orbit(page, -200, -20);
      await wait(page, 600);
    },
  },

  mermaid: {
    async run(page) {
      await page.getByRole('button', { name: 'Import Mermaid' }).click();
      await wait(page, 400);
      await paste(page, page.getByRole('textbox', { name: 'Mermaid source' }), `flowchart LR
  user((User)) --> web[Web app]
  web --> auth{Signed in?}
  auth -->|yes| api[API]
  auth -->|no| login[Login]
  api --> db[(Database)]
  api --> queue[[Jobs]]`);
      await wait(page, 1800);
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await settle(page);
      await wait(page, 600);
      await page.getByRole('button', { name: 'Copy Mermaid' }).click();
      await wait(page, 1500);
    },
  },

  export: {
    seed: 'web\napi: {shape: hexagon}\ndb: {shape: cylinder}\nweb -> api -> db\n',
    look: 'flat',
    async run(page) {
      await wait(page, 600);
      await page.getByRole('button', { name: 'Copy d2' }).click(); await wait(page, 1300);
      await page.getByRole('button', { name: 'Copy Mermaid' }).click(); await wait(page, 1300);
      await page.getByRole('button', { name: 'Download SVG' }).click(); await wait(page, 1000);
    },
  },

  undo: {
    seed: 'web\napi\nweb -> api\n',
    async run(page) {
      await frame(page, 2);
      await addBox(page, 'db', 'cylinder');
      await page.locator('.block.box').first().getByTitle('Delete this block').click();
      await idle(page); await wait(page, 700);
      for (let i = 0; i < 2; i++) { await page.getByTitle(/^Undo/).click(); await idle(page); await wait(page, 700); }
      await page.getByTitle(/^Redo/).click(); await idle(page); await wait(page, 900);
    },
  },

  boards: {
    seed: `web
api
db: {shape: cylinder}
web -> api -> db
layers: {
  internals: {
    api: {shape: hexagon}
    cache
    queue: {shape: queue}
    api -> cache
    api -> queue
  }
}
scenarios: {
  outage: {
    db.style.opacity: 0.25
    api -> db: retries {style.stroke-dash: 4}
  }
}
steps: {
  "1": {
    web
  }
  "2": {
    web -> api
  }
}
`,
    async run(page) {
      await frame(page, 2);
      const board = control(page, 'board');
      for (const path of ['layers.internals', 'scenarios.outage', 'steps.1', 'steps.2', '']) {
        await board.selectOption(path);
        await settle(page, 2);
        await wait(page, 600);
      }
    },
  },

  'special-shapes': {
    seed: `direction: right
Order: {
  shape: class
  +id: int
  -total: float
  "place()": bool
}
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  email: string {constraint: unique}
}
code: |go
  fmt.Println("hi")
|
math: |latex
  E = mc^2
|
pg: Postgres {
  icon: ${ICON}
  tooltip: the primary database
}
Order -> users: {
  target-arrowhead: {
    shape: cf-many
    label: "*"
  }
}
Order -> code: {
  style.stroke-dash: 4
  target-arrowhead.shape: diamond
}
users -> pg
code -> math
`,
    async run(page) {
      await frame(page, 2);
      await orbit(page, 70, 25, 30); // dragging down looks from higher up
      await wait(page, 1500); // let the orbit's inertia die before cutting
      await offCamera(() => pointAtTooltip(page));
      await wait(page, 1600);
    },
  },

  sequence: {
    seed: `chat: {
  shape: sequence_diagram
  alice: Alice
  bob: Bob
  server: Server
  alice -> server: send "hi"
  server -> bob: deliver
  bob -> server: read receipt
  server -> alice: delivered
}
`,
    async run(page) {
      await frame(page, 1);
      await orbit(page, 200, -40, 40);
      await wait(page, 700);
      await control(page, 'look').selectOption('flat'); await idle(page); await wait(page, 1300);
    },
  },

  language: {
    seed: 'web\ndb: {shape: cylinder}\nweb -> db\n',
    async run(page) {
      await frame(page, 2);
      await control(page, 'language').selectOption('ru'); await wait(page, 1500);
      await page.locator('header label select').last().selectOption('en').catch(() => {});
      await wait(page, 800);
    },
  },
};

// -------------------------------------------------------------------- run

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(FEATURES);
for (const n of names) if (!FEATURES[n]) throw new Error(`no feature "${n}"`);
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const name of names) {
  const f = FEATURES[name];
  const context = await browser.newContext({
    viewport: size, recordVideo: { dir: TMP, size },
    permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true,
  });
  const save = { src: f.seed ?? '', look: f.look ?? '3d', layout: 'dagre', theme: 0, darkTheme: 200, appearance: 'system', locale: 'en', sketch: false };
  await context.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('d2-blocks', JSON.stringify(s));
      sessionStorage.setItem('seeded', '1');
    }
  }, save);
  // The video starts with the page, so cut times are measured from here.
  clock = Date.now();
  const page = await context.newPage();
  const started = clock;
  cuts.length = 0;
  await page.goto(URL);
  await page.getByRole('button', { name: '+ box' }).waitFor();
  await idle(page);
  if (f.example) {
    // Load the example off camera by trimming everything before `mark`.
    await page.getByRole('button', { name: /Examples/ }).click();
    await page.locator('.dialog button').filter({ hasText: f.example }).first().click();
    await page.getByRole('button', { name: 'Use this example' }).click();
    await idle(page);
  }
  await wait(page, 300);
  const skip = (Date.now() - started) / 1000;
  try {
    await f.run(page);
  } catch (e) {
    console.error(`✘ ${name}: ${e.message.split('\n')[0]}`);
  }
  const video = page.video();
  await context.close();
  const raw = `${TMP}/${name}.webm`;
  renameSync(await video.path(), raw);

  const gif = `${OUT}/${name}.gif`;
  const keep = [`gte(t,${skip})`, ...cuts.map(([a, b]) => `not(between(t,${a},${b}))`)].join('*');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf',
    `select='${keep}',setpts=N/FRAME_RATE/TB,fps=10,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gif], { stdio: 'inherit' });
  console.log(r.status === 0 ? `✓ ${name} → ${gif}` : `✘ ${name}: ffmpeg failed`);
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });

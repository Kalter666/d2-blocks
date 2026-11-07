import { test as base, expect } from '@playwright/test';

/**
 * `test` for every spec: `page` is one warm page per worker, reset to a first
 * visit before each test. A cold page spends ~6 s compiling d2's wasm, which
 * was most of every test. Reset covers the store (diagram, settings, history),
 * localStorage, focus and any open modal; component-local UI state (zoom,
 * drawer height) carries over, so don't assert on its starting value.
 *
 * `cold` is a fresh page, not yet opened, for tests about boot itself: a reload,
 * `?gallery`, the cold-render race. Call open(page) on it yourself.
 */
export const test = base.extend({
  warm: [async ({ browser }, use, workerInfo) => {
    const { baseURL, permissions, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = workerInfo.project.use;
    const context = await browser.newContext({ baseURL, permissions, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
    const page = await context.newPage();
    await open(page);
    await use(page);
    await context.close();
  }, { scope: 'worker' }],

  page: async ({ warm }, use) => {
    await warm.keyboard.press('Escape'); // a modal a previous test left open
    await warm.evaluate(() => {
      document.activeElement?.blur(); // drops a code-pane draft
      localStorage.clear();
      window.__d2blocks.reset();
    });
    await expect(warm.locator('.busy')).toHaveCount(0, { timeout: 20_000 });
    await use(warm);
  },

  cold: async ({ context }, use) => use(await context.newPage()),
});

export { expect };

/**
 * Load the app and wait until it is idle. The palette proves it booted; waiting
 * for the `drawing…` flag to clear proves the cold ~6 MB WASM render has settled.
 * That wait matters: the app shares one d2 worker, so driving it mid-render races
 * that worker and corrupts the SVG (see d2.js "one instance, one worker").
 */
export async function open(page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '+ box' })).toBeVisible();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 20_000 });
}

/**
 * Do `action` and wait until the render it caused has finished. Waits on a
 * counter rather than on `.busy` rising and falling: a fast render can drop
 * `.busy` before the first poll ever sees it up. The action must change what is
 * drawn — the same source twice is coalesced and never re-renders.
 */
export async function drawn(page, action) {
  const paper = page.locator('.paper');
  const count = async () => Number(await paper.getAttribute('data-render'));
  const before = await count();
  await action();
  await expect.poll(count, { timeout: 20_000 }).toBeGreaterThan(before);
}

/**
 * The `d2 source` textarea. The store re-serialises the block tree into it
 * reactively on every edit, independent of the canvas/WASM, so its value is the
 * robust surface to assert an edit actually landed.
 */
export const source = (page) => page.getByRole('textbox', { name: 'd2 source' });

/**
 * Put `text` in the d2 source pane the way a real paste does: focus, one input
 * event. Use it for big sources — Playwright's fill() inserts multi-line text so
 * slowly here that 60 shapes' worth never finished in 15 s (20 took 2 s), while
 * the app handles the same paste in under a second.
 */
export async function paste(page, text) {
  await source(page).evaluate((ta, value) => {
    ta.focus();
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

/** A toolbar <select> in the header, found by its wrapping label's text. */
export const control = (page, label) => page.locator(`header label:has-text("${label}") select`);

/** Add a box via the palette and give it a name (name edits apply per keystroke). */
export async function addBox(page, name) {
  await page.getByRole('button', { name: '+ box' }).click();
  const box = page.locator('.block.box').last();
  if (name != null) await box.getByPlaceholder('name', { exact: true }).fill(name);
  return box;
}

/** Add a group via the palette and name it. */
export async function addGroup(page, name) {
  await page.getByRole('button', { name: '+ group' }).click();
  const group = page.locator('.block.group').last();
  if (name != null) await group.getByPlaceholder('name', { exact: true }).fill(name);
  return group;
}

/**
 * Native HTML5 drag/drop. Playwright's mouse.* never fires `dragstart` and
 * `dragTo()` is unreliable for native DnD in headless chromium, so dispatch the
 * real event sequence with one shared DataTransfer — the same thing the browser
 * would send, which drives the store's move() path.
 * `fromSel` must be the draggable `.block`; `toSel` the target `.stack`.
 */
export async function dragBlock(page, fromSel, toSel) {
  await page.evaluate(({ fromSel, toSel }) => {
    const src = document.querySelector(fromSel);
    const tgt = document.querySelector(toSel);
    if (!src || !tgt) throw new Error(`dragBlock: missing ${!src ? fromSel : toSel}`);
    const dataTransfer = new DataTransfer();
    const fire = (el, type) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    fire(src, 'dragstart');
    fire(tgt, 'dragenter');
    fire(tgt, 'dragover');
    fire(tgt, 'drop');
    fire(src, 'dragend');
  }, { fromSel, toSel });
}

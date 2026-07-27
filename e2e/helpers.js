import { expect } from '@playwright/test';

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
 * The `d2 source` textarea. The store re-serialises the block tree into it
 * reactively on every edit, independent of the canvas/WASM, so its value is the
 * robust surface to assert an edit actually landed.
 */
export const source = (page) => page.getByRole('textbox', { name: 'd2 source' });

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

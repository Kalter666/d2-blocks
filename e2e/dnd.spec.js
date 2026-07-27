import { test, expect } from '@playwright/test';
import { open, source, addBox, addGroup, dragBlock } from './helpers.js';

test.beforeEach(async ({ page }) => open(page));

test('keyboard arrows reorder blocks', async ({ page }) => {
  await addBox(page, 'a');
  await addBox(page, 'b');
  // Source order is a then b; move b up past a.
  await page.locator('.block.box').last().getByTitle(/Drag to move/).focus();
  await page.keyboard.press('ArrowUp');

  const value = await source(page).inputValue();
  expect(value.indexOf('b')).toBeLessThan(value.indexOf('a'));
});

test('dragging a box into a group nests it', async ({ page }) => {
  await addGroup(page, 'g');
  await addBox(page, 'x');
  await dragBlock(page, '.block.box', '.block.group .children .stack');

  await expect(page.locator('.block.group .children .block.box')).toHaveCount(1);
  await expect(source(page)).toHaveValue(/g: \{[\s\S]*\bx\b[\s\S]*\}/);
});

test('a group cannot be dropped into itself', async ({ page }) => {
  await addGroup(page, 'g');
  await dragBlock(page, '.block.group', '.block.group .children .stack');
  // Refused: the group stays empty, no self-nesting in the source.
  await expect(page.locator('.block.group .children .block')).toHaveCount(0);
  await expect(source(page)).not.toHaveValue(/g: \{[\s\S]*g:/);
});

import { test, expect } from '@playwright/test';
import { open, control } from './helpers.js';

test.beforeEach(async ({ page }) => open(page));

test('switching language translates the UI and survives a reload', async ({ page }) => {
  // English is the default (fresh localStorage, en navigator).
  await expect(page.getByRole('button', { name: 'Copy d2' })).toBeVisible();

  await control(page, 'language').selectOption('ru');

  // Reactive: a toolbar button and the palette re-render in Russian, no reload.
  await expect(page.getByRole('button', { name: 'Копировать d2' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ блок' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy d2' })).toHaveCount(0);

  // Persisted: the choice is saved and restored after a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Копировать d2' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

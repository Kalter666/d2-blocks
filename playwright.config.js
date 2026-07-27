import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE = `http://localhost:${PORT}/d2-blocks/`; // vite.config base is /d2-blocks/

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 }, // d2's cold wasm compile is ~6 MB (see d2.js PATIENCE=8s)
  use: {
    baseURL: BASE,
    permissions: ['clipboard-read', 'clipboard-write'], // Copy d2 / Copy Mermaid assertions
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from '@playwright/test';
// Runtime policy is shared with CI validation and intentionally kept dependency-free.
// @ts-expect-error No declaration is needed for this small Node-side policy module.
import { assertE2ESafety } from './scripts/e2e-safety.mjs';

const safety = assertE2ESafety();
const modeGrep = {
  readonly: /@readonly/,
  mutating: /@(?:readonly|mutating)/,
  destructive: /@(?:readonly|mutating|destructive)/,
}[safety.mode];

export default defineConfig({
  testDir: './e2e',
  grep: modeGrep,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }]
  ],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: safety.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } }
  ],
  webServer: process.env.CI && safety.environment === 'local'
    ? {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${new URL(safety.baseURL).port || '8080'} --strictPort`,
        url: safety.baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
      }
    : undefined
});

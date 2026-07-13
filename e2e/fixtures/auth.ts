import { test as base, expect, type Page } from './backend-health';

export type UserRole = 'admin' | 'doctor' | 'reception' | 'patient';

/* eslint-disable react-hooks/rules-of-hooks */
// This file is a Playwright fixture using `use()` from @playwright/test.
// The rule expects React components or custom hooks named `useX`,
// but Playwright fixtures use a different convention.

export const test = base.extend<{
  authenticatedPage: Page;
  loginAs: (role: UserRole) => Promise<void>;
}>({
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },
  loginAs: async ({ page }, useFn) => {
    await useFn(async (role) => {
      const creds = {
        admin: { email: 'admin@prontomedic.test', password: 'TestPassword123!' },
        doctor: { email: 'doctor@prontomedic.test', password: 'TestPassword123!' },
        reception: { email: 'recepcao@prontomedic.test', password: 'TestPassword123!' },
        patient: { email: 'paciente@prontomedic.test', password: 'TestPassword123!' }
      }[role];

      await page.goto('/');
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.context().clearCookies();
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByLabel('Senha').fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    });
  }
});

export { expect };
export type { Page };


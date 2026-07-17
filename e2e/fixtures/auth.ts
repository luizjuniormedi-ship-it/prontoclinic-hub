import { test as base, expect, Page } from '@playwright/test';
import { E2E_PASSWORD } from '../env';

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
        admin: { email: 'admin@prontomedic.test', password: E2E_PASSWORD },
        doctor: { email: 'doctor@prontomedic.test', password: E2E_PASSWORD },
        reception: { email: 'recepcao@prontomedic.test', password: E2E_PASSWORD },
        patient: { email: 'paciente@prontomedic.test', password: E2E_PASSWORD }
      }[role];

      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByRole('textbox', { name: 'Senha' }).fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    });
  }
});

export { expect };

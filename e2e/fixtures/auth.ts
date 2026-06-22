import { test as base, expect, Page } from '@playwright/test';

export type UserRole = 'admin' | 'doctor' | 'reception' | 'patient';

export const test = base.extend<{
  authenticatedPage: Page;
  loginAs: (role: UserRole) => Promise<void>;
}>({
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },
  loginAs: async ({ page }, use) => {
    await use(async (role) => {
      const creds = {
        admin: { email: 'admin@prontomedic.test', password: 'TestPassword123!' },
        doctor: { email: 'doctor@prontomedic.test', password: 'TestPassword123!' },
        reception: { email: 'recepcao@prontomedic.test', password: 'TestPassword123!' },
        patient: { email: 'paciente@prontomedic.test', password: 'TestPassword123!' }
      }[role];

      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByLabel('Senha').fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await page.waitForURL(/\/(?!login)/);
    });
  }
});

export { expect };
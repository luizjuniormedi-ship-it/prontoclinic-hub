import { test as base, expect, Page } from '@playwright/test';

export type UserRole = 'admin' | 'doctor' | 'reception' | 'patient';

const ENV_KEYS: Record<UserRole, { email: string; password: string }> = {
  admin: { email: 'E2E_ADMIN_EMAIL', password: 'E2E_ADMIN_PASSWORD' },
  doctor: { email: 'E2E_DOCTOR_EMAIL', password: 'E2E_DOCTOR_PASSWORD' },
  reception: { email: 'E2E_RECEPTION_EMAIL', password: 'E2E_RECEPTION_PASSWORD' },
  patient: { email: 'E2E_PATIENT_EMAIL', password: 'E2E_PATIENT_PASSWORD' }
};

export function credentialsFor(role: UserRole) {
  const keys = ENV_KEYS[role];
  const email = process.env[keys.email];
  const password = process.env[keys.password];
  if (!email || !password) {
    throw new Error(`[e2e/auth] usuario ${role} deve ser pre-provisionado via ${keys.email} e ${keys.password}`);
  }
  return { email, password };
}

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
      const creds = credentialsFor(role);

      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByLabel('Senha').fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await page.waitForURL(/\/(?!login)/);
    });
  }
});

export { expect };

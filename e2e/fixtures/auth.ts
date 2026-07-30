import { test as base, expect, Page } from '@playwright/test';
import { E2E_PASSWORD } from '../env';

export type UserRole = 'admin' | 'doctor' | 'reception' | 'patient' | 'callcenter';

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
        patient: { email: 'paciente@prontomedic.test', password: E2E_PASSWORD },
        callcenter: { email: 'callcenter@prontomedic.test', password: E2E_PASSWORD }
      }[role];

      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByRole('textbox', { name: 'Senha' }).fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

      const contextRequired = page.getByRole('heading', {
        name: /selecione seu contexto de acesso/i
      });
      const contextSelector = page.getByRole('button', {
        name: /selecionar empresa, unidade e perfil/i
      });
      await expect(contextSelector).toBeEnabled({ timeout: 10000 });
      const expectedRole = {
        admin: /admin|administrador/i,
        doctor: /medico|médico/i,
        reception: /recepcao|recepção/i,
        patient: /paciente/i,
        callcenter: /callcenter|call center/i,
      }[role];
      const expectedContext = /empresa e2e.*unidade e2e a/i;
      if ((await contextSelector.textContent())?.includes('Selecionar contexto')) {
        await contextSelector.click();
        const option = page.getByRole('menuitem')
          .filter({ hasText: expectedContext })
          .filter({ hasText: expectedRole });
        await expect(option).toHaveCount(1);
        await option.click();
        await expect(contextRequired).toHaveCount(0, { timeout: 10000 });
      }
      await expect(contextSelector).toContainText(expectedContext);
      await expect(contextSelector).toContainText(expectedRole);
    });
  }
});

export { expect };

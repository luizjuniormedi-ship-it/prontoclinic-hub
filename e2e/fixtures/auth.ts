import { test as base, expect, Page } from '@playwright/test';
import { E2E_PASSWORD } from '../env';

export type UserRole =
  | 'admin'
  | 'doctor'
  | 'reception'
  | 'patient'
  | 'manager'
  | 'nursing'
  | 'laboratory'
  | 'diagnostics'
  | 'pharmacy'
  | 'financial'
  | 'billing'
  | 'callCenter'
  | 'dpo'
  | 'administrative';

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
        manager: { email: 'gestor@prontomedic.test', password: E2E_PASSWORD },
        nursing: { email: 'enfermagem@prontomedic.test', password: E2E_PASSWORD },
        laboratory: { email: 'laboratorio@prontomedic.test', password: E2E_PASSWORD },
        diagnostics: { email: 'diagnostico@prontomedic.test', password: E2E_PASSWORD },
        pharmacy: { email: 'farmacia@prontomedic.test', password: E2E_PASSWORD },
        financial: { email: 'financeiro@prontomedic.test', password: E2E_PASSWORD },
        billing: { email: 'faturamento@prontomedic.test', password: E2E_PASSWORD },
        callCenter: { email: 'callcenter@prontomedic.test', password: E2E_PASSWORD },
        dpo: { email: 'dpo@prontomedic.test', password: E2E_PASSWORD },
        administrative: { email: 'administrativo@prontomedic.test', password: E2E_PASSWORD }
      }[role];

      await page.goto('/login');
      await page.getByLabel('E-mail').fill(creds.email);
      await page.getByRole('textbox', { name: 'Senha' }).fill(creds.password);
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

      const contextTrigger = page.getByRole('button', {
        name: 'Selecionar empresa, unidade e perfil',
      });
      const selectionRequired = page.getByRole('heading', {
        name: 'Selecione seu contexto de acesso',
      });
      const breadcrumb = page.getByRole('navigation', {
        name: 'Localização da página',
      });

      await expect(contextTrigger).toBeEnabled({ timeout: 15000 });
      await expect.poll(async () => (
        await selectionRequired.isVisible().catch(() => false)
        || await breadcrumb.isVisible().catch(() => false)
      ), {
        message: 'A aplicação deve ativar um contexto ou solicitar sua seleção',
        timeout: 15000,
      }).toBe(true);

      if (await selectionRequired.isVisible()) {
        await contextTrigger.click();
        const authorizedOptions = page.getByRole('menuitem').filter({
          hasNotText: 'Nenhum vínculo autorizado',
        });
        await expect(authorizedOptions.first()).toBeVisible();
        await authorizedOptions.first().click();
      }

      await expect(selectionRequired).toBeHidden();
      await expect(breadcrumb).toBeVisible({ timeout: 15000 });
    });
  }
});

export { expect };


import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const protectedRoutes = [
  { name: 'dashboard', path: '/' },
  { name: 'agenda', path: '/schedule' },
  { name: 'pacientes', path: '/patients' },
  { name: 'financeiro', path: '/financial' },
  { name: 'admin/lgpd', path: '/admin/lgpd' }
];

test.describe('Acessibilidade (WCAG 2.1 AA)', () => {
  test.beforeEach(async ({ page }) => {
    // Login como admin antes de testar rotas protegidas
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  for (const route of protectedRoutes) {
    test(`${route.name} não tem violações de acessibilidade`, async ({ page }) => {
      await page.goto(route.path);
      // Aguardar conteúdo dinâmico estabilizar
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Reportar violações com contexto, mas falhar só em impact >= serious
      const serious = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? '')
      );
      if (serious.length > 0) {
        console.log('Violações sérias/críticas:', JSON.stringify(serious, null, 2));
      }
      expect(serious).toEqual([]);
    });
  }

  test('página de login não tem violações', async ({ page }) => {
    // Limpa sessão antes
    await page.context().clearCookies();
    await page.goto('/login');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    );
    expect(serious).toEqual([]);
  });

  test('pré-cadastro público não tem violações', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/pre-cadastro');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    );
    expect(serious).toEqual([]);
  });
});

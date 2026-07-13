import { test, expect, type Page } from './fixtures/backend-health';
import AxeBuilder from '@axe-core/playwright';

test.use({ reducedMotion: 'reduce' });

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

function expectNoSeriousViolations(violations: AxeViolation[], route: string) {
  const serious = violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? '')
  );
  const occurrences = serious.flatMap((violation) =>
    violation.nodes.slice(0, 3).map((node) => ({
      route,
      impact: violation.impact,
      rule: violation.id,
      target: node.target.join(' > '),
      html: node.html.replace(/\s+/g, ' ').slice(0, 240),
    }))
  );

  if (occurrences.length > 0) {
    console.error(
      occurrences
        .map((item) =>
          `A11Y ${item.impact} ${item.rule} route=${item.route}\n  target=${item.target}\n  html=${item.html}`
        )
        .join('\n')
    );
  }

  expect(occurrences.length, `Axe encontrou falhas serias/criticas em ${route}`).toBe(0);
}

async function dismissTransientToasts(page: Page) {
  const closeButtons = page.getByRole('button', { name: 'Fechar notificacao' });
  for (let index = (await closeButtons.count()) - 1; index >= 0; index -= 1) {
    await closeButtons.nth(index).click();
  }
}

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
      await dismissTransientToasts(page);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expectNoSeriousViolations(results.violations, route.path);
    });
  }

  test('página de login não tem violações', async ({ page }) => {
    // Limpa sessão antes
    await page.context().clearCookies();
    await page.goto('/login');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expectNoSeriousViolations(results.violations, '/login');
  });

  test('pré-cadastro público não tem violações', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/pre-cadastro');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expectNoSeriousViolations(results.violations, '/pre-cadastro');
  });
});

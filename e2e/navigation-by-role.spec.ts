import { test, expect, type UserRole } from './fixtures/auth';
import { getAccessibleNavigation } from '../src/config/navigation';

type ProfileScenario = {
  role: UserRole;
  canonicalRole: string;
  label: string;
  dailyItem: string;
  launcherItem: string;
  keyword: string;
  destination: RegExp;
  forbiddenRoute?: string;
};

const scenarios: ProfileScenario[] = [
  { role: 'admin', canonicalRole: 'admin', label: 'administrador', dailyItem: 'Dashboard', launcherItem: 'Dashboard', keyword: 'prioridades', destination: /\/$/ },
  { role: 'reception', canonicalRole: 'recepcao', label: 'recepção', dailyItem: 'Recepção', launcherItem: 'Recepção', keyword: 'elegibilidade', destination: /\/reception$/i, forbiddenRoute: '/admin/users' },
  { role: 'doctor', canonicalRole: 'medico', label: 'médico', dailyItem: 'Atendimento clínico', launcherItem: 'Atendimento clínico', keyword: 'episódio', destination: /\/encounters$/i, forbiddenRoute: '/admin/users' },
  { role: 'nursing', canonicalRole: 'enfermagem', label: 'enfermagem', dailyItem: 'Triagem', launcherItem: 'Triagem', keyword: 'risco', destination: /\/nursing\/triage$/i, forbiddenRoute: '/admin/users' },
  { role: 'laboratory', canonicalRole: 'laboratorio', label: 'laboratório', dailyItem: 'Laboratório', launcherItem: 'Laboratório', keyword: 'coleta', destination: /\/lab$/i, forbiddenRoute: '/admin/users' },
  { role: 'diagnostics', canonicalRole: 'diagnostico', label: 'diagnóstico', dailyItem: 'Pedidos de imagem', launcherItem: 'Pedidos de imagem', keyword: 'pedido', destination: /\/dicom\/orders$/i, forbiddenRoute: '/admin/users' },
  { role: 'pharmacy', canonicalRole: 'farmacia', label: 'farmácia', dailyItem: 'Farmácia', launcherItem: 'Farmácia', keyword: 'dispensação', destination: /\/pharmacy$/i, forbiddenRoute: '/admin/users' },
  { role: 'financial', canonicalRole: 'financeiro', label: 'financeiro', dailyItem: 'Contas de faturamento', launcherItem: 'Contas de faturamento', keyword: 'conta', destination: /\/billing-accounts$/i, forbiddenRoute: '/admin/users' },
  { role: 'dpo', canonicalRole: 'dpo', label: 'DPO', dailyItem: 'LGPD e privacidade', launcherItem: 'LGPD e privacidade', keyword: 'consentimento', destination: /\/admin\/lgpd$/i, forbiddenRoute: '/patients' },
  { role: 'administrative', canonicalRole: 'administrativo', label: 'administrativo', dailyItem: 'Profissionais', launcherItem: 'Profissionais', keyword: 'crm', destination: /\/professionals$/i, forbiddenRoute: '/encounters' },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('navegação real por perfil', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Matriz de perfis executada uma vez no Chromium.');
  });

  for (const scenario of scenarios) {
    test(`${scenario.label}: menu, launcher, busca, breadcrumb e permissão`, async ({ page, loginAs }) => {
      await loginAs(scenario.role);

      const mainNavigation = page.getByRole('navigation', { name: 'Navegação principal' });
      await expect(mainNavigation.getByRole('link', {
        name: new RegExp(`^${escapeRegExp(scenario.dailyItem)}(?:\\.|$)`, 'i'),
      })).toBeVisible();

      await page.getByRole('button', { name: /todos os módulos/i }).first().click();
      const launcher = page.getByRole('dialog', { name: 'Todos os módulos' });
      await expect(launcher).toBeVisible();
      for (const item of getAccessibleNavigation(scenario.canonicalRole)) {
        await expect(launcher.getByText(item.title, { exact: true })).toBeVisible();
      }
      await launcher.getByRole('combobox', { name: 'Buscar telas e funções' }).fill(scenario.keyword);
      await launcher.getByText(scenario.launcherItem, { exact: true }).click();

      await expect(page).toHaveURL(scenario.destination);
      await expect(page.getByRole('navigation', { name: 'Localização da página' })).toBeVisible();

      if (scenario.forbiddenRoute) {
        await page.goto(scenario.forbiddenRoute);
        await expect(page.getByRole('heading', { name: /acesso negado/i })).toBeVisible();
      }
    });
  }

  test('administrador troca unidade e mantém navegação sincronizada', async ({ page, loginAs }) => {
    await loginAs('admin');
    await page.getByRole('button', { name: 'Selecionar empresa, unidade e perfil' }).click();
    await page.getByRole('menuitem').filter({ hasText: 'Unidade E2E B' }).click();
    await expect(page.getByRole('button', { name: 'Selecionar empresa, unidade e perfil' }))
      .toContainText('Unidade E2E B');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByText('Dashboard', { exact: true }))
      .toBeVisible();
  });

  test('administrador alcança todas as telas catalogadas com breadcrumb', async ({ page, loginAs }) => {
    test.setTimeout(300_000);
    await loginAs('admin');

    for (const item of getAccessibleNavigation('admin')) {
      await page.goto(item.url);
      await expect(
        page.getByRole('navigation', { name: 'Localização da página' }),
        `breadcrumb ausente em ${item.url}`,
      ).toBeVisible();
      await expect(page.getByText(item.title, { exact: true }).first()).toBeVisible();
    }
  });

  test('launcher e ações principais mantêm nome acessível no celular', async ({ page, loginAs }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs('reception');

    const launcherButton = page.getByRole('button', { name: /todos os módulos/i }).first();
    await expect(launcherButton).toBeVisible();
    await launcherButton.click();
    await expect(page.getByRole('dialog', { name: 'Todos os módulos' })).toBeVisible();
  });
});

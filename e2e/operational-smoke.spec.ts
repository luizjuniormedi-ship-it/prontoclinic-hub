import { expect, test } from './fixtures/auth';

const criticalRoutes = [
  { path: '/', name: 'Dashboard' },
  { path: '/schedule', name: 'Agenda' },
  { path: '/callcenter', name: 'Call center' },
  { path: '/patients', name: 'Pacientes' },
  { path: '/reception', name: 'Recepcao' },
  { path: '/records', name: 'Prontuario' },
  { path: '/financial', name: 'Financeiro' },
  { path: '/billing-production', name: 'Faturamento/producao' },
  { path: '/billing-accounts', name: 'Contas de faturamento' },
  { path: '/professional-payment', name: 'Repasse medico' },
  { path: '/admin/users', name: 'Usuarios' },
  { path: '/admin/insurances', name: 'Convenios' },
  { path: '/admin/price-tables', name: 'Tabelas de preco' },
  { path: '/lab', name: 'Laboratorio' },
];

test.describe.serial('Smoke operacional P0', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  for (const route of criticalRoutes) {
    test(`${route.name} abre sem bloqueio operacional`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(route.path);

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole('heading', { name: '404' })).toHaveCount(0);
      await expect(page.getByText(/em breve|em desenvolvimento/i)).toHaveCount(0);
      await expect(page.getByText(/algo deu errado|erro inesperado|failed to fetch/i)).toHaveCount(0);
      expect(pageErrors, `${route.path} nao deve gerar erro JS`).toEqual([]);
    });
  }
});

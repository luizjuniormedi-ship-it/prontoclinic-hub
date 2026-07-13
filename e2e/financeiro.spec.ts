import { test, expect } from './fixtures/auth';

async function openFinancialAndAssertRuntime(page: import('@playwright/test').Page, path = '/financial') {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/list_billing_financial_summary_secure')
  );
  await page.goto(path);
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`Resumo financeiro falhou: HTTP ${response.status()} ${await response.text()}`);
  }
}

test.describe('Financeiro e faturamento - contrato operacional', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  test('exibe contas a receber sem criar cobranca arbitraria', async ({ page }) => {
    await openFinancialAndAssertRuntime(page);

    await expect(page).toHaveURL(/\/financial$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a Receber' })).toBeVisible();
    await expect(page.getByText('Cobranças originadas de atendimentos e respectivos saldos')).toBeVisible();
    await expect(page.getByPlaceholder('Buscar paciente...')).toBeVisible();
    await expect(page.getByRole('button', { name: /nova cobrança/i })).toHaveCount(0);

    const table = page.getByRole('table');
    const emptyState = page.getByRole('heading', { name: 'Nenhuma transação encontrada' });
    await expect(table.or(emptyState)).toBeVisible();
  });

  test('exibe producao faturavel vinculada a atendimento', async ({ page }) => {
    await page.goto('/billing-production');

    await expect(page).toHaveURL(/\/billing-production$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Faturamento' })).toBeVisible();
    await expect(page.getByText('Produção faturável vinculada aos atendimentos')).toBeVisible();
    await expect(page.getByPlaceholder('Buscar paciente, profissional...')).toBeVisible();

    const table = page.getByRole('table');
    const emptyState = page.getByRole('heading', { name: 'Nenhum faturamento encontrado' });
    await expect(table.or(emptyState)).toBeVisible();
  });

  test('rota antiga de contas redireciona para o contrato financeiro comprovado', async ({ page }) => {
    await openFinancialAndAssertRuntime(page, '/billing-accounts');

    await expect(page).toHaveURL(/\/financial$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a Receber' })).toBeVisible();
  });
});

for (const role of ['doctor', 'reception', 'patient'] as const) {
  test(`perfil ${role} nao acessa rotinas financeiras`, async ({ page, loginAs }) => {
    await loginAs(role);

    for (const path of ['/financial', '/billing-production', '/billing-accounts']) {
      const writes: string[] = [];
      const observeWrite = (request: { method(): string; url(): string }) => {
        if (!['GET', 'HEAD'].includes(request.method()) && /\/rest\/v1\/|\/functions\/v1\//.test(request.url())) {
          writes.push(`${request.method()} ${request.url()}`);
        }
      };
      page.on('request', observeWrite);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Acesso Negado' })).toBeVisible();
      expect(writes).toEqual([]);
      page.off('request', observeWrite);
    }
  });
}

import { test as authed, expect } from './fixtures/auth';

const providerHealthUrl = process.env.E2E_TISS_PROVIDER_HEALTH_URL?.trim();
const providerToken = process.env.E2E_TISS_PROVIDER_TOKEN?.trim();
const syntheticInsuranceName = `Convenio E2E ${Date.now()}`;

authed.describe.serial('Financeiro - operacoes locais sinteticas', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('cadastra convenio pela rota canonica', async ({ page }) => {
    await page.goto('/admin/insurances');
    await expect(
      page.getByRole('heading', { name: 'Convenios e Planos' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Novo Convenio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo Convenio' });
    await dialog.getByLabel('Nome do Convenio *').fill(syntheticInsuranceName);
    await dialog.getByLabel('Registro ANS').fill('999999');
    await dialog.getByLabel('CNPJ').fill('11222333000181');
    await dialog.getByRole('button', { name: 'Salvar' }).click();

    await expect(dialog).toBeHidden();
    await page.getByPlaceholder('Buscar por nome...').fill(syntheticInsuranceName);
    const row = page.getByRole('row').filter({ hasText: syntheticInsuranceName });
    await expect(row).toBeVisible();
    await expect(row).toContainText('999999');
    await expect(row).toContainText('Ativo');
  });

  authed('consulta planos do convenio pela UI existente', async ({ page }) => {
    await page.goto('/admin/insurances');
    await page.getByPlaceholder('Buscar por nome...').fill(syntheticInsuranceName);
    await page.getByRole('row').filter({ hasText: syntheticInsuranceName }).click();
    await page.getByRole('tab', { name: /^Planos/ }).click();

    await expect(
      page.getByRole('heading', { name: `Planos: ${syntheticInsuranceName}` }),
    ).toBeVisible();
    await expect(page.getByText(/0 plano\(s\) cadastrado\(s\)/i)).toBeVisible();
  });

  authed('consulta preco com fallback pela rota canonica', async ({ page }) => {
    await page.goto('/admin/price-tables');
    await expect(
      page.getByRole('heading', { name: 'Tabela de Precos' }),
    ).toBeVisible();
    await expect(page.getByText('Testar busca de preco')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    const lookup = page
      .getByText('Testar busca de preco')
      .locator('..')
      .locator('..');
    const selects = lookup.getByRole('combobox');
    await selects.nth(0).click();
    const firstService = page.getByRole('option').first();
    await expect(firstService).toBeVisible();
    await firstService.click();

    await lookup.getByRole('button', { name: 'Buscar' }).click();
    await expect(lookup.locator('pre')).toBeVisible();
    await expect(lookup.locator('pre')).not.toContainText(/\b(?:NaN|undefined)\b/);
  });

  authed('renderiza os modulos financeiro e faturamento atuais', async ({ page }) => {
    await page.goto('/financial');
    await expect(page.getByRole('heading', { name: 'Financeiro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova Cobrança' })).toBeVisible();
    await expect(page.getByRole('main').getByText(/\b(?:NaN|undefined)\b/)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /algo deu errado/i })).toHaveCount(0);

    await page.goto('/billing-production');
    await expect(page.getByRole('heading', { name: 'Faturamento', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo Faturamento' })).toBeVisible();
    await expect(page.getByRole('main').getByText(/\b(?:NaN|undefined)\b/)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /algo deu errado/i })).toHaveCount(0);
  });

  authed('renderiza a administracao TISS local sem transmitir XML', async ({ page }) => {
    await page.goto('/admin/tiss');
    await expect(
      page.getByRole('heading', { name: 'Faturamento TISS' }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Guias TISS' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gerar Fatura do Mes' })).toBeVisible();
    await expect(page.getByText(/\b(?:NaN|undefined)\b/)).toHaveCount(0);
  });
});

authed.describe('Financeiro - integracao TISS externa', () => {
  authed('valida provider homologado sem transmitir XML', async ({ request }) => {
    authed.skip(
      !providerHealthUrl || !providerToken,
      'Provider TISS externo ausente: defina E2E_TISS_PROVIDER_HEALTH_URL e E2E_TISS_PROVIDER_TOKEN.',
    );

    const response = await request.get(providerHealthUrl!, {
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: 'application/json',
      },
      timeout: 30_000,
    });

    expect(
      response.ok(),
      `Provider TISS indisponivel: HTTP ${response.status()} ${await response.text()}`,
    ).toBeTruthy();
  });
});

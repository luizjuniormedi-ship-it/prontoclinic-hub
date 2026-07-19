import { test as authed, expect } from './fixtures/auth';

authed.describe('Faturamento @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('criar convênio', async ({ page }) => {
    await page.goto('/admin/convenios');
    await page.getByRole('button', { name: /novo convênio|criar/i }).click();
    await page.getByLabel(/nome/i).fill('Unimed E2E');
    await page.getByLabel(/razão social/i).fill('Unimed Federação E2E LTDA');
    await page.getByLabel(/cnpj/i).fill('11.222.333/0001-81');
    await page.getByLabel(/registro ans/i).fill('123456');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/convênio criado/i)).toBeVisible();
  });

  authed('criar plano dentro do convênio', async ({ page }) => {
    await page.goto('/admin/convenios');
    await page.getByText('Unimed E2E').first().click();
    await page.getByRole('tab', { name: /planos/i }).click();
    await page.getByRole('button', { name: /novo plano/i }).click();
    await page.getByLabel(/nome/i).fill('Plano E2E Básico');
    await page.getByLabel(/cobertura/i).fill('Ambulatorial');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText('Plano E2E Básico')).toBeVisible();
  });

  authed('definir preço particular', async ({ page }) => {
    await page.goto('/admin/tabelas-precos');
    await page.getByRole('button', { name: /nova tabela/i }).click();
    await page.getByLabel(/nome/i).fill('Particular E2E');
    await page.getByLabel(/tipo/i).selectOption({ label: 'Particular' });
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText('Particular E2E')).toBeVisible();
  });

  authed('definir preço por convênio', async ({ page }) => {
    await page.goto('/admin/tabelas-precos');
    await page.getByText('Particular E2E').first().click();
    await page.getByRole('button', { name: /adicionar procedimento/i }).click();
    await page.getByLabel(/procedimento/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/preço/i).fill('150.00');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/R\$ ?150/i)).toBeVisible();
  });

  authed('testar find_price (resolver com fallback)', async ({ page, request }) => {
    // Chamar diretamente a função via API do Supabase Edge Function ou RPC
    const res = await request.post(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/find_price`,
      {
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        data: {
          p_procedure_code: 'CONSULTA',
          p_insurance_id: 'unimed-e2e',
          p_company_id: 'default'
        }
      }
    );
    expect([200, 204]).toContain(res.status());
  });

  authed('gerar fatura mensal', async ({ page }) => {
    await page.goto('/financial');
    await page.getByRole('button', { name: /gerar fatura|fatura mensal/i }).click();
    await page.getByLabel(/mês/i).fill('2026-06');
    await page.getByRole('button', { name: /gerar/i }).click();
    await expect(page.getByText(/fatura gerada|R\$/i)).toBeVisible({ timeout: 30000 });
  });

  authed('visualizar glosa', async ({ page }) => {
    await page.goto('/financial');
    await page.getByRole('tab', { name: /glosas/i }).click();
    await expect(page.getByRole('row').first()).toBeVisible();
    const motivo = await page.getByRole('row').first().textContent();
    expect(motivo).toBeTruthy();
  });

  authed('enviar recurso de glosa', async ({ page }) => {
    await page.goto('/financial');
    await page.getByRole('tab', { name: /glosas/i }).click();
    await page.getByRole('row').first().getByRole('button', { name: /recurso/i }).click();
    await page.getByLabel(/justificativa/i).fill('Procedimento coberto pelo contrato — recurso E2E');
    await page.getByRole('button', { name: /enviar/i }).click();
    await expect(page.getByText(/recurso enviado/i)).toBeVisible();
  });
});

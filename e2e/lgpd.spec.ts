import { test as authed, expect } from './fixtures/auth';

authed.describe('LGPD', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('solicitar acesso (LGPD art. 18 I)', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('tab', { name: /solicitações/i }).click();
    await page.getByRole('button', { name: /nova solicitação/i }).click();
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/tipo/i).selectOption({ label: 'Acesso' });
    await page.getByRole('button', { name: /criar/i }).click();
    await expect(page.getByText(/solicitação criada/i)).toBeVisible();
  });

  authed('solicitar portabilidade (art. 18 V) — exporta JSON', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('button', { name: /nova solicitação/i }).click();
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/tipo/i).selectOption({ label: 'Portabilidade' });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /exportar/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  authed('solicitar esquecimento (art. 18 VI)', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('button', { name: /nova solicitação/i }).click();
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/tipo/i).selectOption({ label: 'Esquecimento' });
    await page.getByLabel(/confirmação/i).check();
    await page.getByRole('button', { name: /criar/i }).click();
    await expect(page.getByText(/solicitação de esquecimento registrada/i)).toBeVisible();
  });

  authed('anonimizar paciente (admin)', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('tab', { name: /anonimização/i }).click();
    await page.getByRole('button', { name: /anonimizar/i }).first().click();
    await page.getByLabel(/motivo/i).fill('LGPD art. 18 VI — solicitação aprovada');
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/paciente anonimizado/i)).toBeVisible();
  });

  authed('visualizar log de anonimização', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('tab', { name: /log/i }).click();
    await expect(page.getByRole('row').first()).toBeVisible();
    const row = await page.getByRole('row').first().textContent();
    expect(row).toMatch(/anonimiz|hash|paciente/i);
  });

  authed('configurar política de retenção', async ({ page }) => {
    await page.goto('/admin/lgpd');
    await page.getByRole('tab', { name: /retenção/i }).click();
    await page.getByLabel(/prontuários/i).fill('20');
    await page.getByLabel(/faturas/i).fill('5');
    await page.getByLabel(/logs de auditoria/i).fill('5');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/política atualizada/i)).toBeVisible();
  });

  authed('paciente anonimizado não tem mais PII', async ({ page, request }) => {
    // Após anonimização, REST não deve retornar nome/CPF/email
    const res = await request.get(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/pacientes?select=nome,cpf,email&anonymized=eq.true&limit=1`,
      {
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`
        }
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    if (data.length > 0) {
      expect(data[0].nome).toMatch(/anonimizado|^[\s]*$|^null$/i);
      expect(data[0].cpf).toMatch(/^\*+|null$/);
      expect(data[0].email).toMatch(/^null$|\*+/);
    }
  });
});
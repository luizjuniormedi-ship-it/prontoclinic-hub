import { test as authed, expect } from './fixtures/auth';

authed.describe('Prontuário - contrato canônico', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('doctor');
  });

  authed('localiza e abre o prontuário longitudinal do paciente sintético', async ({ page }) => {
    await page.goto('/records');
    await expect(page.getByRole('heading', { name: 'Prontuário Eletrônico' })).toBeVisible();
    await page.getByPlaceholder('Buscar por nome...').fill('Paciente E2E A');
    await page.getByRole('button', { name: 'Abrir prontuário de Paciente E2E A' }).click();

    await expect(page.getByRole('heading', { name: /Prontuário — Paciente E2E A/i })).toBeVisible();
    await expect(page.getByText(/pagamento:/i)).toHaveCount(0);
  });

  authed('mantém prescrição e solicitação de exames em módulos canônicos separados', async ({ page }) => {
    await page.goto('/prescriptions');
    await expect(page.getByRole('heading', { name: /Prescrição Eletrônica/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nova Prescrição/i })).toBeVisible();

    await page.goto('/exam-requests');
    await expect(page.getByRole('heading', { name: /Solicitação de exames/i })).toBeVisible();
    await expect(page.getByText(/não está explicitamente autorizada/i)).toHaveCount(0);
    await expect(page.getByText(/página não encontrada|algo deu errado/i)).toHaveCount(0);
  });
});

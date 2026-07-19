import { test as authed, expect } from './fixtures/auth';

authed.describe('Pacientes @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('criar paciente', async ({ page }) => {
    await page.goto('/patients');
    await page.getByRole('button', { name: /novo paciente|criar/i }).click();
    await page.getByLabel(/nome/i).fill('João da Silva E2E');
    await page.getByLabel(/cpf/i).fill('529.982.247-25');
    await page.getByLabel(/data de nascimento/i).fill('1990-01-15');
    await page.getByLabel(/telefone/i).fill('11999998888');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/paciente criado|sucesso/i)).toBeVisible();
  });

  authed('buscar por CPF', async ({ page }) => {
    await page.goto('/patients');
    await page.getByPlaceholder(/buscar|pesquisar/i).fill('529.982.247-25');
    await expect(page.getByText('João da Silva E2E')).toBeVisible();
  });

  authed('buscar por nome', async ({ page }) => {
    await page.goto('/patients');
    await page.getByPlaceholder(/buscar|pesquisar/i).fill('João');
    await expect(page.getByText(/João/i).first()).toBeVisible();
  });

  authed('editar paciente', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('button', { name: /editar/i }).click();
    await page.getByLabel(/telefone/i).fill('11988887777');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/paciente atualizado|sucesso/i)).toBeVisible();
  });

  authed('adicionar alergia', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('tab', { name: /alergias/i }).click();
    await page.getByLabel(/alergia/i).fill('Penicilina');
    await page.getByRole('button', { name: /adicionar/i }).click();
    await expect(page.getByText('Penicilina')).toBeVisible();
  });

  authed('adicionar responsável legal', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('tab', { name: /responsável/i }).click();
    await page.getByLabel(/nome/i).fill('Maria da Silva');
    await page.getByLabel(/cpf/i).fill('111.444.777-35');
    await page.getByLabel(/parentesco/i).fill('Mãe');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText('Maria da Silva')).toBeVisible();
  });

  authed('listar por convênio', async ({ page }) => {
    await page.goto('/patients');
    await page.getByLabel(/convênio/i).click();
    await page.getByRole('option', { name: /unimed/i }).click();
    await expect(page.getByText(/unimed/i).first()).toBeVisible();
  });

  authed('ver histórico', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('tab', { name: /histórico/i }).click();
    await expect(page.getByText(/histórico|consultas|atendimentos/i)).toBeVisible();
  });

  authed('anonimizar paciente (admin)', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('button', { name: /anonimizar/i }).click();
    await page.getByLabel(/motivo/i).fill('Direito ao esquecimento - LGPD art. 18 VI');
    await page.getByRole('button', { name: /confirmar anonimização/i }).click();
    await expect(page.getByText(/paciente anonimizado/i)).toBeVisible();
  });

  authed('exportar dados (LGPD)', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /exportar dados|lgpd/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  authed('direito ao esquecimento (LGPD)', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('button', { name: /solicitar esquecimento|esquecer/i }).click();
    await page.getByLabel(/confirmação/i).check();
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/solicitação registrada/i)).toBeVisible();
  });

  authed('consentimento por canal (SMS, email, WhatsApp)', async ({ page }) => {
    await page.goto('/patients');
    await page.getByText('João da Silva E2E').first().click();
    await page.getByRole('tab', { name: /consentimento/i }).click();
    await page.getByLabel(/sms/i).check();
    await page.getByLabel(/e-?mail/i).check();
    await page.getByLabel(/whatsapp/i).check();
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/consentimentos atualizados/i)).toBeVisible();
  });
});

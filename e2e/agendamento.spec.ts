import { expect, test as authed } from './fixtures/auth';

authed.describe.configure({ mode: 'serial' });

authed.describe('Agendamento', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('abre agenda com dados migrados e acoes principais', async ({ page }) => {
    await page.goto('/schedule');

    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByRole('button', { name: /criar novo agendamento/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /adicionar encaixe/i })).toBeVisible();
    await expect(page.getByRole('grid', { name: /agendamentos de/i })).toBeVisible();
  });

  authed('filtra agenda por busca, profissional e status', async ({ page }) => {
    await page.goto('/schedule');

    await page.getByRole('textbox', { name: /buscar agendamento/i }).fill('PACIENTE');
    await page.getByRole('combobox', { name: /filtrar por profissional/i }).click();
    await page.getByRole('option').nth(1).click();
    await page.getByRole('combobox', { name: /filtrar por status/i }).click();
    await page.getByRole('option', { name: /agendado|scheduled/i }).click();

    await expect(page.getByRole('button', { name: /limpar/i })).toBeVisible();
  });

  authed('abre modal de novo agendamento e valida campos obrigatorios', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();

    await expect(page.getByRole('dialog', { name: /novo agendamento/i })).toBeVisible();
    await page.getByRole('button', { name: /agendar/i }).click();

    await expect(page.getByText(/paciente.*obrigatório|profissional.*obrigatório|início.*obrigatório/i).first()).toBeVisible();
  });

  authed('permite preencher dados minimos de novo agendamento sem salvar', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();

    await page.getByRole('textbox', { name: /buscar paciente para agendamento/i }).fill('PACIENTE');
    await page.getByRole('combobox', { name: /selecionar paciente/i }).click();
    await page.getByRole('option').first().click();

    await page.getByRole('combobox', { name: /selecionar profissional/i }).click();
    await page.getByRole('option').first().click();

    await page.getByLabel('Data *').fill('2026-12-31');
    await page.getByLabel('Início *').fill('22:45');

    await expect(page.getByLabel('Fim')).toHaveValue(/.+/);
    await page.getByRole('button', { name: /cancelar/i }).click();
    await expect(page.getByRole('dialog', { name: /novo agendamento/i })).toHaveCount(0);
  });

  authed('abre menu de acao rapida de um agendamento existente', async ({ page }) => {
    await page.goto('/schedule');

    await page.getByRole('button', { name: /mais ações para/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /check-in|remarcar|cancelar|registrar falta/i }).first()).toBeVisible();
  });
});

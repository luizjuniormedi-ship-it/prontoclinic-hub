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

  authed('persiste agendamento sintetico e permite cancelamento pela agenda', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();

    await page.getByRole('textbox', { name: /buscar paciente para agendamento/i }).fill('PACIENTE');
    await page.getByRole('combobox', { name: /selecionar paciente/i }).click();
    await page.getByRole('option').first().click();

    await page.getByRole('combobox', { name: /selecionar profissional/i }).click();
    await page.getByRole('option').first().click();

    await page.getByLabel('Início *').fill('22:45');
    await page.getByLabel(/observações/i).fill('E2E_AGENDA_PERSISTENCIA');

    await expect(page.getByLabel('Fim')).toHaveValue(/.+/);
    await page.getByRole('button', { name: /^agendar$/i }).click();
    await expect(page.getByRole('dialog', { name: /novo agendamento/i })).toHaveCount(0);
    await expect(page.getByText('✓ Agendamento criado com sucesso!', { exact: true })).toBeVisible();

    await page.getByRole('textbox', { name: /buscar agendamento/i }).fill('PACIENTE');
    const createdRow = page.getByRole('gridcell', { name: /22:45, PACIENTE/i }).first();
    await expect(createdRow).toBeVisible();
    await createdRow.getByRole('button', { name: /mais ações para/i }).click();
    await page.getByRole('menuitem', { name: /cancelar/i }).click();
    await page.getByRole('dialog', { name: /cancelar agendamento/i }).getByLabel(/motivo/i).fill('Limpeza da fixture E2E');
    await page.getByRole('dialog', { name: /cancelar agendamento/i }).getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText('Agendamento cancelado', { exact: true })).toBeVisible();
  });

  authed('abre menu de acao rapida de um agendamento existente', async ({ page }) => {
    await page.goto('/schedule');

    await page.getByRole('button', { name: /mais ações para/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /check-in|remarcar|cancelar|registrar falta/i }).first()).toBeVisible();
  });
});

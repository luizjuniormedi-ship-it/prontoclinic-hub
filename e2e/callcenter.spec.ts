import { test as authed, expect } from './fixtures/auth';

authed.describe.serial('Call Center — operação e isolamento', () => {
  authed.beforeEach(async ({ loginAs, page }) => {
    await loginAs('callcenter');
    await page.goto('/callcenter');
    await expect(page.getByRole('heading', { name: 'Call Center' })).toBeVisible();
  });

  authed('abre somente com consultas e sem materializar a fila automaticamente', async ({ page }) => {
    await expect(page.getByText('Fila de confirmação')).toBeVisible();
    await expect(page.getByText('Tarefas pendentes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Atualizar fila' })).toBeVisible();
    await expect(page.getByText('Fila de confirmação atualizada')).toHaveCount(0);
  });

  authed('registra contato sintético, cria tarefa e persiste após recarga', async ({ page }) => {
    const reason = 'QA-E2E-CALLCENTER-RETORNO';
    const nextAction = 'QA-E2E-CONFIRMAR-PREPARO';

    await page.getByRole('button', { name: 'Novo Contato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo contato' });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder('Buscar por nome, CPF, telefone ou e-mail')
      .fill('Paciente E2E A');
    const patientSelect = dialog.getByRole('combobox').filter({
      has: page.getByText('Selecione o paciente'),
    });
    await expect(patientSelect).toBeVisible({ timeout: 10_000 });
    await patientSelect.click();
    await page.getByRole('option', { name: /Paciente E2E A/ }).click();

    await dialog.getByPlaceholder(/marcação de consulta/i).fill(reason);
    await dialog.getByPlaceholder(/retornar ligação/i).fill(nextAction);
    await dialog.getByPlaceholder(/resumo objetivo/i)
      .fill('Registro sintético criado pela homologação E2E.');
    await dialog.getByRole('button', { name: 'Registrar contato' }).click();

    await expect(page.getByText('Contato registrado', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: reason })).toBeVisible();
    await expect(page.getByText(nextAction, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Call Center' })).toBeVisible();
    await expect(page.getByRole('cell', { name: reason })).toBeVisible();
    await expect(page.getByText(nextAction, { exact: true })).toBeVisible();
  });

  authed('bloqueia o perfil Call Center fora de sua área operacional', async ({ page }) => {
    await page.goto('/billing-accounts');
    await expect(page.getByText(/acesso negado|sem permissão/i)).toBeVisible();
  });
});

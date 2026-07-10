import { test as authed, expect } from './fixtures/auth';

authed.describe.serial('Recepção — operação básica', () => {
  authed.beforeEach(async ({ loginAs, page }) => {
    await loginAs('reception');
    await page.goto('/reception');
  });

  authed('abre a recepção com indicadores e fila do dia', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^recepção$/i })).toBeVisible();
    await expect(page.getByText(/pacientes agendados hoje/i)).toBeVisible();
    await expect(page.getByText(/aguardando chegada/i)).toBeVisible();
    await expect(page.getByText(/sala de espera/i)).toBeVisible();
    await expect(page.getByText('Em Atendimento', { exact: true })).toBeVisible();
    await expect(page.getByText('Finalizados', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /fila/i })).toBeVisible();
  });

  authed('permite filtrar paciente na recepção', async ({ page }) => {
    const search = page.getByRole('textbox', { name: /buscar paciente na recepção/i });

    await search.fill('zzzz-inexistente');
    await expect(page.getByText(/nenhum paciente na fila|nenhum atendimento em andamento|nenhum atendimento finalizado/i).first()).toBeVisible();

    await search.clear();
    await expect(page.getByRole('tab', { name: /fila/i })).toBeVisible();
  });

  authed('navega entre fila, em atendimento e finalizados', async ({ page }) => {
    await page.getByRole('tab', { name: /em atendimento/i }).click();
    await expect(page.getByText(/nenhum atendimento em andamento|abrir/i).first()).toBeVisible();

    await page.getByRole('tab', { name: /finalizados/i }).click();
    await expect(page.getByText(/nenhum atendimento finalizado|finalizado/i).first()).toBeVisible();

    await page.getByRole('tab', { name: /fila/i }).click();
    await expect(page.getByRole('tab', { name: /fila/i })).toHaveAttribute('data-state', 'active');
  });

  authed('exibe ações operacionais quando existem pacientes na fila', async ({ page }) => {
    const queueIsEmpty = await page.getByText(/nenhum paciente na fila/i).isVisible().catch(() => false);

    if (queueIsEmpty) {
      await expect(page.getByText(/nenhum paciente na fila/i)).toBeVisible();
      return;
    }

    await expect(page.getByRole('button', { name: /check-in|iniciar/i }).first()).toBeVisible();
  });
});

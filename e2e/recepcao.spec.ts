import { test as authed, expect } from './fixtures/auth';

authed.describe.serial('Recepção — operação básica', () => {
  authed.beforeEach(async ({ loginAs, page }) => {
    await loginAs('reception');
    await page.goto('/reception');
  });

  authed('abre a recepção com indicadores e fila do dia', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /entrada do paciente/i })).toBeVisible();
    await expect(page.getByText(/pacientes hoje/i)).toBeVisible();
    await expect(page.getByText(/recepção carregada parcialmente/i)).toHaveCount(0);
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

  authed('conclui o check-in 91001 uma única vez e persiste a senha', async ({ page }, testInfo) => {
    authed.skip(
      testInfo.project.name !== 'chromium',
      'O cenário transacional usa uma única massa compartilhada e roda uma vez no Chromium.',
    );

    const patientName = 'Paciente E2E A';
    const patientHistoryButton = page.getByRole('button', {
      name: `Ver agendamentos de ${patientName}`,
    });
    const appointmentCard = patientHistoryButton.locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    );

    await expect(patientHistoryButton).toBeVisible();
    await expect(appointmentCard).toContainText('Médico E2E');
    await expect(appointmentCard.getByRole('button', { name: 'Check-in' })).toBeVisible();

    await appointmentCard.getByRole('button', { name: 'Check-in' }).click();
    const checkinDialog = page.getByRole('dialog');
    await expect(checkinDialog).toContainText(patientName);
    await expect(
      checkinDialog.getByText('Paciente liberado para check-in', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const confirmButton = page.getByRole('button', {
      name: 'Confirmar entrada e abrir conta',
    });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    const receiptDialog = page.getByRole('dialog', {
      name: 'Entrada concluída e conta aberta',
    });
    await expect(receiptDialog).toBeVisible({ timeout: 20_000 });
    await expect(receiptDialog).toContainText(`${patientName} · Atendimento #91001`);

    const ticket = receiptDialog.getByText(/^Senha \S+$/);
    await expect(ticket).toBeVisible();
    const ticketLabel = (await ticket.textContent())?.replace(/^Senha\s+/, '').trim();
    expect(ticketLabel, 'A Recepção deve exibir a senha persistida').toBeTruthy();

    await receiptDialog.getByRole('button', { name: 'Fechar' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: /entrada do paciente/i })).toBeVisible();

    const persistedPatientButton = page.getByRole('button', {
      name: `Ver agendamentos de ${patientName}`,
    });
    const persistedAppointmentCard = persistedPatientButton.locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    );
    const persistedTicket = page.getByText(
      new RegExp(`^${ticketLabel} · Paciente #91001$`),
    );

    await expect(persistedTicket).toHaveCount(1);
    await expect(persistedAppointmentCard).toContainText('Aguardando');
    await expect(
      persistedAppointmentCard.getByRole('button', { name: 'Iniciar' }),
    ).toHaveCount(0);
    await expect(
      persistedAppointmentCard.getByRole('button', { name: 'Check-in' }),
    ).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`))).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: `Ver agendamentos de ${patientName}` })
        .locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]')
        .getByRole('button', { name: 'Check-in' }),
    ).toHaveCount(0);
  });
});

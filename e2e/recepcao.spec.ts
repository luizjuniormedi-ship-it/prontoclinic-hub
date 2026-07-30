import { test as authed, expect } from './fixtures/auth';
import { Client } from 'pg';

function appointmentCardFor(page: import('@playwright/test').Page, patientName: string) {
  return page.getByRole('button', {
    name: `Ver agendamentos de ${patientName}`,
    exact: true,
  }).first().locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
}

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
    const appointmentCard = appointmentCardFor(page, patientName);
    const patientHistoryButton = appointmentCard.getByRole('button', {
      name: `Ver agendamentos de ${patientName}`,
    });

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

    const persistedAppointmentCard = appointmentCardFor(page, patientName);
    const persistedTicket = page.getByText(
      new RegExp(`^${ticketLabel} · Paciente #91001$`),
    );

    await expect(persistedTicket).toHaveCount(1);
    await expect(persistedTicket).toBeVisible();
    await expect(
      page.getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`)),
    ).toHaveCount(1);

    await page.reload();
    await expect(page.getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`))).toHaveCount(1);
  });
});

authed.describe.serial('Recepção — alçada do supervisor', () => {
  authed('impede a recepcionista de liberar pendência por exceção', async ({ loginAs, page }) => {
    await loginAs('reception');
    await page.goto('/reception');

    const card = page.getByText('16:00', { exact: true }).locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    );
    await expect(card).toContainText('Paciente E2E A');
    await card.getByRole('button', { name: 'Check-in' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(
        'Resolva as pendências antes do check-in. Seu perfil não possui permissão para liberar este atendimento por exceção.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Liberar entrada por exceção' }),
    ).toBeDisabled();
  });

  authed('exige justificativa, libera e preserva a trilha da exceção', async ({ loginAs, page }, testInfo) => {
    authed.skip(
      testInfo.project.name !== 'chromium',
      'A liberação transacional usa uma única massa e roda uma vez no Chromium.',
    );

    await loginAs('receptionSupervisor');
    await page.goto('/reception');

    const card = page.getByText('16:00', { exact: true }).locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    );
    await expect(card).toContainText('Paciente E2E A');
    await card.getByRole('button', { name: 'Check-in' }).click();

    const dialog = page.getByRole('dialog');
    const reason = dialog.getByLabel('Justificativa da exceção *');
    const release = dialog.getByRole('button', { name: 'Liberar entrada por exceção' });

    await expect(reason).toBeVisible();
    await reason.fill('curta');
    await expect(release).toBeDisabled();

    const justification =
      'Supervisor autorizou atendimento sintético após avaliar a pendência de elegibilidade.';
    await reason.fill(justification);
    await expect(release).toBeEnabled();
    await release.click();

    const receipt = page.getByRole('dialog', {
      name: 'Entrada concluída e conta aberta',
    });
    await expect(receipt).toBeVisible({ timeout: 20_000 });
    await expect(receipt).toContainText('Paciente E2E A · Atendimento #91003');
    const ticket = receipt.getByText(/^Senha \S+$/);
    const ticketLabel = (await ticket.textContent())?.replace(/^Senha\s+/, '').trim();
    expect(ticketLabel).toBeTruthy();

    await receipt.getByRole('button', { name: 'Fechar' }).click();
    await page.reload();
    await expect(
      page.getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`)),
    ).toHaveCount(1);
    await expect(page.getByText('16:00', { exact: true }).locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    )).toContainText('Aguardando');

    const queueRow = page
      .getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`))
      .locator('..')
      .locator('..');
    await queueRow.getByRole('button', {
      name: new RegExp(`^Chamar senha ${ticketLabel}`),
    }).click();
    await expect(queueRow).toContainText('called');
    await page.reload();
    const persistedQueueRow = page
      .getByText(new RegExp(`^${ticketLabel} · Paciente #91001$`))
      .locator('..')
      .locator('..');
    await expect(persistedQueueRow).toContainText('called');

    const databaseUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
      || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    expect(databaseUrl, 'Banco descartável obrigatório para comprovar a auditoria').toBeTruthy();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const history = await client.query<{
        reason: string;
        actor_user_id: string;
        company_id: string;
        unit_id: number;
        exception_authorized: boolean;
      }>(
        `SELECT history.reason,
                history.actor_user_id::text,
                history.company_id::text,
                history.unit_id,
                COALESCE(
                  (history.details->>'exception_authorized')::boolean,
                  false
                ) AS exception_authorized
           FROM public.reception_admin_history history
          WHERE history.appointment_id = 91003
            AND history.to_status = 'checked_in'
          ORDER BY history.id DESC
          LIMIT 1`,
      );

      expect(history.rows).toEqual([
        expect.objectContaining({
          reason: justification,
          actor_user_id: 'eeeeeeee-0000-4000-8000-000000000006',
          company_id: 'eeeeeeee-1000-4000-8000-000000000001',
          unit_id: 91001,
          exception_authorized: true,
        }),
      ]);

      const queueHistory = await client.query<{
        reason: string;
        actor_user_id: string;
        company_id: string;
        unit_id: number;
        from_status: string;
        to_status: string;
      }>(
        `SELECT history.reason,
                history.actor_user_id::text,
                history.company_id::text,
                history.unit_id,
                history.from_status,
                history.to_status
           FROM public.reception_admin_history history
          WHERE history.appointment_id = 91003
            AND history.entity_type = 'reception_queue_ticket'
            AND history.to_status = 'called'
          ORDER BY history.id DESC
          LIMIT 1`,
      );

      expect(queueHistory.rows).toEqual([
        expect.objectContaining({
          reason: 'Atualização pela recepção',
          actor_user_id: 'eeeeeeee-0000-4000-8000-000000000006',
          company_id: 'eeeeeeee-1000-4000-8000-000000000001',
          unit_id: 91001,
          from_status: 'waiting',
          to_status: 'called',
        }),
      ]);
    } finally {
      await client.end();
    }
  });
});

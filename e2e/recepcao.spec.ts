import { clearBrowserAuth, test as authed, expect } from './fixtures/auth';
import { Client } from 'pg';

function appointmentCardFor(
  page: import('@playwright/test').Page,
  patientName: string,
  expectedTime?: string,
) {
  const patientButton = page.getByRole('button', {
    name: `Ver agendamentos de ${patientName}`,
    exact: true,
  });
  const card = patientButton.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
  return expectedTime ? card.filter({ hasText: expectedTime }).first() : card.first();
}

async function waitForReceptionReady(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: /entrada do paciente/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Carregando...', { exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
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

  authed('conclui a cadeia 91001 da Recepção até guia e XML TISS sem duplicar artefatos', async ({ loginAs, page }, testInfo) => {
    authed.slow();
    authed.skip(
      testInfo.project.name !== 'chromium',
      'O cenário transacional usa uma única massa compartilhada e roda uma vez no Chromium.',
    );

    const databaseUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
      || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    expect(databaseUrl, 'Banco descartável obrigatório para correlacionar a jornada').toBeTruthy();
    const fixtureClient = new Client({ connectionString: databaseUrl });
    await fixtureClient.connect();
    try {
      await fixtureClient.query(
        `DELETE FROM public.reception_checkin_workflows WHERE appointment_id = 91001;
         DELETE FROM public.dicom_worklist_queue WHERE appointment_id = 91001;
         DELETE FROM public.tiss_xml WHERE appointment_id = 91001;
         DELETE FROM public.billings WHERE appointment_id = 91001;
         DELETE FROM public.tiss_guides WHERE appointment_id = 91001;
         DELETE FROM public.reception_payments WHERE appointment_id = 91001;
         DELETE FROM public.financial_transactions WHERE appointment_id = 91001;
         DELETE FROM public.billing_accounts WHERE appointment_id = 91001;
         DELETE FROM public.reception_checkin_status_history
          WHERE checkin_id IN (
            SELECT id FROM public.reception_checkins WHERE appointment_id = 91001
          );
         DELETE FROM public.reception_queue_tickets WHERE appointment_id = 91001;
         DELETE FROM public.reception_checkins WHERE appointment_id = 91001;
         UPDATE public.appointments
            SET status = 'scheduled', tp_status = 'agendado', lg_checkin = FALSE
          WHERE id = 91001;

         UPDATE public.insurance_companies
            SET lg_guia_obrigatoria = TRUE
          WHERE id = 91001
            AND company_id = 'eeeeeeee-1000-4000-8000-000000000001';

         INSERT INTO public.insurance_authorizations (
           id, company_id, unit_id, patient_id, appointment_id,
           insurance_id, insurance_plan_id, procedure_id, procedure_desc,
           requester_professional_id, status, protocol_number,
           authorization_number, valid_until, quantity_requested,
           quantity_authorized, created_by, authorized_at
         ) VALUES (
           'eeeeeeee-9104-4000-8000-000000000001',
           'eeeeeeee-1000-4000-8000-000000000001',
           91001, 91001, 91001, 91001, 91001, 91001,
           'Exame SADT E2E', 91001, 'autorizada', 'PROTO-E2E-91001',
           'AUTH-E2E-91001', CURRENT_DATE + 30, 1, 1,
           'eeeeeeee-0000-4000-8000-000000000001', NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           status = 'autorizada',
           protocol_number = EXCLUDED.protocol_number,
           authorization_number = EXCLUDED.authorization_number,
           valid_until = EXCLUDED.valid_until,
           quantity_authorized = 1,
           authorized_at = NOW(),
           updated_at = NOW()`,
      );
    } finally {
      await fixtureClient.end();
    }
    await page.reload();

    const patientName = 'Paciente E2E A';
    const appointmentCard = appointmentCardFor(page, patientName, '14:00');
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

    const preBillingClient = new Client({ connectionString: databaseUrl });
    await preBillingClient.connect();
    let billingAccountId = '';
    try {
      const preBilling = await preBillingClient.query<{
        appointment_id: string;
        checkin_count: string;
        workflow_count: string;
        billing_account_id: string;
        billing_count: string;
        billing_type: string;
        billing_status: string;
        authorization_number: string;
        guide_count: string;
        xml_count: string;
        worklist_count: string;
        worklist_key_matches: boolean;
        worklist_state_matches: boolean;
      }>(
        `SELECT appointment.id::text AS appointment_id,
                count(DISTINCT checkin.id)::text AS checkin_count,
                count(DISTINCT workflow.id)::text AS workflow_count,
                min(billing.id::text) AS billing_account_id,
                count(DISTINCT billing.id)::text AS billing_count,
                min(billing.billing_type) AS billing_type,
                min(billing.status) AS billing_status,
                min(billing.authorization_number) AS authorization_number,
                count(DISTINCT guide.id)::text AS guide_count,
                count(DISTINCT xml.id)::text AS xml_count,
                count(DISTINCT worklist.id)::text AS worklist_count,
                bool_and(worklist.idempotency_key = workflow.idempotency_key)
                  AS worklist_key_matches,
                bool_and(
                  imaging_order.status = 'liberado_worklist'
                  AND imaging_item.status = 'liberado_worklist'
                  AND worklist.imaging_order_item_id = imaging_item.id
                ) AS worklist_state_matches
           FROM public.appointments appointment
           LEFT JOIN public.reception_checkins checkin
             ON checkin.appointment_id = appointment.id
           LEFT JOIN public.reception_checkin_workflows workflow
             ON workflow.appointment_id = appointment.id
           LEFT JOIN public.billing_accounts billing
             ON billing.appointment_id = appointment.id
           LEFT JOIN public.tiss_guides guide
             ON guide.appointment_id = appointment.id
           LEFT JOIN public.dicom_worklist_queue worklist
             ON worklist.appointment_id = appointment.id
           LEFT JOIN public.imaging_orders imaging_order
             ON imaging_order.appointment_id = appointment.id
            AND imaging_order.company_id = appointment.company_id
            AND imaging_order.unit_id = appointment.unit_id
           LEFT JOIN public.imaging_order_items imaging_item
             ON imaging_item.imaging_order_id = imaging_order.id
            AND imaging_item.company_id = imaging_order.company_id
            AND imaging_item.unit_id = imaging_order.unit_id
           LEFT JOIN public.tiss_xml xml
             ON xml.appointment_id = appointment.id
          WHERE appointment.id = 91001
          GROUP BY appointment.id`,
      );

      expect(preBilling.rows).toEqual([{
        appointment_id: '91001',
        checkin_count: '1',
        workflow_count: '1',
        billing_account_id: expect.any(String),
        billing_count: '1',
        billing_type: 'convenio',
        billing_status: 'aberta',
        authorization_number: 'AUTH-E2E-91001',
        guide_count: '0',
        xml_count: '0',
        worklist_count: '1',
        worklist_key_matches: true,
        worklist_state_matches: true,
      }]);
      billingAccountId = preBilling.rows[0].billing_account_id;
    } finally {
      await preBillingClient.end();
    }

    await clearBrowserAuth(page);
    await loginAs('admin');
    const focusedBillingUrl = `/billing-accounts?account=${billingAccountId}&appointment=91001`;
    await page.goto(focusedBillingUrl);
    const accountDialog = page.getByRole('dialog', { name: 'Conferência da Conta' });
    await expect(accountDialog).toBeVisible();
    await expect(accountDialog).toContainText('AUTH-E2E-91001');
    await accountDialog.getByRole('button', { name: 'Revisar pendências' }).click();
    await expect(page.getByText('Conta revisada sem bloqueios', { exact: true })).toBeVisible();
    await accountDialog.getByRole('button', { name: 'Fechar' }).click();

    await page.getByRole('tab', { name: 'Auditoria' }).click();
    const auditRow = page.getByRole('row').filter({ hasText: patientName });
    await expect(auditRow).toBeVisible();
    await auditRow.getByRole('button', { name: 'Assumir' }).click();
    await expect(page.getByText('Conta assumida para auditoria', { exact: true })).toBeVisible();
    await expect(auditRow.getByRole('button', { name: 'Decidir' })).toBeVisible();
    await auditRow.getByRole('button', { name: 'Decidir' }).click();

    const decisionDialog = page.getByRole('dialog', { name: 'Decisão da auditoria' });
    await decisionDialog.getByLabel('Parecer').fill(
      'Conta sintética conferida e apta para materialização TISS em homologação.',
    );
    await decisionDialog.getByLabel('Evidência verificada').fill(
      'Carteirinha, autorização, procedimento, valor e vínculo ao agendamento 91001 conferidos.',
    );
    await decisionDialog.getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByText('Conta aprovada para envio', { exact: true })).toBeVisible();

    await page.goto(focusedBillingUrl);
    const readyAccountDialog = page.getByRole('dialog', { name: 'Conferência da Conta' });
    const materializeButton = readyAccountDialog.getByRole('button', {
      name: 'Gerar guia e XML TISS',
    });
    await expect(materializeButton).toBeVisible();
    await materializeButton.click();
    await expect(page.getByText('Guia e XML TISS materializados', { exact: true })).toBeVisible();
    await expect(materializeButton).toBeEnabled();
    await materializeButton.click();
    await expect(page.getByText('Guia e XML TISS materializados', { exact: true })).toBeVisible();

    const finalClient = new Client({ connectionString: databaseUrl });
    await finalClient.connect();
    try {
      const finalChain = await finalClient.query<{
        appointment_id: string;
        billing_account_id: string;
        billing_status: string;
        billing_count: string;
        guide_count: string;
        xml_count: string;
        linked_guide_count: string;
        linked_xml_count: string;
        xml_statuses: string;
        sent_xml_count: string;
      }>(
        `SELECT appointment.id::text AS appointment_id,
                min(billing.id::text) AS billing_account_id,
                min(billing.status) AS billing_status,
                count(DISTINCT billing.id)::text AS billing_count,
                count(DISTINCT guide.id)::text AS guide_count,
                count(DISTINCT xml.id)::text AS xml_count,
                count(DISTINCT guide.id) FILTER (
                  WHERE guide.billing_account_id = billing.id
                    AND guide.company_id = billing.company_id
                    AND guide.unit_id = billing.unit_id
                )::text AS linked_guide_count,
                count(DISTINCT xml.id) FILTER (
                  WHERE xml.billing_account_id = billing.id
                    AND xml.guide_id = guide.id
                    AND xml.company_id = billing.company_id
                    AND xml.unit_id = billing.unit_id
                )::text AS linked_xml_count,
                string_agg(DISTINCT xml.status, ',' ORDER BY xml.status) AS xml_statuses,
                count(DISTINCT xml.id) FILTER (
                  WHERE lower(COALESCE(xml.status, '')) IN ('enviado', 'transmitido', 'sent')
                )::text AS sent_xml_count
           FROM public.appointments appointment
           JOIN public.billing_accounts billing ON billing.appointment_id = appointment.id
           LEFT JOIN public.tiss_guides guide ON guide.appointment_id = appointment.id
           LEFT JOIN public.tiss_xml xml ON xml.appointment_id = appointment.id
          WHERE appointment.id = 91001
          GROUP BY appointment.id`,
      );

      expect(finalChain.rows).toEqual([{
        appointment_id: '91001',
        billing_account_id: billingAccountId,
        billing_status: 'pronta_envio',
        billing_count: '1',
        guide_count: '1',
        xml_count: '1',
        linked_guide_count: '1',
        linked_xml_count: '1',
        xml_statuses: 'PENDENTE',
        sent_xml_count: '0',
      }]);
    } finally {
      await finalClient.end();
    }
  });
});
authed.describe.serial('Recepção — alçada do supervisor', () => {
  authed('impede a recepcionista de liberar pendência por exceção', async ({ loginAs, page }) => {
    authed.slow();
    await loginAs('reception');
    await page.goto('/reception');
    await waitForReceptionReady(page);

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
    authed.slow();
    authed.skip(
      testInfo.project.name !== 'chromium',
      'A liberação transacional usa uma única massa e roda uma vez no Chromium.',
    );

    await loginAs('receptionSupervisor');
    await page.goto('/reception');
    await waitForReceptionReady(page);

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
    await waitForReceptionReady(page);
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
    await waitForReceptionReady(page);
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

      const worklist = await client.query<{
        worklist_count: string;
        order_status: string;
        item_status: string;
      }>(
        `SELECT count(DISTINCT queue.id)::text AS worklist_count,
                imaging_order.status AS order_status,
                imaging_item.status AS item_status
           FROM public.dicom_worklist_queue queue
           JOIN public.imaging_order_items imaging_item
             ON imaging_item.id = queue.imaging_order_item_id
           JOIN public.imaging_orders imaging_order
             ON imaging_order.id = imaging_item.imaging_order_id
          WHERE queue.appointment_id = 91003
          GROUP BY imaging_order.status, imaging_item.status`,
      );

      expect(worklist.rows).toEqual([{
        worklist_count: '1',
        order_status: 'liberado_worklist',
        item_status: 'liberado_worklist',
      }]);
    } finally {
      await client.end();
    }
  });
});

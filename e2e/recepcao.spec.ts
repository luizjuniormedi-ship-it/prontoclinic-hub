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

function ticketForPatient(
  page: import('@playwright/test').Page,
  ticketLabel: string,
  patientId: number,
) {
  const escapedTicketLabel = ticketLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByText(
    new RegExp(`^${escapedTicketLabel} · Paciente #${patientId}$`),
  );
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

  authed('reutiliza o appointment_id da Agenda até Recepção, conta, guia e XML TISS', async ({ loginAs, page }, testInfo) => {
    authed.slow();
    authed.skip(
      testInfo.project.name !== 'chromium',
      'O cenário transacional usa uma única massa compartilhada e roda uma vez no Chromium.',
    );

    const databaseUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
      || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    expect(databaseUrl, 'Banco descartável obrigatório para correlacionar a jornada').toBeTruthy();
    const marker = `E2E_RECEPTION_TISS_${Date.now()}`;
    const appointmentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const authorizationNumber = `AUTH-${Date.now()}`.slice(0, 20);
    const candidateTimes = Array.from({ length: 20 }, (_, index) => {
      const minutes = (8 * 60) + (index * 30);
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    });
    const availabilityClient = new Client({ connectionString: databaseUrl });
    await availabilityClient.connect();
    let appointmentTime = '';
    try {
      const occupied = await availabilityClient.query<{ start_time: string }>(
        `SELECT to_char(start_time, 'HH24:MI') AS start_time
           FROM public.appointments
          WHERE professional_id = 91001
            AND appointment_date = $1::date
            AND status NOT IN ('cancelled', 'canceled')`,
        [appointmentDate],
      );
      const occupiedTimes = new Set(occupied.rows.map((row) => row.start_time));
      appointmentTime = candidateTimes.find((time) => !occupiedTimes.has(time)) || '';
    } finally {
      await availabilityClient.end();
    }
    expect(appointmentTime, 'A Agenda deve oferecer ao menos um horário livre no dia').not.toBe('');

    await clearBrowserAuth(page);
    await loginAs('admin');
    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();
    const scheduleDialog = page.getByRole('dialog', { name: /novo agendamento/i });
    await scheduleDialog.getByRole('textbox', { name: /buscar paciente para agendamento/i }).fill('Paciente E2E A');
    await scheduleDialog.getByRole('combobox', { name: /selecionar paciente/i }).click();
    await page.getByRole('option', { name: /Paciente E2E A/ }).click();
    await scheduleDialog.getByRole('combobox', { name: /selecionar tipo de atendimento/i }).click();
    await page.getByRole('option', { name: /Exame SADT E2E/i }).click();
    await scheduleDialog.getByRole('combobox', { name: /selecionar profissional/i }).click();
    await page.getByRole('option', { name: /Médico E2E/ }).click();
    await scheduleDialog.getByRole('combobox', { name: /selecionar serviço ou procedimento/i }).click();
    await page.getByRole('option', { name: /Ultrassonografia SADT E2E/i }).click();
    await scheduleDialog.getByRole('combobox', { name: /selecionar convênio/i }).click();
    await page.getByRole('option', { name: /Convênio Sintético E2E/i }).click();
    await scheduleDialog.getByRole('combobox', { name: /selecionar plano do convênio/i }).click();
    await page.getByRole('option', { name: /Plano SADT Sintético E2E/i }).click();
    const insuranceCardNumber = 'E2E-CARD-91001';
    await scheduleDialog.getByLabel(/Carteirinha\/matrícula/i).fill(insuranceCardNumber);
    await scheduleDialog.getByLabel('Autorização').fill(authorizationNumber);
    await scheduleDialog.getByLabel('Data *').fill(appointmentDate);
    await scheduleDialog.getByLabel(/observações/i).fill(marker);
    const submitAppointment = scheduleDialog.getByRole('button', { name: /^agendar$/i });
    await scheduleDialog.getByLabel('Início *').fill(appointmentTime);
    await expect(submitAppointment).toBeEnabled({ timeout: 5_000 });
    await submitAppointment.click();
    await expect(page.getByText('Agendamento criado com sucesso', { exact: true })).toBeVisible();

    const fixtureClient = new Client({ connectionString: databaseUrl });
    await fixtureClient.connect();
    let appointmentId = 0;
    try {
      const created = await fixtureClient.query<{ id: string }>(
        `SELECT id::text
           FROM public.appointments
          WHERE notes = $1
          ORDER BY id DESC
          LIMIT 1`,
        [marker],
      );
      expect(created.rows).toHaveLength(1);
      appointmentId = Number(created.rows[0].id);
      expect(Number.isSafeInteger(appointmentId)).toBe(true);
      await fixtureClient.query(
        `WITH imaging_order AS (
           INSERT INTO public.imaging_orders (
             company_id, unit_id, appointment_id, patient_id,
             requesting_physician_id, referring_physician_name,
             clinical_indication, priority, accession_number, status, created_by
           ) VALUES (
             'eeeeeeee-1000-4000-8000-000000000001', 91001, $1, 91001,
             91001, 'Médico E2E',
             'Solicitação sintética para homologar Recepcao -> Worklist',
             'normal', $2, 'agendado',
             'eeeeeeee-0000-4000-8000-000000000001'
           )
           RETURNING id
         )
         INSERT INTO public.imaging_order_items (
           company_id, unit_id, imaging_order_id, service_id,
           exam_code, exam_name, modality_type, body_part, laterality,
           contrast_required, station_aetitle, scheduled_datetime,
           requested_procedure_id, scheduled_procedure_step_id, status
         )
         SELECT 'eeeeeeee-1000-4000-8000-000000000001', 91001, imaging_order.id, 91001,
                'E2E-USG', 'Ultrassonografia sintética E2E', 'US', 'ABDOME', 'na',
                FALSE, 'PRONTOMEDIC', ($3::date + $4::time),
                'E2E-RP-' || $1::text, 'E2E-SPS-' || $1::text, 'agendado'
           FROM imaging_order`,
        [appointmentId, `PME2E${appointmentId}`, appointmentDate, appointmentTime],
      );
    } finally {
      await fixtureClient.end();
    }

    await clearBrowserAuth(page);
    await loginAs('reception');
    await page.goto('/reception');
    await waitForReceptionReady(page);

    const patientName = 'Paciente E2E A';
    const appointmentCard = appointmentCardFor(page, patientName, appointmentTime);
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
    await expect(receiptDialog).toContainText(`${patientName} · Atendimento #${appointmentId}`);

    const ticket = receiptDialog.getByText(/^Senha \S+$/);
    await expect(ticket).toBeVisible();
    const ticketLabel = (await ticket.textContent())?.replace(/^Senha\s+/, '').trim();
    expect(ticketLabel, 'A Recepção deve exibir a senha persistida').toBeTruthy();

    await receiptDialog.getByRole('button', { name: 'Fechar' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: /entrada do paciente/i })).toBeVisible();

    const persistedAppointmentCard = appointmentCardFor(page, patientName);
    const persistedTicket = ticketForPatient(page, ticketLabel!, 91001);

    await expect(persistedTicket).toHaveCount(1);
    await expect(persistedTicket).toBeVisible();
    await expect(
      ticketForPatient(page, ticketLabel!, 91001),
    ).toHaveCount(1);

    await page.reload();
    await expect(ticketForPatient(page, ticketLabel!, 91001)).toHaveCount(1);

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
           WHERE appointment.id = ${appointmentId}
          GROUP BY appointment.id`,
      );

      expect(preBilling.rows).toEqual([{
        appointment_id: String(appointmentId),
        checkin_count: '1',
        workflow_count: '1',
        billing_account_id: expect.any(String),
        billing_count: '1',
        billing_type: 'convenio',
        billing_status: 'aberta',
        authorization_number: authorizationNumber,
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
    const focusedBillingUrl = `/billing-accounts?account=${billingAccountId}&appointment=${appointmentId}`;
    await page.goto(focusedBillingUrl);
    const accountDialog = page.getByRole('dialog', { name: 'Conferência da Conta' });
    await expect(accountDialog).toBeVisible();
    await expect(accountDialog).toContainText(authorizationNumber);
    await accountDialog.getByRole('button', { name: 'Revisar pendências' }).click();
    await expect(page.getByText('Conta revisada sem bloqueios', { exact: true })).toBeVisible();
    await accountDialog.getByRole('button', { name: 'Fechar' }).click();

    await page.getByRole('tab', { name: 'Auditoria' }).click();
    const auditRow = page.getByTestId(`billing-audit-${billingAccountId}`);
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
      `Carteirinha, autorização, procedimento, valor e vínculo ao agendamento ${appointmentId} conferidos.`,
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
        xml_has_insurance_card: boolean;
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
                )::text AS sent_xml_count,
                bool_and(position($1 IN COALESCE(xml.bl_xml_enviado, '')) > 0)
                  AS xml_has_insurance_card
           FROM public.appointments appointment
           JOIN public.billing_accounts billing ON billing.appointment_id = appointment.id
           LEFT JOIN public.tiss_guides guide ON guide.appointment_id = appointment.id
           LEFT JOIN public.tiss_xml xml ON xml.appointment_id = appointment.id
           WHERE appointment.id = ${appointmentId}
          GROUP BY appointment.id`,
        [insuranceCardNumber],
      );

      expect(finalChain.rows).toEqual([{
        appointment_id: String(appointmentId),
        billing_account_id: billingAccountId,
        billing_status: 'pronta_envio',
        billing_count: '1',
        guide_count: '1',
        xml_count: '1',
        linked_guide_count: '1',
        linked_xml_count: '1',
        xml_statuses: 'PENDENTE',
        sent_xml_count: '0',
        xml_has_insurance_card: true,
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
      ticketForPatient(page, ticketLabel!, 91001),
    ).toHaveCount(1);
    await expect(page.getByText('16:00', { exact: true }).locator(
      'xpath=ancestor::div[contains(@class, "rounded-lg")][1]',
    )).toContainText('Aguardando');

    const queueRow = ticketForPatient(page, ticketLabel!, 91001)
      .locator('..')
      .locator('..');
    await queueRow.getByRole('button', {
      name: new RegExp(`^Chamar senha ${ticketLabel}`),
    }).click();
    await expect(queueRow).toContainText('called');
    await page.reload();
    await waitForReceptionReady(page);
    const persistedQueueRow = ticketForPatient(page, ticketLabel!, 91001)
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

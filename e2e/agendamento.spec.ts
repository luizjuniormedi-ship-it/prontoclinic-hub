import { expect, test as authed } from './fixtures/auth';
import { Client } from 'pg';

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
    const databaseUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
      || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    expect(databaseUrl, 'Banco descartável obrigatório para selecionar uma vaga livre').toBeTruthy();
    const appointmentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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

    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();

    await page.getByRole('textbox', { name: /buscar paciente para agendamento/i }).fill('PACIENTE');
    await page.getByRole('combobox', { name: /selecionar paciente/i }).click();
    await page.getByRole('option').first().click();

    await page.getByRole('combobox', { name: /selecionar profissional/i }).click();
    await page.getByRole('option', { name: /Médico E2E/ }).click();

    await page.getByLabel('Início *').fill(appointmentTime);
    await page.getByLabel(/observações/i).fill('E2E_AGENDA_PERSISTENCIA');

    await expect(page.getByLabel('Fim')).toHaveValue(/.+/);
    await page.getByRole('button', { name: /^agendar$/i }).click();
    await expect(page.getByRole('dialog', { name: /novo agendamento/i })).toHaveCount(0);
    await expect(page.getByText('Agendamento criado com sucesso', { exact: true })).toBeVisible();

    await page.getByRole('textbox', { name: /buscar agendamento/i }).fill('PACIENTE');
    const createdRow = page.getByRole('gridcell', {
      name: new RegExp(`${appointmentTime}, PACIENTE`, 'i'),
    }).first();
    await expect(createdRow).toBeVisible();
    await createdRow.getByRole('button', { name: /mais ações para/i }).click();
    await page.getByRole('menuitem', { name: /cancelar/i }).click();
    await page.getByRole('dialog', { name: /cancelar agendamento/i }).getByLabel(/motivo/i).fill('Limpeza da fixture E2E');
    await page.getByRole('dialog', { name: /cancelar agendamento/i }).getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText('Agendamento cancelado', { exact: true })).toBeVisible();
  });

  authed('cria série conveniada pela UI sem perder plano, carteirinha ou autorização', async ({ page }) => {
    authed.slow();
    const databaseUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
      || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    expect(databaseUrl, 'Banco descartável obrigatório para validar a série').toBeTruthy();

    const marker = `E2E_SERIE_CONVENIO_${Date.now()}`;
    const futureDate = new Date(Date.now() + (365 + (Date.now() % 180)) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await page.goto('/schedule');
    await page.getByRole('button', { name: /criar novo agendamento/i }).click();
    const dialog = page.getByRole('dialog', { name: /novo agendamento/i });

    await dialog.getByRole('textbox', { name: /buscar paciente para agendamento/i }).fill('Paciente E2E A');
    await dialog.getByRole('combobox', { name: /selecionar paciente/i }).click();
    await page.getByRole('option', { name: /Paciente E2E A/ }).click();
    await dialog.getByRole('combobox', { name: /selecionar profissional/i }).click();
    await page.getByRole('option', { name: /Médico E2E/ }).click();
    await dialog.getByRole('combobox', { name: /selecionar serviço ou procedimento/i }).click();
    await page.getByRole('option', { name: /Ultrassonografia SADT E2E/i }).click();
    await dialog.getByRole('combobox', { name: /selecionar convênio/i }).click();
    await page.getByRole('option', { name: /Convênio Sintético E2E/i }).click();
    await dialog.getByRole('combobox', { name: /selecionar plano do convênio/i }).click();
    await page.getByRole('option', { name: /Plano SADT Sintético E2E/i }).click();
    await dialog.getByLabel(/Carteirinha\/matrícula/i).fill('E2E-CARD-91001');
    await dialog.getByLabel('Autorização').fill('AUTH-SERIE-E2E');
    await dialog.getByLabel('Data *').fill(futureDate);
    await dialog.getByLabel('Início *').fill('22:50');
    await dialog.getByLabel(/observações/i).fill(marker);
    await dialog.getByLabel(/repetir semanalmente/i).click();
    await dialog.getByLabel(/quantidade de ocorrências/i).fill('2');
    await dialog.getByRole('button', { name: /^agendar$/i }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Série com 2 agendamentos criada', { exact: true })).toBeVisible();

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{
        series_id: string;
        appointment_ids: string[];
        occurrence_count: string;
        insurance_matches: boolean;
        plan_matches: boolean;
        card_matches: boolean;
        authorization_matches: boolean;
        authorization_count: string;
      }>(
        `SELECT series.id::text AS series_id,
                array_agg(appointment.id::text ORDER BY item.occurrence_number) AS appointment_ids,
                count(*)::text AS occurrence_count,
                bool_and(appointment.insurance_company_id = 91001) AS insurance_matches,
                bool_and(appointment.insurance_plan_id = 91001) AS plan_matches,
                bool_and(patient_insurance.card_number = 'E2E-CARD-91001') AS card_matches,
                bool_and(authz.authorization_number = 'AUTH-SERIE-E2E') AS authorization_matches,
                count(DISTINCT authz.id)::text AS authorization_count
           FROM public.appointment_series series
           JOIN public.appointment_series_items item ON item.series_id = series.id
           JOIN public.appointments appointment ON appointment.id = item.appointment_id
           JOIN public.patient_insurances patient_insurance
             ON patient_insurance.patient_id = appointment.patient_id
            AND patient_insurance.company_id = appointment.company_id
            AND patient_insurance.insurance_plan_id = appointment.insurance_plan_id
            AND patient_insurance.status = 'active'
           LEFT JOIN public.insurance_authorizations authz
             ON authz.appointment_id = appointment.id
            AND authz.company_id = appointment.company_id
            AND authz.unit_id = appointment.unit_id
            AND authz.authorization_number = 'AUTH-SERIE-E2E'
          WHERE appointment.notes = $1
          GROUP BY series.id`,
        [marker],
      );

      expect(result.rows).toEqual([expect.objectContaining({
        series_id: expect.any(String),
        occurrence_count: '2',
        insurance_matches: true,
        plan_matches: true,
        card_matches: true,
        authorization_matches: true,
        authorization_count: '2',
      })]);

    } finally {
      await client.end();
    }
  });

  authed('abre menu de acao rapida de um agendamento existente', async ({ page }) => {
    await page.goto('/schedule');

    await page.getByRole('button', { name: /mais ações para/i }).first().click();
    await expect(page.getByRole('menuitem', { name: /check-in|remarcar|cancelar|registrar falta/i }).first()).toBeVisible();
  });
});

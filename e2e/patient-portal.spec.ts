import { createRequire } from "node:module";
import { test, expect } from "./fixtures/auth";
import type { Page } from "@playwright/test";

test.use({ bypassCSP: true });

type QueryResult<Row> = { rows: Row[] };
type PgClient = {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (config: { connectionString: string }) => PgClient;
};

const mutationProject =
  process.env.E2E_PATIENT_MUTATION_PROJECT || "chromium";

type PatientFixture = {
  appointmentIds: {
    confirm: string;
    cancel: string;
    reschedule: string;
  };
  targetDate: string;
  professionalId: string;
  scheduleId: string;
};

let fixture: PatientFixture | null = null;

function requireLocalPatientFixture() {
  test.skip(
    process.env.E2E_ENV !== "local",
    "Portal QA paciente restrito ao ambiente local",
  );
  test.skip(
    !process.env.E2E_PATIENT_EMAIL || !process.env.E2E_PATIENT_PASSWORD,
    "Defina as credenciais sintéticas E2E_PATIENT_* provisionadas pelo seed local",
  );
}

function requireLocalMutationGuard(projectName: string) {
  requireLocalPatientFixture();
  test.skip(
    projectName !== mutationProject,
    `Mutações do portal são isoladas no projeto ${mutationProject}`,
  );
  test.skip(
    process.env.E2E_MODE !== "mutating"
      || process.env.E2E_ALLOW_LOCAL_MUTATIONS !== "true"
      || !process.env.E2E_PATIENT_FIXTURE_DATABASE_URL,
    "Mutação exige modo local, autorização e banco descartável de fixtures",
  );
}

function fixtureDatabaseUrl(): string {
  const rawUrl = process.env.E2E_PATIENT_FIXTURE_DATABASE_URL;
  if (!rawUrl) {
    throw new Error("E2E_PATIENT_FIXTURE_DATABASE_URL não configurada.");
  }

  const parsed = new URL(rawUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !/(test|e2e|replay)/i.test(databaseName)
  ) {
    throw new Error(
      "Fixtures mutáveis exigem PostgreSQL local com nome test/e2e/replay.",
    );
  }
  return rawUrl;
}

async function createUniqueFixture(): Promise<PatientFixture> {
  const email = process.env.E2E_PATIENT_EMAIL;
  if (!email) throw new Error("E2E_PATIENT_EMAIL não configurado.");

  const client = new Client({ connectionString: fixtureDatabaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    const context = await client.query<{
      patient_id: string;
      company_id: string;
      unit_id: number;
    }>(
      `
        SELECT
          patient.id::text AS patient_id,
          patient.company_id::text AS company_id,
          patient.unit_id
        FROM public.patients patient
        JOIN auth.users auth_user
          ON auth_user.id = patient.user_id
        WHERE lower(auth_user.email) = lower($1)
          AND patient.lg_ativo IS TRUE
          AND patient.unit_id IS NOT NULL
      `,
      [email],
    );
    if (context.rows.length !== 1) {
      throw new Error(
        "A conta E2E deve possuir exatamente um paciente ativo com unidade.",
      );
    }

    const runId = `${Date.now()}-${process.pid}`;
    const patient = context.rows[0];
    const professional = await client.query<{ id: string }>(
      `
        INSERT INTO public.professionals(
          company_id,
          full_name,
          lg_ativo
        )
        VALUES ($1::uuid, $2, TRUE)
        RETURNING id::text
      `,
      [patient.company_id, `Profissional Portal E2E ${runId}`],
    );

    const schedule = await client.query<{
      id: string;
      target_date: string;
    }>(
      `
        WITH clinic_date AS (
          SELECT
            (timezone('America/Sao_Paulo', now())::date + 10) AS target_date
        )
        INSERT INTO public.professional_schedules(
          company_id,
          professional_id,
          unit_id,
          day_of_week,
          lg_habilitado,
          slot1_start,
          slot1_end,
          slot1_duration,
          slot1_unit_id
        )
        SELECT
          $1::uuid,
          $2::bigint,
          $3::integer,
          (
            ARRAY[
              'domingo',
              'segunda-feira',
              'terça-feira',
              'quarta-feira',
              'quinta-feira',
              'sexta-feira',
              'sábado'
            ]
          )[extract(dow FROM target_date)::integer + 1],
          TRUE,
          1400,
          1600,
          30,
          $3::integer
        FROM clinic_date
        RETURNING
          id::text,
          (
            timezone('America/Sao_Paulo', now())::date + 10
          )::text AS target_date
      `,
      [patient.company_id, professional.rows[0].id, patient.unit_id],
    );

    const appointments = await client.query<{
      id: string;
      fixture_kind: "confirm" | "cancel" | "reschedule";
    }>(
      `
        WITH clinic_date AS (
          SELECT timezone('America/Sao_Paulo', now())::date AS today
        ),
        fixture_rows(fixture_kind, day_offset, start_time) AS (
          VALUES
            ('confirm'::text, 1, TIME '09:00'),
            ('cancel'::text, 8, TIME '10:00'),
            ('reschedule'::text, 3, TIME '11:00')
        )
        INSERT INTO public.appointments(
          company_id,
          unit_id,
          patient_id,
          professional_id,
          appointment_date,
          start_time,
          end_time,
          duration_minutes,
          status,
          notes
        )
        SELECT
          $1::uuid,
          $2::integer,
          $3::bigint,
          $4::bigint,
          clinic_date.today + fixture_rows.day_offset,
          fixture_rows.start_time,
          fixture_rows.start_time + INTERVAL '30 minutes',
          30,
          'scheduled',
          $5 || ':' || fixture_rows.fixture_kind
        FROM clinic_date
        CROSS JOIN fixture_rows
        RETURNING
          id::text,
          split_part(notes, ':', 3) AS fixture_kind
      `,
      [
        patient.company_id,
        patient.unit_id,
        patient.patient_id,
        professional.rows[0].id,
        `E2E_PATIENT_PORTAL:${runId}`,
      ],
    );

    const ids = Object.fromEntries(
      appointments.rows.map((row) => [row.fixture_kind, row.id]),
    ) as PatientFixture["appointmentIds"];
    if (!ids.confirm || !ids.cancel || !ids.reschedule) {
      throw new Error("Falha ao criar as três fixtures isoladas do portal.");
    }

    await client.query("COMMIT");
    return {
      appointmentIds: ids,
      targetDate: schedule.rows[0].target_date,
      professionalId: professional.rows[0].id,
      scheduleId: schedule.rows[0].id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function deleteUniqueFixture(currentFixture: PatientFixture) {
  const appointmentIds = Object.values(currentFixture.appointmentIds);
  const client = new Client({ connectionString: fixtureDatabaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM public.scheduling_reschedules WHERE appointment_id = ANY($1::bigint[])",
      [appointmentIds],
    );
    await client.query(
      "DELETE FROM public.scheduling_status_history WHERE appointment_id = ANY($1::bigint[])",
      [appointmentIds],
    );
    await client.query(
      "DELETE FROM public.appointments WHERE id = ANY($1::bigint[])",
      [appointmentIds],
    );
    await client.query(
      "DELETE FROM public.professional_schedules WHERE id = $1::bigint",
      [currentFixture.scheduleId],
    );
    await client.query(
      "DELETE FROM public.professionals WHERE id = $1::bigint",
      [currentFixture.professionalId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function openPortal(page: Page) {
  const email = process.env.E2E_PATIENT_EMAIL;
  const password = process.env.E2E_PATIENT_PASSWORD;
  if (!email || !password) {
    throw new Error("Credenciais sintéticas E2E_PATIENT_* não configuradas.");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("textbox", { name: "Senha" }).fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  await page.goto("/meus-agendamentos");
  await expect(
    page.getByRole("heading", { name: "Meus Agendamentos", exact: true }),
  ).toBeVisible();
}

function appointmentById(page: Page, id: string) {
  return page.locator(`li[data-appointment-id="${id}"]`);
}

test.describe("Portal do paciente mobile @readonly @local", () => {
  test.beforeEach(() => {
    requireLocalPatientFixture();
  });

  test("autentica a conta sintética e renderiza o portal sem erro", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await openPortal(page);

    await expect(
      page.getByText(/próximos \(\d+\)/i),
    ).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth
        > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(browserErrors, browserErrors.join("\n")).toEqual([]);
  });
});

test.describe("Portal do paciente @mutating @local", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async (_fixtures, workerInfo) => {
    if (
      workerInfo.project.name === mutationProject
      && process.env.E2E_ENV === "local"
      && process.env.E2E_MODE === "mutating"
      && process.env.E2E_ALLOW_LOCAL_MUTATIONS === "true"
      && process.env.E2E_PATIENT_FIXTURE_DATABASE_URL
    ) {
      fixture = await createUniqueFixture();
    }
  });

  test.afterAll(async (_fixtures, workerInfo) => {
    if (workerInfo.project.name === mutationProject && fixture) {
      await deleteUniqueFixture(fixture);
      fixture = null;
    }
  });

  test.beforeEach((_fixtures, testInfo) => {
    requireLocalMutationGuard(testInfo.project.name);
    if (!fixture) {
      throw new Error("Fixture isolada do portal não foi criada.");
    }
  });

  test("confirma presença e preserva o status após reload", async ({ page }) => {
    await openPortal(page);
    const appointment = appointmentById(
      page,
      fixture!.appointmentIds.confirm,
    );

    await appointment.getByRole("button", { name: /confirmar presença/i }).click();
    await expect(appointment.getByText(/confirmado/i)).toBeVisible();

    await page.reload();
    await expect(
      appointmentById(page, fixture!.appointmentIds.confirm)
        .getByText(/confirmado/i),
    ).toBeVisible();
  });

  test("cancela agendamento com motivo e preserva o status após reload", async ({ page }) => {
    await openPortal(page);
    const appointment = appointmentById(
      page,
      fixture!.appointmentIds.cancel,
    );

    await appointment.getByRole("button", { name: /^cancelar$/i }).click();
    await page.getByLabel(/motivo/i).fill(
      "Cancelamento sintético do portal local",
    );
    await page.getByRole(
      "button",
      { name: /confirmar cancelamento/i },
    ).click();
    await expect(appointment.getByText(/cancelado/i)).toBeVisible();

    await page.reload();
    await expect(
      appointmentById(page, fixture!.appointmentIds.cancel)
        .getByText(/cancelado/i),
    ).toBeVisible();
  });

  test("reagenda em slot válido e preserva o novo horário após reload", async ({ page }) => {
    await openPortal(page);
    const appointment = appointmentById(
      page,
      fixture!.appointmentIds.reschedule,
    );

    await appointment.getByRole("button", { name: /reagendar/i }).click();
    await page.getByLabel("Nova data").fill(fixture!.targetDate);
    await page.getByLabel("Novo horário").fill("14:00");
    await page.getByLabel("Motivo").fill(
      "Reagendamento sintético persistente",
    );
    await page.getByRole(
      "button",
      { name: /confirmar reagendamento/i },
    ).click();

    await expect(
      page.getByText("Agendamento reagendado.", { exact: true }),
    ).toBeVisible();
    await expect(
      appointmentById(page, fixture!.appointmentIds.reschedule)
        .locator(`time[datetime="${fixture!.targetDate}"]`),
    ).toBeVisible();
    await expect(
      appointmentById(page, fixture!.appointmentIds.reschedule)
        .getByText("14:00", { exact: true }),
    ).toBeVisible();

    await page.reload();
    const persistedAppointment = appointmentById(
      page,
      fixture!.appointmentIds.reschedule,
    );
    await expect(
      persistedAppointment.locator(
        `time[datetime="${fixture!.targetDate}"]`,
      ),
    ).toBeVisible();
    await expect(
      persistedAppointment.getByText("14:00", { exact: true }),
    ).toBeVisible();
  });
});

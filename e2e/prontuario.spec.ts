import { test as authed, expect } from './fixtures/auth';

const APPOINTMENT_ID = '991303';

authed.describe('Prontuário', () => {
  authed.describe.configure({ mode: 'serial', retries: 0 });

  authed('recepção inicia atendimento e médico persiste o prontuário', async ({ page, loginAs }) => {
    const marker = `E2E prontuario ${Date.now()}`;

    await loginAs('reception');
    const appointmentsResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/appointments') && response.request().method() === 'GET';
    });
    const patientsResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/patients') && url.searchParams.has('id') && response.request().method() === 'GET';
    });

    await page.goto('/reception');
    const appointmentsResponse = await appointmentsResponsePromise;
    expect(appointmentsResponse.ok()).toBeTruthy();
    const appointments = await appointmentsResponse.json() as Array<{
      id: string | number;
      patient_id: string | number;
      start_time: string;
      status: string;
    }>;

    const patientsResponse = await patientsResponsePromise;
    expect(patientsResponse.ok()).toBeTruthy();
    const patients = await patientsResponse.json() as Array<{ id: string | number; full_name: string }>;

    const appointment = appointments.find(({ id }) => String(id) === APPOINTMENT_ID);
    expect(appointment).toBeDefined();
    expect(appointment?.status).toBe('waiting');

    const patient = patients.find(({ id }) => String(id) === String(appointment?.patient_id));
    expect(patient).toBeDefined();

    const targetCard = page
      .getByText(patient!.full_name, { exact: true })
      .locator('xpath=ancestor::*[.//button[normalize-space()="Iniciar"]][1]')
      .filter({ hasText: appointment!.start_time.substring(0, 5) });
    await expect(targetCard).toHaveCount(1);

    const startRpcPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/rpc/update_appointment_status_secure')
        && response.request().method() === 'POST';
    });
    await targetCard.getByRole('button', { name: /^iniciar$/i }).click();
    const startRpc = await startRpcPromise;
    expect(startRpc.ok()).toBeTruthy();
    expect(startRpc.request().postDataJSON()).toMatchObject({
      p_appointment_id: Number(APPOINTMENT_ID),
      p_new_status: 'in_progress',
    });
    await expect(page).toHaveURL(/\/reception$/);

    await loginAs('doctor');
    await page.goto(`/attendance/${APPOINTMENT_ID}`);
    await expect(page.getByRole('heading', { name: /^atendimento$/i })).toBeVisible();
    await expect(page.getByText(patient!.full_name, { exact: true })).toBeVisible();

    await page.getByPlaceholder('Motivo da consulta...').fill(marker);
    await page.getByPlaceholder('Descrição detalhada...').fill('Fluxo clínico E2E efêmero.');

    const finalizeRpcPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/rpc/finalize_medical_attendance_secure')
        && response.request().method() === 'POST';
    });
    await page.getByRole('button', { name: /^finalizar atendimento$/i }).click();
    const finalizeRpc = await finalizeRpcPromise;
    expect(finalizeRpc.ok()).toBeTruthy();
    expect(finalizeRpc.request().postDataJSON()).toMatchObject({
      p_appointment_id: APPOINTMENT_ID,
    });
    expect(finalizeRpc.request().postDataJSON().p_anamnesis).toContain(marker);
    await expect(page).toHaveURL(/\/records$/);

    const patientSearchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/patients')
        && url.searchParams.has('full_name')
        && response.request().method() === 'GET';
    });
    await page.getByPlaceholder('Buscar por nome...').fill(patient!.full_name);
    const patientSearchResponse = await patientSearchResponsePromise;
    expect(patientSearchResponse.ok()).toBeTruthy();

    const recordResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/medical_records')
        && url.searchParams.get('patient_id') === `eq.${appointment!.patient_id}`
        && response.request().method() === 'GET';
    });
    await page.getByText(patient!.full_name, { exact: true }).click();
    const recordResponse = await recordResponsePromise;
    expect(recordResponse.ok()).toBeTruthy();

    const records = await recordResponse.json() as Array<{ appointment_id: string | number; anamnesis: string | null }>;
    expect(records.some((record) => (
      String(record.appointment_id) === APPOINTMENT_ID && record.anamnesis?.includes(marker)
    ))).toBeTruthy();
    await expect(page.getByRole('heading', { name: `Prontuário — ${patient!.full_name}` })).toBeVisible();
    await expect(page.getByText(marker, { exact: false })).toBeVisible();
  });
});


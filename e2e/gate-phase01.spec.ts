import AxeBuilder from '@axe-core/playwright';
import { E2E_PASSWORD } from './env';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = E2E_PASSWORD;
const UNIT_A = /Empresa E2E · Unidade E2E A admin/;
const UNIT_B = /Empresa E2E · Unidade E2E B admin/;
const RECORD_MARKER = 'Queixa E2E persistida fase 0/1';

async function assertAccessible(page: Page, label: string) {
  const closeNotification = page.getByRole('button', { name: 'Fechar notificação' });
  if (await closeNotification.isVisible().catch(() => false)) {
    await closeNotification.click();
    await expect(closeNotification).toBeHidden();
  }
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await expect(page.locator('[data-radix-focus-guard]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${label}: violações Axe`).toEqual([]);
}

async function selectContext(page: Page, option: RegExp) {
  await page.getByRole('button', { name: 'Selecionar empresa, unidade e perfil' }).click();
  await page.getByRole('menuitem', { name: option }).click();
  await expect(page.getByText('Selecione seu contexto de acesso')).toBeHidden();
}

async function authenticatedFetch(page: Page, path: string, init: RequestInit) {
  return page.evaluate(async ({ path, init }) => {
    const storageKey = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (!storageKey) throw new Error('Sessão Supabase não encontrada');
    const session = JSON.parse(localStorage.getItem(storageKey) || 'null');
    const response = await fetch(`http://127.0.0.1:18000${path}`, {
      ...init,
      headers: {
        apikey: 'local-e2e-public-key',
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(init.headers || {}),
      },
    });
    return { status: response.status, body: await response.text() };
  }, { path, init });
}

test.describe('Gate fase 0/1', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Gate stateful canônico: a fixture compartilhada é consumida uma única vez',
  );

  test('contexto, RLS A/B, recepção, atendimento, prontuário e Axe', async ({ page }) => {
    await page.goto('/login');
    await assertAccessible(page, 'login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill(PASSWORD);
    await page.getByRole('button', { name: /^entrar$/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    await selectContext(page, UNIT_A);
    const beforeReload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('prontomedic-application-session') || 'null'));
    expect(beforeReload?.session_id).toBeTruthy();
    await page.reload();
    await expect(page.getByText('Selecione seu contexto de acesso')).toBeHidden();
    const afterReload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('prontomedic-application-session') || 'null'));
    expect(afterReload?.session_id).toBe(beforeReload.session_id);

    await page.goto('/patients');
    await expect(page.getByText('Paciente E2E A')).toBeVisible();
    await expect(page.getByText('Paciente E2E B')).toBeHidden();

    const unitARead = await authenticatedFetch(page, '/rest/v1/patients?select=id&order=id.asc', { method: 'GET' });
    expect(unitARead.status, unitARead.body).toBe(200);
    const unitAIds = (JSON.parse(unitARead.body) as Array<{ id: string }>).map(({ id }) => id);
    expect(unitAIds).toContain('91001');
    expect(unitAIds).not.toContain('91002');

    const blockedWrite = await authenticatedFetch(page, '/rest/v1/patients', {
      method: 'POST',
      body: JSON.stringify({
        company_id: 'eeeeeeee-1000-4000-8000-000000000001',
        unit_id: 91002,
        full_name: 'Tentativa cruzada E2E',
        birth_date: '1992-01-01',
        status: 'active',
        lg_ativo: true,
      }),
    });
    expect(blockedWrite.status, blockedWrite.body).toBeGreaterThanOrEqual(400);
    await assertAccessible(page, 'pacientes unidade A');

    await page.goto('/reception');
    await expect(page.getByText('Paciente E2E A')).toBeVisible();
    await expect(page.getByText('Paciente E2E B')).toBeHidden();
    const patientA = page.getByText('Paciente E2E A').locator('xpath=ancestor::*[contains(@class,"rounded-lg") or contains(@class,"border")][1]');
    await patientA.getByRole('button', { name: 'Check-in' }).click();
    await expect(page.getByRole('dialog', { name: 'Check-in administrativo' })).toBeVisible();
    await expect(page.getByText('Paciente liberado para check-in')).toBeVisible();
    await page.getByRole('button', { name: 'Concluir check-in' }).click();
    await expect(page.getByText(/^Check-in concluído · Senha C\d{3}$/).first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Check-in administrativo' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Recepção', level: 1 })).toBeVisible();
    await assertAccessible(page, 'recepção após check-in');

    const waitingA = page.getByText('Paciente E2E A').locator('xpath=ancestor::*[contains(@class,"rounded-lg") or contains(@class,"border")][1]');
    await waitingA.getByRole('button', { name: 'Iniciar' }).click();
    await expect(page).toHaveURL(/\/attendance\/91001/);
    await expect(page.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
    await assertAccessible(page, 'atendimento');
    await page.getByPlaceholder('Motivo da consulta...').fill(RECORD_MARKER);
    await page.getByRole('button', { name: 'Finalizar Atendimento' }).click();
    await expect(page).toHaveURL(/\/reception/);
    await expect(page.getByText('Atendimento salvo e finalizado!', { exact: true }).first()).toBeVisible();

    await page.goto('/records');
    await page.getByPlaceholder('Buscar por nome...').fill('Paciente E2E A');
    await page.getByText('Paciente E2E A').click();
    await expect(page.getByText(RECORD_MARKER)).toBeVisible();
    await assertAccessible(page, 'prontuário persistido');

    await selectContext(page, UNIT_B);
    await page.goto('/patients');
    await expect(page.getByText('Paciente E2E B')).toBeVisible();
    await expect(page.getByText('Paciente E2E A')).toBeHidden();
    const unitBRead = await authenticatedFetch(page, '/rest/v1/patients?select=id&order=id.asc', { method: 'GET' });
    expect(unitBRead.status, unitBRead.body).toBe(200);
    const unitBIds = (JSON.parse(unitBRead.body) as Array<{ id: string }>).map(({ id }) => id);
    expect(unitBIds).toContain('91002');
    expect(unitBIds).not.toContain('91001');
    await assertAccessible(page, 'pacientes unidade B');

    await page.goto('/records');
    await page.getByPlaceholder('Buscar por nome...').fill('Paciente E2E A');
    await expect(page.getByText('Nenhum paciente encontrado')).toBeVisible();
  });
});

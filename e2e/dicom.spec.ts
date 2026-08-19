import { expect } from '@playwright/test';
import { test } from './fixtures/auth';

const orthancReady = process.env.E2E_ORTHANC_READY === 'true';
const orthancExamId = process.env.E2E_ORTHANC_EXAM_ID;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const orthancSkipReason =
  'Requer Orthanc externo homologado. Execute com E2E_ORTHANC_READY=true.';

test.describe('DICOM / PACS - superfícies canônicas locais', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  test('administração DICOM expõe cadastro e controles existentes', async ({ page }) => {
    await page.goto('/admin/dicom');

    await expect(
      page.getByRole('heading', { name: 'Equipamentos DICOM', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo Equipamento' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Equipamentos/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Worklist/ })).toBeVisible();

    await page.getByRole('button', { name: 'Novo Equipamento' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cadastrar Equipamento DICOM' }),
    ).toBeVisible();
    await expect(page.getByLabel('Nome do Equipamento *')).toBeVisible();
    await expect(page.getByLabel('AE Title *')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('nós DICOM expõem listagem e formulário canônicos', async ({ page }) => {
    await page.goto('/dicom/nodes');

    await expect(
      page.getByRole('heading', { name: 'Nós DICOM / PACS', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo Nó' })).toBeVisible();

    await page.getByRole('button', { name: 'Novo Nó' }).click();
    await expect(page.getByRole('heading', { name: 'Novo Nó DICOM' })).toBeVisible();
    await expect(page.getByText('AE Title *', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('modalidades DICOM expõem busca e formulário canônicos', async ({ page }) => {
    await page.goto('/dicom/modalities');

    await expect(
      page.getByRole('heading', { name: 'Equipamentos DICOM', exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Buscar equipamento...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo Equipamento' })).toBeVisible();

    await page.getByRole('button', { name: 'Novo Equipamento' }).click();
    await expect(page.getByRole('heading', { name: 'Novo Equipamento' })).toBeVisible();
    await expect(page.getByText('Modalidade', { exact: true })).toBeVisible();
    await expect(page.getByText('Worklist habilitada', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('worklist DICOM expõe filtros e atualização canônicos', async ({ page }) => {
    await page.goto('/worklist');

    await expect(page).toHaveURL(/\/dicom\/worklist$/);
    await expect(
      page.getByRole('heading', { name: 'DICOM Worklist Queue', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Nenhum item na worklist|Paciente|Agendamento/).first()).toBeVisible();
    await expect(page.getByText('Erro ao carregar worklist')).toHaveCount(0);
  });

  test('laudos DICOM expõem fila e filtros canônicos', async ({ page }) => {
    await page.goto('/dicom/reports');

    await expect(page.getByRole('heading', { name: 'Laudos', exact: true })).toBeVisible();
    await expect(
      page.getByPlaceholder('Buscar paciente, exame ou código...'),
    ).toBeVisible();
    await expect(page.getByText(/Nenhum laudo encontrado|Paciente/).first()).toBeVisible();
  });
});

test.describe('DICOM / PACS - integração Orthanc externa', () => {
  test.beforeEach(async ({ loginAs }) => {
    test.skip(!orthancReady, orthancSkipReason);
    await loginAs('admin');
  });

  test('C-ECHO usa o controle canônico da administração DICOM', async ({ page }) => {
    await page.goto('/admin/dicom');

    const echoButton = page.getByTitle('Testar conexão (DICOM Echo)').first();
    await expect(echoButton).toBeVisible();
    await echoButton.click();
    await expect(page.getByText(/Echo OK|conectado|online|sucesso/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('C-STORE permanece condicionado ao provider Orthanc homologado', async ({ page }) => {
    test.skip(
      !orthancExamId,
      'Requer E2E_ORTHANC_EXAM_ID com exame sintético autorizado para C-STORE.',
    );
    test.skip(
      !supabaseUrl || !supabaseAnonKey,
      'Requer VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para chamar a bridge DICOM.',
    );

    await page.goto('/dicom/reports');
    const result = await page.evaluate(async ({ examId, apiUrl, anonKey }) => {
      const session = Object.values(localStorage)
        .map((value) => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })
        .find((value) => value?.access_token);

      if (!session?.access_token) {
        throw new Error('Sessão autenticada não encontrada para testar a bridge DICOM');
      }

      const response = await fetch(
        `${apiUrl}/functions/v1/dicom-bridge`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'store-study', examId: Number(examId) }),
        },
      );

      return { status: response.status, body: await response.json() };
    }, { examId: orthancExamId, apiUrl: supabaseUrl, anonKey: supabaseAnonKey });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
  });

  test('provider Orthanc está disponível para as superfícies DICOM', async ({ page }) => {
    await page.goto('/admin/dicom');
    await expect(page.getByTitle('Testar conexão (DICOM Echo)').first()).toBeVisible();
  });
});

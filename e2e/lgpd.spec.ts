import { test as authed, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';

const LGPD_PATH = '/admin/lgpd';

async function openLgpd(page: Page) {
  await page.goto(LGPD_PATH);
  await expect(page).toHaveURL(new RegExp(`${LGPD_PATH}$`));
  await expect(page.getByRole('heading', { name: 'Modulo LGPD' })).toBeVisible();
}

authed.describe('LGPD - contratos canonicos de /admin/lgpd', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('renderiza o modulo e as cinco areas de governanca', async ({ page }) => {
    await openLgpd(page);

    await expect(page.getByRole('tab', { name: 'Consentimentos' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Solicitacoes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Politica Retencao' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Anonimizacao' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Auditoria' })).toBeVisible();
  });

  authed('consulta consentimentos sem alterar opt-in ou opt-out', async ({ page }) => {
    await openLgpd(page);

    await expect(
      page.getByRole('heading', { name: 'Consentimentos Granulares' }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder('Buscar paciente por nome, CPF ou telefone...'),
    ).toBeVisible();
    await expect(
      page.getByText('Selecione um paciente para gerenciar consentimentos'),
    ).toBeVisible();
  });

  authed('consulta solicitacoes do titular e os filtros canonicos', async ({ page }) => {
    await openLgpd(page);
    await page.getByRole('tab', { name: 'Solicitacoes' }).click();

    await expect(
      page.getByRole('heading', { name: 'Solicitacoes do Titular' }),
    ).toBeVisible();

    const statusFilter = page.getByRole('combobox');
    await expect(statusFilter).toBeVisible();
    await statusFilter.click();

    for (const status of [
      'Todos',
      'Pendente',
      'Em Andamento',
      'Concluida',
      'Rejeitada',
    ]) {
      await expect(page.getByRole('option', { name: status })).toBeVisible();
    }

    await page.getByRole('option', { name: 'Todos' }).click();
    await expect(page.getByText('Carregando...')).toBeHidden();

    const tableOrEmptyState = page
      .getByRole('table')
      .or(page.getByText(/Nenhuma solicitacao/i));
    await expect(tableOrEmptyState).toBeVisible();
  });

  authed('exibe politica de retencao sem persistir alteracoes', async ({ page }) => {
    await openLgpd(page);
    await page.getByRole('tab', { name: 'Politica Retencao' }).click();

    await expect(
      page.getByRole('heading', { name: 'Politica de Retencao' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aplicar Padrao' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova Politica' })).toBeVisible();
    await expect(page.getByText('Ver politica padrao recomendada')).toBeVisible();
  });

  authed('exibe salvaguardas da anonimizacao sem executar a operacao', async ({
    page,
  }) => {
    await openLgpd(page);
    await page.getByRole('tab', { name: 'Anonimizacao' }).click();

    await expect(
      page.getByRole('heading', { name: 'Anonimizacao em Massa' }),
    ).toBeVisible();
    await expect(page.getByText('Atencao — operacao irreversivel')).toBeVisible();
    await expect(page.getByLabel('Limite de execucao')).toHaveValue('50');
    await expect(
      page.getByRole('button', { name: /Executar Anonimizacao/ }),
    ).toBeVisible();
  });

  authed('consulta a trilha de auditoria sem modificar registros', async ({ page }) => {
    await openLgpd(page);
    await page.getByRole('tab', { name: 'Auditoria' }).click();

    await expect(
      page.getByRole('heading', { name: 'Auditoria de Acesso' }),
    ).toBeVisible();
    await expect(page.getByText('Carregando...')).toBeHidden();

    const tableOrEmptyState = page
      .getByRole('table')
      .or(page.getByText('Nenhum log de auditoria registrado'));
    await expect(tableOrEmptyState).toBeVisible();
  });

  authed.skip(
    'executa anonimizacao somente sobre fixture local descartavel autorizada',
    async () => {
      // Bloqueado de forma intencional: a UI canonica atual oferece apenas
      // anonimizacao em massa e nao permite selecionar uma fixture E2E isolada.
      // Uma flag de autorizacao, sozinha, nao torna esse controle seguro.
    },
  );

  authed.skip('valida a remocao de PII da fixture anonimizada', async () => {
    // Depende da execucao segura do cenario anterior. Nao consultar pacientes
    // com anon key nem inferir anonimização a partir de dados compartilhados.
  });
});

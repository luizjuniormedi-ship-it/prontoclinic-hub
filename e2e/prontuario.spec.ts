import { test as base, expect } from '@playwright/test';
import { test as authed } from './fixtures/auth';

/**
 * E2E — Prontuário Eletrônico
 *
 * Cobre:
 *   - Abrir prontuário
 *   - Preencher anamnese
 *   - Adicionar CID-10
 *   - Prescrever medicamento
 *   - Solicitar exame
 *   - Emitir atestado
 *   - Finalizar atendimento
 *   - Ver histórico de evoluções
 */

authed.describe('Prontuário @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('doctor');
  });

  authed('abrir prontuário do paciente', async ({ page }) => {
    await page.goto('/records');
    await page.getByRole('row').first().getByRole('link', { name: /abrir|prontuário/i }).click();
    await expect(page.getByRole('heading', { name: /prontuário|atendimento/i })).toBeVisible();
  });

  authed('preencher anamnese', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByLabel(/queixa principal/i).fill('Dor de cabeça há 3 dias');
    await page.getByLabel(/história/i).fill('Paciente relata cefaleia frontal, sem febre');
    await page.getByLabel(/exame físico/i).fill('PA 120/80, sem sinais neurológicos focais');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/anamnese.*salva|sucesso/i)).toBeVisible();
  });

  authed('adicionar diagnóstico CID-10', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByLabel(/cid/i).fill('R51');
    await page.getByRole('option').first().click();
    await page.getByLabel(/observação/i).fill('Cefaleia tensional');
    await page.getByRole('button', { name: /adicionar/i }).click();
    await expect(page.getByText(/R51|Cefaleia/i).first()).toBeVisible();
  });

  authed('prescrever medicamento', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByRole('tab', { name: /prescrição/i }).click();
    await page.getByLabel(/medicamento/i).fill('Dipirona 500mg');
    await page.getByLabel(/posologia/i).fill('Tomar 1 comprimido a cada 6 horas');
    await page.getByRole('button', { name: /adicionar|prescrever/i }).click();
    await expect(page.getByText(/Dipirona|prescrit/i).first()).toBeVisible();
  });

  authed('solicitar exame (hemograma)', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByRole('tab', { name: /exames/i }).click();
    await page.getByLabel(/exame/i).click();
    await page.getByRole('option', { name: /hemograma/i }).click();
    await page.getByLabel(/observação/i).fill('Coletar em jejum');
    await page.getByRole('button', { name: /solicitar/i }).click();
    await expect(page.getByText(/exame.*solicitado|hemograma/i).first()).toBeVisible();
  });

  authed('emitir atestado médico', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByRole('tab', { name: /atestado/i }).click();
    await page.getByLabel(/dias/i).fill('3');
    await page.getByLabel(/cid/i).fill('R51');
    await page.getByRole('button', { name: /emitir/i }).click();
    await expect(page.getByText(/atestado.*emitido/i)).toBeVisible();
  });

  authed('finalizar atendimento', async ({ page }) => {
    await page.goto('/records/new');
    await page.getByLabel(/queixa principal/i).fill('Consulta de rotina');
    await page.getByRole('button', { name: /finalizar/i }).click();
    await expect(page.getByText(/atendimento.*finalizado|concluído/i)).toBeVisible();
  });

  authed('ver histórico de evoluções anteriores', async ({ page }) => {
    await page.goto('/records');
    await page.getByRole('row').first().getByRole('link').click();
    await page.getByRole('tab', { name: /histórico|evoluç/i }).click();
    await expect(page.getByText(/evolução|consulta anterior/i).first()).toBeVisible();
  });
});

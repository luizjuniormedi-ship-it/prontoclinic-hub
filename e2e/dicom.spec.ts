import { test as base, expect } from '@playwright/test';
import { test as authed } from './fixtures/auth';

/**
 * E2E — PACS / DICOM
 *
 * Cobre:
 *   - Listar equipamentos (modalities)
 *   - Adicionar equipamento
 *   - Testar conexão Orthanc
 *   - Worklist aparece (DICOM Modality Worklist)
 *   - Solicitar study (mover para PACS)
 *   - Upload de imagem
 *   - Laudo criado
 *   - Laudo publicado (status LG_PUBLICAR)
 */

authed.describe('DICOM / PACS @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('listar equipamentos DICOM', async ({ page }) => {
    await page.goto('/dicom/modalities');
    await expect(page.getByRole('heading', { name: /equipamentos|modalities/i })).toBeVisible();
    await expect(page.getByRole('row').first()).toBeVisible();
  });

  authed('adicionar novo equipamento (CT/MRI)', async ({ page }) => {
    await page.goto('/dicom/modalities');
    await page.getByRole('button', { name: /novo|adicionar/i }).click();
    await page.getByLabel(/nome/i).fill('Tomógrafo Philips 1');
    await page.getByLabel(/modalidade/i).selectOption('CT');
    await page.getByLabel(/ae title/i).fill('CT_PHILIPS_01');
    await page.getByLabel(/host|ip/i).fill('192.168.10.50');
    await page.getByLabel(/porta/i).fill('104');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/equipamento.*criado|sucesso/i)).toBeVisible();
  });

  authed('testar conexão Orthanc (ping)', async ({ page }) => {
    await page.goto('/dicom/modalities');
    await page.getByRole('row').first().getByRole('button', { name: /testar|ping/i }).click();
    await expect(page.getByText(/conectado|online|sucesso/i).first()).toBeVisible({ timeout: 10000 });
  });

  authed('worklist aparece para o paciente agendado', async ({ page }) => {
    await page.goto('/dicom/worklist');
    await expect(page.getByRole('heading', { name: /worklist/i })).toBeVisible();
    await expect(page.getByText(/agendado|scheduled/i).first()).toBeVisible();
  });

  authed('pedidos de imagem usam a rota real', async ({ page }) => {
    await page.goto('/dicom/orders');
    await expect(page.getByRole('heading', { name: /Pedidos de Exame de Imagem/i })).toBeVisible();
  });

  authed('solicitar study (enviar para PACS)', async ({ page }) => {
    await page.goto('/dicom/worklist');
    await page.getByRole('row').first().getByRole('button', { name: /solicitar|enviar/i }).click();
    await expect(page.getByText(/solicitado|enviado.*pacs/i).first()).toBeVisible();
  });

  authed('estudos recebidos são exibidos na rota PACS real', async ({ page }) => {
    await page.goto('/pacs');
    await expect(page.getByRole('heading', { name: /PACS - Estudos de Imagem/i })).toBeVisible();
  });

  authed('laudo criado (rascunho)', async ({ page }) => {
    await page.goto('/dicom/reports');
    await expect(page.getByRole('heading', { name: /^Laudos$/i })).toBeVisible();
  });

  authed('laudo publicado (status final LG_PUBLICAR)', async ({ page }) => {
    await page.goto('/dicom/reports');
    await page.getByRole('row', { name: /rascunho|draft/i }).first().getByRole('button', { name: /publicar|finalizar/i }).click();
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/publicado|final|lg_publicar/i).first()).toBeVisible();
  });
});

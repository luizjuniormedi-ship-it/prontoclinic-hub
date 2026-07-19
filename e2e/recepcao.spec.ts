import { test as base, expect } from '@playwright/test';
import { test as authed } from './fixtures/auth';

/**
 * E2E — Recepção (check-in, fila administrativa, pagamento, etiqueta).
 *
 * Cobre o fluxo de atendimento do balcão:
 *   - Check-in de paciente agendado
 *   - Fila administrativa (painel de chamada)
 *   - Pagamento imediato no balcão
 *   - Emissão de etiqueta de identificação
 *   - Confirmação de presença
 *   - Lista de espera
 *   - Impressão de recibo
 *   - Alerta de pendência
 *   - Encaminhamento para triagem
 *   - Cancelamento pelo balcão
 */

authed.describe('Recepção — Check-in @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('reception');
  });

  authed('check-in de paciente agendado', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row', { name: /agendado/i }).first().getByRole('button', { name: /check-?in/i }).click();
    await expect(page.getByText(/check-?in.*realizado|em espera/i)).toBeVisible();
  });

  authed('fila administrativa (painel de chamada)', async ({ page }) => {
    await page.goto('/reception/queue');
    await expect(page.getByRole('heading', { name: /fila|painel/i })).toBeVisible();
    await expect(page.getByText(/aguardando|em atendimento/i).first()).toBeVisible();
  });

  authed('pagamento imediato no balcão', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row').first().getByRole('button', { name: /pagamento|pagar/i }).click();
    await page.getByLabel(/valor|total/i).fill('150.00');
    await page.getByLabel(/forma/i).selectOption('dinheiro');
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/pagamento.*registrado|recibo/i)).toBeVisible();
  });

  authed('emissão de etiqueta de identificação', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row').first().getByRole('button', { name: /etiqueta/i }).click();
    await expect(page.getByText(/etiqueta.*gerada|imprimir/i)).toBeVisible();
  });

  authed('confirmação de presença (chamada no painel)', async ({ page }) => {
    await page.goto('/reception/queue');
    await page.getByRole('button', { name: /chamar/i }).first().click();
    await expect(page.getByText(/paciente chamado|em atendimento/i).first()).toBeVisible();
  });

  authed('lista de espera (sem horário)', async ({ page }) => {
    await page.goto('/reception/waitlist');
    await page.getByRole('button', { name: /adicionar|novo/i }).click();
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/motivo|observação/i).fill('Chegou sem agendamento');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/adicionado.*espera/i)).toBeVisible();
  });

  authed('impressão de recibo após pagamento', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row').first().getByRole('button', { name: /recibo/i }).click();
    await expect(page.getByText(/recibo|imprimir/i)).toBeVisible();
  });

  authed('alerta de pendência (ficha incompleta)', async ({ page }) => {
    await page.goto('/reception');
    await expect(page.getByText(/pendência|alerta/i).first()).toBeVisible();
  });

  authed('encaminhamento para triagem', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row').first().getByRole('button', { name: /triagem/i }).click();
    await expect(page.getByText(/encaminhado.*triagem/i)).toBeVisible();
  });

  authed('cancelamento pelo balcão com motivo', async ({ page }) => {
    await page.goto('/reception');
    await page.getByRole('row').first().getByRole('button', { name: /cancelar/i }).click();
    await page.getByLabel(/motivo/i).fill('Paciente desistiu no balcão');
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/cancelado/i)).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { test as authed } from './fixtures/auth';

authed.describe('Agendamento @mutating', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('criar agendamento (admin)', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /novo agendamento|criar/i }).click();

    // Selecionar paciente (assume ao menos 1 paciente seedado)
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();

    // Selecionar profissional
    await page.getByLabel(/profissional/i).click();
    await page.getByRole('option').first().click();

    // Salvar
    await page.getByRole('button', { name: /salvar|confirmar/i }).click();
    await expect(page.getByText(/agendamento.*criado|sucesso/i)).toBeVisible();
  });

  authed('verificar conflito no mesmo slot', async ({ page }) => {
    // Assume slot já ocupado por seed. Tenta criar novo no mesmo slot.
    await page.goto('/schedule');
    await page.getByRole('button', { name: /novo agendamento|criar/i }).click();
    // Selecionar mesmo horário já ocupado
    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/profissional/i).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: /salvar|confirmar/i }).click();

    await expect(page.getByText(/conflito|já existe|horário ocupado/i)).toBeVisible();
  });

  authed('confirmar agendamento', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('row', { name: /agendado/i }).first().getByRole('button').click();
    await page.getByRole('menuitem', { name: /confirmar/i }).click();
    await expect(page.getByText(/confirmado/i)).toBeVisible();
  });

  authed('cancelar agendamento com motivo', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('row').first().getByRole('button').click();
    await page.getByRole('menuitem', { name: /cancelar/i }).click();
    await page.getByLabel(/motivo/i).fill('Paciente solicitou remarcação');
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/cancelado/i)).toBeVisible();
  });

  authed('reagendar (cancela antigo + cria novo)', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('row').first().getByRole('button').click();
    await page.getByRole('menuitem', { name: /reagendar/i }).click();
    // Novo horário
    await page.getByLabel(/data|horário/i).first().fill('2026-12-31 09:00');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/reagendado/i)).toBeVisible();
  });

  authed('filtrar agenda por data', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByLabel(/data/i).fill('2026-07-01');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/agendamentos de 01\/07\/2026|01\/07\/2026/i)).toBeVisible();
  });

  authed('filtrar por profissional', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByLabel(/profissional/i).click();
    await page.getByRole('option').first().click();
    // Após filtro, linhas devem mostrar apenas daquele profissional
    await expect(page.getByRole('row').first()).toBeVisible();
  });

  authed('listar próximos 7 dias', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /próximos 7|7 dias/i }).click();
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    await expect(page.getByText(nextWeek.toLocaleDateString('pt-BR'))).toBeVisible();
  });

  authed('criar encaixe com justificativa', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /encaixe/i }).click();
    await page.getByLabel(/justificativa|motivo/i).fill('Paciente urgente — dor torácica');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/encaixe criado/i)).toBeVisible();
  });

  authed('bloqueio de slot', async ({ page }) => {
    await page.goto('/schedule');
    await page.getByRole('button', { name: /bloquear slot/i }).click();
    await page.getByLabel(/motivo/i).fill('Manutenção de equipamento');
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/slot bloqueado/i)).toBeVisible();
  });
});

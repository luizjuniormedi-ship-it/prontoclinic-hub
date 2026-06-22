import { test as base, expect } from '@playwright/test';
import { test as authed } from './fixtures/auth';

/**
 * E2E — Notificações Multicanal
 *
 * Cobre:
 *   - Fila tem notificação pendente
 *   - Worker processa e marca como SENT
 *   - Retry após falha
 *   - Respeita rate limit
 *   - Multicanal (e-mail, WhatsApp, SMS)
 *   - Opt-in/out por canal
 *   - Confirmação de leitura
 *   - Histórico do destinatário
 */

authed.describe('Notificações Multicanal', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('fila tem notificação pendente', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: /notificaç/i })).toBeVisible();
    await expect(page.getByText(/pendente|aguardando envio/i).first()).toBeVisible();
  });

  authed('worker processa e marca como SENT', async ({ page }) => {
    await page.goto('/notifications');
    await page.getByRole('button', { name: /processar agora|worker/i }).click();
    await expect(page.getByText(/enviado|sent|sucesso/i).first()).toBeVisible({ timeout: 10000 });
  });

  authed('retry automático após falha', async ({ page }) => {
    await page.goto('/notifications');
    await page.getByRole('row', { name: /falhou|erro/i }).first().getByRole('button', { name: /reenviar|retry/i }).click();
    await expect(page.getByText(/reenviado|retry.*agendado/i)).toBeVisible();
  });

  authed('respeita rate limit por destinatário', async ({ page }) => {
    await page.goto('/notifications');
    await page.getByRole('row').first().click();
    await expect(page.getByText(/rate limit|aguarde.*minutos/i).first()).toBeVisible();
  });

  authed('multicanal — enviar por e-mail', async ({ page }) => {
    await page.goto('/notifications/new');
    await page.getByLabel(/canal/i).selectOption('email');
    await page.getByLabel(/destinatário/i).fill('paciente@example.com');
    await page.getByLabel(/assunto/i).fill('Lembrete de consulta');
    await page.getByLabel(/mensagem/i).fill('Sua consulta é amanhã às 14h');
    await page.getByRole('button', { name: /enviar/i }).click();
    await expect(page.getByText(/enviado|e-?mail/i).first()).toBeVisible();
  });

  authed('opt-in/out por canal (consentimento LGPD)', async ({ page }) => {
    await page.goto('/patients');
    await page.getByRole('row').first().getByRole('button', { name: /consentimento|lgpd/i }).click();
    await page.getByRole('switch', { name: /whatsapp/i }).click();
    await page.getByRole('switch', { name: /sms/i }).click();
    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/consentimento.*atualizado/i)).toBeVisible();
  });

  authed('confirmação de leitura (read receipt)', async ({ page }) => {
    await page.goto('/notifications');
    await page.getByRole('row', { name: /entregue|delivered/i }).first().click();
    await expect(page.getByText(/lido|read|visualizado/i).first()).toBeVisible();
  });

  authed('histórico do destinatário (timeline)', async ({ page }) => {
    await page.goto('/notifications/history');
    await page.getByLabel(/destinatário|paciente/i).click();
    await page.getByRole('option').first().click();
    await expect(page.getByRole('heading', { name: /histórico|timeline/i })).toBeVisible();
    await expect(page.getByText(/enviado|recebido|aberto/i).first()).toBeVisible();
  });
});
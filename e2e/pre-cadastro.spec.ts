import { test, expect } from '@playwright/test';

test.describe('Pré-cadastro público (PWA)', () => {
  test('acessar /pre-cadastro sem login', async ({ page }) => {
    await page.goto('/pre-cadastro');
    await expect(page.getByRole('heading', { name: /pré-cadastro/i })).toBeVisible();
  });

  test('preencher formulário', async ({ page }) => {
    await page.goto('/pre-cadastro');
    await page.getByLabel(/nome/i).fill('Ana Souza E2E');
    await page.getByLabel(/cpf/i).fill('390.533.447-05');
    await page.getByLabel(/e-?mail/i).fill('ana.e2e@example.com');
    await page.getByLabel(/telefone/i).fill('11977776666');
    await page.getByLabel(/data de nascimento/i).fill('1995-05-10');
    await expect(page.getByLabel(/nome/i)).toHaveValue('Ana Souza E2E');
  });

  test('aceitar termo de uso', async ({ page }) => {
    await page.goto('/pre-cadastro');
    const termo = page.getByLabel(/aceito os termos|concordo/i);
    await termo.check();
    await expect(termo).toBeChecked();
  });

  test('submeter pré-cadastro', async ({ page }) => {
    await page.goto('/pre-cadastro');
    await page.getByLabel(/nome/i).fill('Ana Souza E2E');
    await page.getByLabel(/cpf/i).fill('390.533.447-05');
    await page.getByLabel(/e-?mail/i).fill('ana.e2e@example.com');
    await page.getByLabel(/telefone/i).fill('11977776666');
    await page.getByLabel(/data de nascimento/i).fill('1995-05-10');
    await page.getByLabel(/aceito os termos|concordo/i).check();
    await page.getByRole('button', { name: /enviar|cadastrar/i }).click();

    await expect(
      page.getByText(/e-mail de confirmação enviado|verifique seu e-?mail/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('verificar email enviado (mock)', async ({ page, request }) => {
    // Em staging, configurado MailHog em localhost:8025 — listar últimos e-mails
    const mailhog = await request.get('http://localhost:8025/api/v2/messages');
    if (mailhog.ok()) {
      const data = await mailhog.json();
      expect(data.total).toBeGreaterThan(0);
      const lastMsg = data.items[0];
      expect(lastMsg.Content.Headers.Subject[0]).toMatch(/confirme|pr[eé]-?cadastro/i);
    } else {
      test.skip(true, 'MailHog não disponível em staging — pulando verificação de inbox');
    }
  });

  test('clicar no link de confirmação e ver dados', async ({ page, request }) => {
    // Buscar último link de confirmação no MailHog
    const mailhog = await request.get('http://localhost:8025/api/v2/messages');
    test.skip(!mailhog.ok(), 'MailHog indisponível');

    const data = await mailhog.json();
    const lastMsg = data.items[0];
    const body = lastMsg.Content.Body || '';
    const linkMatch = body.match(/https?:\/\/[^\s"]+\/confirmar\?token=[^\s"]+/i);
    test.skip(!linkMatch, 'Link de confirmação não encontrado no e-mail');

    await page.goto(linkMatch![0]);
    await expect(page.getByText('Ana Souza E2E')).toBeVisible();
    await expect(page.getByText('390.533.447-05')).toBeVisible();
  });

  test('confirmar pré-cadastro', async ({ page, request }) => {
    const mailhog = await request.get('http://localhost:8025/api/v2/messages');
    test.skip(!mailhog.ok(), 'MailHog indisponível');

    const data = await mailhog.json();
    const linkMatch = data.items[0].Content.Body.match(/https?:\/\/[^\s"]+\/confirmar\?token=[^\s"]+/i);
    test.skip(!linkMatch, 'Link não encontrado');

    await page.goto(linkMatch![0]);
    await page.getByRole('button', { name: /confirmar pré-cadastro/i }).click();
    await expect(page.getByText(/pré-cadastro confirmado/i)).toBeVisible();
  });

  test('admin promove pré-cadastro para paciente', async ({ page }) => {
    // Login como admin e verificar lista de pré-cadastros pendentes
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

    await page.goto('/admin/pre-cadastros');
    await page.getByRole('row', { name: /pendente/i }).first().getByRole('button', { name: /promover/i }).click();
    await expect(page.getByText(/promovido para paciente/i)).toBeVisible();
  });
});

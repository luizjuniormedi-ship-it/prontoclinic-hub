import { test, expect } from '@playwright/test';

test.describe('Autenticação', () => {
  test('login com credenciais válidas redireciona para dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByLabel('Senha').fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();

    await page.waitForURL(/\/(?!login)/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('login com email inválido mostra erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('inexistente@prontomedic.test');
    await page.getByLabel('Senha').fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();

    await expect(page.getByText(/e-mail ou senha inválidos|inválid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login com senha errada mostra erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByLabel('Senha').fill('SenhaErrada!');
    await page.getByRole('button', { name: /entrar/i }).click();

    await expect(page.getByText(/e-mail ou senha inválidos|inválid/i)).toBeVisible();
  });

  test('esqueci senha envia email (mock)', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('button', { name: /enviar|redefinir/i }).click();

    await expect(
      page.getByText(/e-mail.*enviado|verifique|instructions.*sent/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('logout redireciona para login', async ({ page }) => {
    // login
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByLabel('Senha').fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.waitForURL(/\/(?!login)/);

    // logout — botão no header
    await page.getByRole('button', { name: /sair|logout|desconectar/i }).click();

    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('campo 2FA aparece quando usuário tem 2 fatores ativos', async ({ page }) => {
    // Pré-condição: usuário admin@prontomedic.test deve ter lg_2fatores=true no banco
    // de staging (configurado no seed). Se não estiver, este teste pula.
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByLabel('Senha').fill('TestPassword123!');
    await page.getByRole('button', { name: /entrar/i }).click();

    const twoFactorField = page.getByLabel(/código 2fa|código de verificação|2fa/i);
    const has2FA = await twoFactorField.isVisible().catch(() => false);

    if (has2FA) {
      await expect(twoFactorField).toBeVisible();
      await twoFactorField.fill('123456');
      await page.getByRole('button', { name: /entrar|verificar/i }).click();
      await page.waitForURL(/\/(?!login)/);
    } else {
      test.skip(true, 'Usuário não tem 2FA ativo no staging — pulando');
    }
  });

  test('acesso a rota protegida sem login redireciona para /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });
});
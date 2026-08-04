import { test, expect } from './fixtures/auth';
import { E2E_PASSWORD } from './env';

test.describe('Autenticação', () => {
  ([
    { label: 'admin', role: 'admin' },
    { label: 'recepção', role: 'reception' },
    { label: 'médico', role: 'doctor' },
    { label: 'paciente', role: 'patient' },
  ] as const).forEach(({ label, role }) => {
    test(`login local funciona para perfil ${label}`, async ({ page, loginAs }) => {
      await loginAs(role);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    });
  });

  test('login com credenciais válidas e TOTP real redireciona para a aplicação', async ({ page, loginAs }) => {
    await loginAs('admin');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('login com email inválido mostra erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('inexistente@prontomedic.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: /entrar/i }).click();

    await expect(page.getByText(/e-mail ou senha inválidos|inválid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login com senha errada mostra erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('textbox', { name: 'Senha' }).fill('SenhaErrada!');
    await page.getByRole('button', { name: /entrar/i }).click();

    await expect(page.getByText(/e-mail ou senha inválidos|inválid/i)).toBeVisible();
  });

  test('esqueci senha envia email (mock)', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('E-mail').fill('admin@prontomedic.test');
    await page.getByRole('button', { name: /enviar|redefinir/i }).click();

    await expect(
      page.getByText(/verifique seu e-mail|instructions.*sent/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('logout redireciona para login', async ({ page, loginAs }) => {
    await loginAs('admin');
    await page
      .getByRole('banner', { name: 'Cabeçalho da aplicação' })
      .getByRole('button', { name: /sair|logout|desconectar/i })
      .click();

    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('MFA AAL2 usa o fator TOTP real provisionado no ambiente descartável', async ({ page, loginAs }) => {
    await loginAs('admin');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.getByRole('textbox', {
      name: /código 2fa|código de 6 dígitos/i,
    })).toHaveCount(0);
  });

  test('acesso a rota protegida sem login redireciona para /login', async ({ page }) => {
    await page.goto('/patients');
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });
});

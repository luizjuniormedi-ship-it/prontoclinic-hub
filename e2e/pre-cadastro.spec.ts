import { test, expect } from '@playwright/test';

test.describe('Pré-cadastro público (PWA)', () => {
  test('conclui os quatro passos sem depender de sessão autenticada', async ({ page }) => {
    await page.goto('/pre-cadastro');
    await expect(page.getByRole('heading', { name: /pré-cadastro/i })).toBeVisible();

    await page.getByLabel('Nome completo *').fill('Ana Souza Teste');
    await page.getByLabel('CPF').fill('390.533.447-05');
    await page.getByLabel('Data de nascimento *').fill('1995-05-10');
    await page.getByRole('button', { name: 'Próximo' }).click();

    await page.getByLabel('E-mail *').fill(`ana.e2e.${Date.now()}@example.com`);
    await page.getByLabel('Telefone *').fill('11977776666');
    await page.getByRole('button', { name: 'Próximo' }).click();

    await page.getByLabel('CEP *').fill('01001-000');
    await page.getByLabel('Logradouro *').fill('Praça da Sé');
    await page.getByLabel('Número *').fill('100');
    await page.getByLabel('Bairro *').fill('Sé');
    await page.getByLabel('Cidade *').fill('São Paulo');
    await page.getByRole('button', { name: 'Próximo' }).click();

    const term = page.getByLabel(/Li e aceito o termo de consentimento/i);
    await term.check();
    await expect(term).toBeChecked();
    await expect(page.getByRole('button', { name: /Enviar pré-cadastro/i })).toBeEnabled();
  });

  test('bloqueia avanço quando os dados pessoais obrigatórios estão vazios', async ({ page }) => {
    await page.goto('/pre-cadastro');
    await page.getByRole('button', { name: 'Próximo' }).click();
    await expect(page.getByText(/nome deve ter no minimo 3 caracteres/i)).toBeVisible();
    await expect(page.getByLabel('Nome completo *')).toHaveAttribute('aria-invalid', 'true');
  });
});

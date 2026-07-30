import { test as authed, expect } from './fixtures/auth';

const suffix = Date.now().toString().slice(-8);
const patientName = `Paciente Cadastro E2E ${suffix}`;
const patientCpf = `7${suffix.padStart(8, '0')}00`.slice(0, 11);
const originalPhone = '11999998888';
const updatedPhone = '11988887777';

authed.describe.serial('Pacientes - jornada cadastral canônica', () => {
  authed.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  authed('cria paciente no contexto empresarial ativo', async ({ page }) => {
    await page.goto('/patients');
    await page.getByRole('button', { name: 'Novo Paciente' }).click();
    await page.getByLabel(/nome completo/i).fill(patientName);
    await page.getByLabel(/^cpf/i).fill(patientCpf);
    await page.getByLabel(/data de nascimento/i).fill('1990-01-15');
    await page.getByLabel(/telefone principal/i).fill(originalPhone);
    await page.getByRole('button', { name: /salvar paciente/i }).click();

    await expect(page).toHaveURL(/\/patients$/);
    await page.getByPlaceholder(/buscar por nome, cpf ou telefone/i).fill(patientName);
    await expect(page.getByText(patientName, { exact: true })).toBeVisible();
    await expect(page.getByText('Erro ao cadastrar')).toHaveCount(0);
  });

  authed('busca o paciente por CPF e por nome', async ({ page }) => {
    await page.goto('/patients');
    const search = page.getByPlaceholder(/buscar por nome, cpf ou telefone/i);

    await search.fill(patientCpf);
    await expect(page.getByText(patientName, { exact: true })).toBeVisible();

    await search.fill(patientName);
    await expect(page.getByText(patientName, { exact: true })).toBeVisible();
  });

  authed('abre os dados cadastrais e clínicos do paciente', async ({ page }) => {
    await page.goto('/patients');
    await page.getByPlaceholder(/buscar por nome, cpf ou telefone/i).fill(patientName);
    await page.getByText(patientName, { exact: true }).click();

    await expect(page.getByRole('heading', { name: patientName })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Dados Cadastrais' })).toBeVisible();
    await page.getByRole('tab', { name: 'Clínico' }).click();
    await expect(page.getByText('Nenhuma alergia registrada')).toBeVisible();
    await page.getByRole('tab', { name: /Prontuário/ }).click();
    await expect(page.getByText(/Nenhum registro|Anamnese|Evolução/).first()).toBeVisible();
  });

  authed('edita o telefone e preserva a alteração após recarga', async ({ page }) => {
    await page.goto('/patients');
    await page.getByPlaceholder(/buscar por nome, cpf ou telefone/i).fill(patientName);
    await page.getByText(patientName, { exact: true }).click();
    await page.getByRole('button', { name: 'Editar' }).click();

    const phone = page.getByLabel(/telefone principal/i);
    await phone.fill(updatedPhone);
    await page.getByRole('button', { name: /salvar paciente/i }).click();
    await expect(page).toHaveURL(new RegExp('/patients/[^/]+$'));
    await page.reload();
    await expect(page.getByText(/\(11\) 98888-7777/)).toBeVisible();
  });
});

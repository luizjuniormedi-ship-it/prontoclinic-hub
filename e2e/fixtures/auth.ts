import { test as base, expect, Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { E2E_PASSWORD } from '../env';

export type UserRole =
  | 'admin'
  | 'doctor'
  | 'reception'
  | 'receptionSupervisor'
  | 'patient'
  | 'callcenter'
  | 'adminA'
  | 'managerA'
  | 'doctorA'
  | 'nurseA'
  | 'pharmacyA'
  | 'diagnosticA'
  | 'receptionA'
  | 'doctorB'
  | 'nurseB';

const LOCAL_CREDENTIALS: Partial<Record<UserRole, { email: string; password: string }>> = {
  admin: { email: 'admin@prontomedic.test', password: E2E_PASSWORD },
  doctor: { email: 'doctor@prontomedic.test', password: E2E_PASSWORD },
  reception: { email: 'recepcao@prontomedic.test', password: E2E_PASSWORD },
  receptionSupervisor: {
    email: 'supervisor.recepcao@prontomedic.test',
    password: E2E_PASSWORD,
  },
  patient: { email: 'paciente@prontomedic.test', password: E2E_PASSWORD },
  callcenter: { email: 'callcenter@prontomedic.test', password: E2E_PASSWORD },
  pharmacyA: { email: 'farmacia@prontomedic.test', password: E2E_PASSWORD },
};

function decodeBase32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('[e2e/auth] segredo TOTP inválido');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return value.toString().padStart(6, '0');
}

const ENV_KEYS: Partial<Record<UserRole, { email: string; password: string }>> = {
  admin: { email: 'E2E_ADMIN_EMAIL', password: 'E2E_ADMIN_PASSWORD' },
  doctor: { email: 'E2E_DOCTOR_EMAIL', password: 'E2E_DOCTOR_PASSWORD' },
  reception: { email: 'E2E_RECEPTION_EMAIL', password: 'E2E_RECEPTION_PASSWORD' },
  patient: { email: 'E2E_PATIENT_EMAIL', password: 'E2E_PATIENT_PASSWORD' },
  adminA: { email: 'E2E_COMPANY_A_ADMIN_EMAIL', password: 'E2E_COMPANY_A_ADMIN_PASSWORD' },
  managerA: { email: 'E2E_COMPANY_A_MANAGER_EMAIL', password: 'E2E_COMPANY_A_MANAGER_PASSWORD' },
  doctorA: { email: 'E2E_COMPANY_A_DOCTOR_EMAIL', password: 'E2E_COMPANY_A_DOCTOR_PASSWORD' },
  nurseA: { email: 'E2E_COMPANY_A_NURSE_EMAIL', password: 'E2E_COMPANY_A_NURSE_PASSWORD' },
  pharmacyA: { email: 'E2E_COMPANY_A_PHARMACY_EMAIL', password: 'E2E_COMPANY_A_PHARMACY_PASSWORD' },
  diagnosticA: { email: 'E2E_COMPANY_A_DIAGNOSTIC_EMAIL', password: 'E2E_COMPANY_A_DIAGNOSTIC_PASSWORD' },
  receptionA: { email: 'E2E_COMPANY_A_RECEPTION_EMAIL', password: 'E2E_COMPANY_A_RECEPTION_PASSWORD' },
  doctorB: { email: 'E2E_COMPANY_B_DOCTOR_EMAIL', password: 'E2E_COMPANY_B_DOCTOR_PASSWORD' },
  nurseB: { email: 'E2E_COMPANY_B_NURSE_EMAIL', password: 'E2E_COMPANY_B_NURSE_PASSWORD' },
};

export function credentialsForOrNull(role: UserRole) {
  const keys = ENV_KEYS[role];
  const email = keys ? process.env[keys.email]?.trim() : undefined;
  const password = keys ? process.env[keys.password] : undefined;
  if (email && password) return { email, password };
  return LOCAL_CREDENTIALS[role] ?? null;
}

export function credentialsFor(role: UserRole) {
  const credentials = credentialsForOrNull(role);
  if (credentials) return credentials;
  const keys = ENV_KEYS[role];
  const requirement = keys ? `${keys.email} e ${keys.password}` : 'credenciais E2E';
  throw new Error(`[e2e/auth] usuário ${role} deve ser provisionado via ${requirement}`);
}

export async function clearBrowserAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }).catch(() => undefined);
}

export async function loginAsRole(page: Page, role: UserRole): Promise<void> {
  const creds = credentialsFor(role);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(creds.email);
  await page.getByRole('textbox', { name: 'Senha' }).fill(creds.password);
  await page.getByRole('button', { name: /entrar/i }).click();

  const mfaCodeInput = page.getByRole('textbox', {
    name: /código 2fa|código de 6 dígitos/i,
  });
  const reachedMfa = await mfaCodeInput
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (reachedMfa) {
    const displayedEnrollmentSecret = await page.locator('code').textContent()
      .catch(() => null);
    const secret = displayedEnrollmentSecret?.trim()
      || process.env.E2E_MFA_SECRET?.trim();
    if (!secret) {
      throw new Error('[e2e/auth] E2E_MFA_SECRET é obrigatório para validar MFA');
    }
    await mfaCodeInput.fill(totpCode(secret));
    const submitMfa = page.getByRole('button', {
      name: /verificar|ativar mfa/i,
    });
    await expect(submitMfa).toBeEnabled();
    await submitMfa.click();
  }

  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

  const contextRequired = page.getByRole('heading', {
    name: /selecione seu contexto de acesso/i,
  });
  const contextSelector = page.getByRole('button', {
    name: /selecionar empresa, unidade e perfil/i,
  });

  // Context bootstrap is asynchronous after authentication. Wait for either
  // the switcher or a stable application route before deciding that there is
  // no context to select.
  const contextSelectorIsVisible = await contextSelector
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (!contextSelectorIsVisible) {
    await expect(contextRequired).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/select-context(?:\/|$|\?)/, {
      timeout: 10_000,
    });
    return;
  }

  await expect(contextSelector).toBeEnabled({ timeout: 10_000 });
  if ((await contextSelector.textContent())?.includes('Selecionar contexto')) {
    await contextSelector.click();
    const unitOption = page.getByRole('menuitem').filter({ hasText: /Unidade E2E A/i }).first();
    const option = (await unitOption.count()) > 0
      ? unitOption
      : page.getByRole('menuitem').first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(contextSelector).not.toContainText('Selecionar contexto', {
      timeout: 10_000,
    });
    await expect(contextRequired).toHaveCount(0, { timeout: 10_000 });
  }
}

/* eslint-disable react-hooks/rules-of-hooks */
// This file is a Playwright fixture using `use()` from @playwright/test.
// The rule expects React components or custom hooks named `useX`,
// but Playwright fixtures use a different convention.

export const test = base.extend<{
  authenticatedPage: Page;
  loginAs: (role: UserRole) => Promise<void>;
}>({
  authenticatedPage: async ({ page }, use) => {
    await use(page);
  },
  loginAs: async ({ page }, useFn) => {
    await useFn(async (role) => {
      await loginAsRole(page, role);
    });
  }
});

export { expect };

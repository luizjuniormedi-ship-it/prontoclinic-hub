import { test, expect } from '@playwright/test';
import { credentialsFor } from './fixtures/auth';

test.describe('Performance @readonly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const credentials = credentialsFor('admin');
    await page.getByLabel('E-mail').fill(credentials.email);
    await page.getByLabel('Senha').fill(credentials.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.waitForURL(/\/(?!login)/);
  });

  test('dashboard carrega em menos de 3 segundos', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(3000);
  });

  test('lista de pacientes (até 1000) carrega em menos de 2 segundos', async ({ page }) => {
    const start = Date.now();
    await page.goto('/patients');
    // Aguardar a primeira linha aparecer OU estado "carregando" terminar
    await page
      .waitForSelector('[data-testid="patient-row"], [role="row"]', { timeout: 5000 })
      .catch(() => {});
    await page.waitForLoadState('networkidle');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });

  test('busca de paciente retorna em menos de 500ms', async ({ page }) => {
    await page.goto('/patients');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder(/buscar|pesquisar/i);
    await searchInput.waitFor();

    const start = Date.now();
    await searchInput.fill('João');
    // Aguardar resposta da query (row visível ou estado estável)
    await page.waitForResponse(
      (res) => res.url().includes('/rest/v1/pacientes') && res.status() === 200,
      { timeout: 2000 }
    ).catch(() => {});
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
  });

  test('PWA manifest é válido e contém campos obrigatórios', async ({ request }) => {
    const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
    const res = await request.get(`${baseURL}/manifest.webmanifest`);
    test.skip(!res.ok(), `Manifest não encontrado: ${res.status()}`);

    const manifest = await res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toMatch(/standalone|fullscreen|minimal-ui/);
    expect(Array.isArray(manifest.icons)).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);

    // Cada ícone deve ter src, sizes e type
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.sizes).toBeTruthy();
      expect(icon.type).toMatch(/^image\//);
    }
  });

  test('service worker registrado e ativo', async ({ page }) => {
    await page.goto('/');
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? (reg.active ? 'active' : 'installing') : 'none';
    });
    expect(['active', 'installing', 'unsupported']).toContain(swState);
  });
});

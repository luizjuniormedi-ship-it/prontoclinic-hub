import { test, expect } from './fixtures/auth';

test.describe('Rotas operacionais atuais @readonly', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('admin');
  });

  for (const route of [
    { path: '/callcenter', heading: /call center/i },
    { path: '/schedule', heading: /agenda|agendamento/i },
    { path: '/reception', heading: /recep[cç][aã]o/i },
    { path: '/billing-accounts', heading: /faturamento/i },
    { path: '/billing-production', heading: /faturamento/i },
  ]) {
    test(`${route.path} resolve sem cair em rota inexistente`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}$`));
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
    });
  }
});

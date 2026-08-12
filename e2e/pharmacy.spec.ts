import {
  clearBrowserAuth,
  credentialsForOrNull,
  expect,
  loginAsRole,
  test,
} from "./fixtures/auth";

test.describe("Farmácia — contrato de rota @readonly", () => {
  test.afterEach(async ({ page }) => {
    await clearBrowserAuth(page);
  });

  test("sessão anônima não abre a farmácia", async ({ page }) => {
    await clearBrowserAuth(page);
    await page.goto("/pharmacy");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test("perfil de farmácia abre a superfície de dispensação", async ({ page }) => {
    const pharmacyRpcFailures: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("calcular_valor_estoque falhou")) {
        pharmacyRpcFailures.push(message.text());
      }
    });

    test.skip(
      !credentialsForOrNull("pharmacyA"),
      "Conta pharmacyA não foi provisionada nas variáveis E2E.",
    );
    await loginAsRole(page, "pharmacyA");
    await page.goto("/pharmacy");
    await expect(page.getByRole("heading", { name: /farmácia/i })).toBeVisible();
    await expect(page.getByText(/dispensa/i).first()).toBeVisible();
    await page.getByRole("tab", { name: /alertas/i }).click();
    const stockValue = page
      .getByText("Valor Total em Estoque")
      .locator("..")
      .getByText(/^R\$/);
    await expect(stockValue).toBeVisible();
    expect(pharmacyRpcFailures).toEqual([]);
  });
});

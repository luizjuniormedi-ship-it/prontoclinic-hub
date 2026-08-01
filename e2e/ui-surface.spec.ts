import AxeBuilder from "@axe-core/playwright";
import type { Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures/auth";

const BROKEN_SCREEN_PATTERN =
  /failed to fetch dynamically imported module|página não encontrada|algo deu errado|erro inesperado/i;

function watchRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];

  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console.error: ${message.text()}`);
    }
  });

  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") {
      return;
    }
    failures.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  page.on("response", (response: Response) => {
    const resourceType = response.request().resourceType();
    const status = response.status();
    const isCriticalAsset = ["document", "script", "stylesheet"].includes(
      resourceType,
    );
    const isApiFailure =
      ["fetch", "xhr"].includes(resourceType) && status >= 400;

    if ((isCriticalAsset && status >= 400) || isApiFailure) {
      failures.push(
        `${resourceType} ${status}: ${response.url()}`,
      );
    }
  });

  return failures;
}

async function openModuleLauncher(page: Page) {
  await page
    .getByRole("button", { name: "Abrir jornadas e módulos" })
    .first()
    .click();

  const dialog = page.getByRole("dialog", {
    name: "Buscar módulos e funções",
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function assertInteractiveNames(page: Page, moduleTitle: string) {
  const results = await new AxeBuilder({ page })
    .withRules(["button-name", "link-name"])
    .analyze();
  const failures = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      impact: violation.impact,
      target: node.target.join(" "),
      html: node.html,
    })),
  );

  expect.soft(
    failures,
    `${moduleTitle}: botões e links precisam de nome acessível`,
  ).toEqual([]);
}

test.describe("Superfícies de módulos e controles @readonly", () => {
  test("abre por clique todos os módulos visíveis ao administrador", async ({
    page,
    loginAs,
  }, testInfo) => {
    test.setTimeout(240_000);

    test.skip(
      testInfo.project.name !== "chromium",
      "Varredura completa roda uma vez no Chromium; os demais projetos mantêm os gates focados.",
    );

    await loginAs("admin");
    const runtimeFailures = watchRuntimeFailures(page);
    const launcher = await openModuleLauncher(page);
    const moduleTitleSet = new Set<string>();
    const areaTabs = launcher.getByRole("tab").filter({ hasNotText: "Jornadas" });
    const areaCount = await areaTabs.count();
    for (let index = 0; index < areaCount; index += 1) {
      await areaTabs.nth(index).click();
      const titles = await launcher.locator("[cmdk-item] span.font-medium").allTextContents();
      titles
        .map((title) => title.trim())
        .filter(Boolean)
        .forEach((title) => moduleTitleSet.add(title));
    }
    const moduleTitles = [...moduleTitleSet];

    expect(
      moduleTitles.length,
      "O lançador deve expor os módulos autorizados ao administrador",
    ).toBeGreaterThan(20);
    expect(new Set(moduleTitles).size).toBe(moduleTitles.length);
    await page.keyboard.press("Escape");

    for (const moduleTitle of moduleTitles) {
      const failureCursor = runtimeFailures.length;
      const currentLauncher = await openModuleLauncher(page);
      const search = currentLauncher.getByPlaceholder(
        "Buscar tarefa, módulo ou função...",
      );
      await search.fill(moduleTitle);
      await currentLauncher.getByText(moduleTitle, { exact: true }).click();
      await expect(currentLauncher).toBeHidden();

      await expect(page.locator("main")).toBeVisible();
      await expect.soft(
        page.locator("main").getByRole("heading").first(),
        `${moduleTitle}: a tela precisa de um título visível`,
      ).toBeVisible({ timeout: 5_000 });
      await expect.soft(
        page.getByText(BROKEN_SCREEN_PATTERN),
        `${moduleTitle}: a tela não pode cair em erro de rota ou carregamento`,
      ).toHaveCount(0);
      await assertInteractiveNames(page, moduleTitle);
      expect.soft(
        runtimeFailures.slice(failureCursor),
        `${moduleTitle}: não pode gerar erro JavaScript nem falhar ao carregar assets`,
      ).toEqual([]);
    }
  });

  test("abre Segurança e sessões pelo menu da conta", async ({
    page,
    loginAs,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Jornada do menu de conta roda uma vez no Chromium.",
    );

    await loginAs("admin");
    const runtimeFailures = watchRuntimeFailures(page);
    await page
      .getByRole("button", { name: /abrir menu da conta/i })
      .click();
    await page
      .getByRole("menuitem", { name: "Segurança e sessões" })
      .click();

    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(
      page.locator("main").getByRole("heading").first(),
    ).toBeVisible();
    await expect(page.getByText(BROKEN_SCREEN_PATTERN)).toHaveCount(0);
    await assertInteractiveNames(page, "Segurança e sessões");
    expect(runtimeFailures).toEqual([]);
  });
});

test.describe("Navegação responsiva @readonly", () => {
  test("abre a barra lateral e navega para a Agenda no celular", async ({
    page,
    loginAs,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "Jornada responsiva específica do projeto mobile-chrome.",
    );

    await loginAs("admin");
    const runtimeFailures = watchRuntimeFailures(page);
    await page
      .getByRole("button", { name: "Alternar barra lateral" })
      .click();
    await page.getByRole("link", { name: "Agenda de pacientes" }).click();

    await expect(page).toHaveURL(/\/schedule$/);
    await expect(
      page.locator("main").getByRole("heading").first(),
    ).toBeVisible();
    await expect(page.getByText(BROKEN_SCREEN_PATTERN)).toHaveCount(0);
    expect(runtimeFailures).toEqual([]);
  });

  test("expõe jornadas separadas para entrada, caixa e convênio", async ({
    page,
    loginAs,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "A arquitetura de navegação é validada uma vez no Chromium.",
    );

    await loginAs("admin");
    const launcher = await openModuleLauncher(page);

    await expect(launcher.getByText("Dar entrada no paciente", { exact: true })).toBeVisible();
    await expect(
      launcher.getByText("Receber particular ou coparticipação", { exact: true }),
    ).toBeVisible();
    await expect(
      launcher.getByText("Faturar atendimento pelo convênio", { exact: true }),
    ).toBeVisible();
  });
});

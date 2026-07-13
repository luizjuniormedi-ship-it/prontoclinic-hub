import { test, expect, type Page } from "./fixtures/backend-health";
import type { Request, TestInfo } from "@playwright/test";

type TestRole = "admin" | "financeiro" | "recepcao";

type ObservedRpcRequest = {
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
};

type RequestAudit = {
  externalRequests: string[];
  listRequests: ObservedRpcRequest[];
  transitionRequests: ObservedRpcRequest[];
  runtimeErrors: string[];
};

const PAYMENT_ID = 995101;
const PASSWORD = "TestPassword123!";

function parseBody(request: Request): Record<string, unknown> | null {
  try {
    return request.postDataJSON() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function installRequestAudit(page: Page, testInfo: TestInfo): Promise<RequestAudit> {
  const audit: RequestAudit = {
    externalRequests: [],
    listRequests: [],
    transitionRequests: [],
    runtimeErrors: [],
  };
  const appOrigin = new URL(String(testInfo.project.use.baseURL ?? "http://localhost:5173")).origin;
  const backendUrl = process.env.VITE_SUPABASE_URL;
  if (!backendUrl) throw new Error("VITE_SUPABASE_URL obrigatoria para o E2E real de repasses");
  const localOrigins = new Set([appOrigin, new URL(backendUrl).origin]);

  page.on("pageerror", (error) => audit.runtimeErrors.push(error.message));

  // O coletor precisa observar a request antes de qualquer route handler.
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !localOrigins.has(url.origin)) {
      audit.externalRequests.push(request.url());
    }
    if (request.method() !== "POST") return;

    const observed = { url: request.url(), body: parseBody(request), headers: request.headers() };
    if (url.pathname.endsWith("/rpc/list_professional_payments")) {
      audit.listRequests.push(observed);
    } else if (url.pathname.endsWith("/rpc/transition_professional_payment")) {
      audit.transitionRequests.push(observed);
    }
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !localOrigins.has(url.origin)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  return audit;
}

async function login(page: Page, role: TestRole, runtimeErrors: string[]) {
  const email = role === "financeiro" ? "financeiro@prontomedic.test" : `${role}@prontomedic.test`;
  await page.goto("/login");
  await expect(page.getByLabel("E-mail")).toBeVisible({ timeout: 5_000 }).catch(() => {
    throw new Error(`Login nao montou. runtimeErrors=${JSON.stringify(runtimeErrors)}`);
  });
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

function expectCleanRuntime(audit: RequestAudit) {
  expect(audit.externalRequests, "requests para host externo").toEqual([]);
  expect(audit.runtimeErrors, "erros de runtime da pagina").toEqual([]);
}

function paymentRow(page: Page) {
  return page.locator(`tr[data-payment-id="${PAYMENT_ID}"]`);
}

async function confirmWithDoubleClick(page: Page, buttonName: string) {
  const button = page.getByRole("button", { name: buttonName });
  await expect(button).toBeVisible();
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
}

test.describe("Pagamento Medico - integracao real local", () => {
  test.describe.configure({ mode: "serial" });

  for (const role of ["admin", "financeiro"] as const) {
    test(`${role} lista o repasse seedado sem mocks`, async ({ page }, testInfo) => {
      const audit = await installRequestAudit(page, testInfo);
      await login(page, role, audit.runtimeErrors);

      await page.goto("/professional-payment");

      await expect(page.getByRole("heading", { name: "Pagamento Medico" })).toBeVisible();
      await expect(paymentRow(page)).toBeVisible();
      await expect.poll(() => audit.listRequests.length).toBeGreaterThan(0);
      expect(audit.transitionRequests).toEqual([]);
      expectCleanRuntime(audit);
    });
  }

  test("recepcao e negada antes de consultar repasses", async ({ page }, testInfo) => {
    const audit = await installRequestAudit(page, testInfo);
    await login(page, "recepcao", audit.runtimeErrors);

    await page.goto("/professional-payment");

    await expect(page.getByRole("heading", { name: "Acesso Negado" })).toBeVisible();
    expect(audit.listRequests).toEqual([]);
    expect(audit.transitionRequests).toEqual([]);
    expectCleanRuntime(audit);
  });

  test("financeiro executa apurado -> conferido -> pago com confirmacao, duplo clique e replay", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Fluxo mutavel roda uma vez contra o fixture compartilhado");
    const audit = await installRequestAudit(page, testInfo);
    await login(page, "financeiro", audit.runtimeErrors);
    await page.goto("/professional-payment");

    const row = paymentRow(page);
    await expect(row).toBeVisible();
    const startsApurado = await row.getByText("Apurado", { exact: true }).isVisible();

    if (startsApurado) {
      await row.getByRole("button", { name: "Conferir" }).click();
      await expect(page.getByRole("heading", { name: "Confirmar conferencia" })).toBeVisible();
      const before = audit.transitionRequests.length;
      await confirmWithDoubleClick(page, "Confirmar conferencia");
      await expect(row.getByText("Conferido", { exact: true })).toBeVisible();
      expect(audit.transitionRequests).toHaveLength(before + 1);
    }

    const isConferido = await row.getByText("Conferido", { exact: true }).isVisible();
    if (isConferido) {
      await row.getByRole("button", { name: "Pagar" }).click();
      await expect(page.getByText(/Confirme explicitamente o pagamento/)).toBeVisible();
      await page.getByRole("button", { name: "Confirmar pagamento" }).click();
      await expect(row.getByText("Pago", { exact: true })).toBeVisible();
    }

    await expect(row.getByText("Pago", { exact: true })).toBeVisible();
    const paidRequest = audit.transitionRequests.find(
      (request) => request.body?.p_target_status === "pago",
    );
    if (paidRequest) {
      expect(paidRequest.body?.p_payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const conferenceRequest = audit.transitionRequests.find(
      (request) => request.body?.p_target_status === "conferido",
    );
    if (conferenceRequest) {
      const replayHeaders = Object.fromEntries(
        Object.entries(conferenceRequest.headers).filter(([name]) =>
          ["apikey", "authorization", "content-type", "x-client-info"].includes(name.toLowerCase()),
        ),
      );
      const replay = await page.evaluate(async ({ url, headers, body }) => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        return { status: response.status, payload: await response.json() };
      }, { url: conferenceRequest.url, headers: replayHeaders, body: conferenceRequest.body });
      expect(replay.status).toBe(200);
      const replayRow = Array.isArray(replay.payload) ? replay.payload[0] : replay.payload;
      expect(replayRow.idempotent_replay ?? replayRow.idempotentReplay).toBe(true);

      await page.reload();
      await expect(paymentRow(page).getByText("Pago", { exact: true })).toBeVisible();
    }

    expectCleanRuntime(audit);
  });
});


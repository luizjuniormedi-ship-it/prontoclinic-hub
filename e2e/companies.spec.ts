import { createRequire } from "node:module";
import { test, expect } from "./fixtures/auth";

test.describe.configure({ mode: "serial" });

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
};

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (config: Record<string, unknown>) => PgClient;
};

const companyId = "eeeeeeee-1000-4000-8000-000000000001";
const syntheticCode = `PW-${Date.now().toString(36).toUpperCase()}`;
const originalCompany = {
  name: "Empresa E2E",
  cnpj: null,
  phone: null,
  email: null,
};

function requireLocalMutation(projectName: string) {
  test.skip(process.env.E2E_ENV !== "local", "Empresas mutável é exclusivo do ambiente local");
  test.skip(projectName !== "chromium", "A mutação canônica roda uma vez no Chromium");
  test.skip(
    process.env.E2E_MODE !== "mutating" || process.env.E2E_ALLOW_LOCAL_MUTATIONS !== "true",
    "Defina explicitamente o modo mutável local",
  );
  const host = (process.env.PGHOST || "").toLowerCase();
  const database = process.env.PGDATABASE || "";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) || !/(e2e|test|replay)/i.test(database)) {
    throw new Error("Empresas E2E exige PostgreSQL local descartável.");
  }
}

function databaseClient(): PgClient {
  return new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
}

test.afterAll(async () => {
  if (process.env.E2E_ENV !== "local" || process.env.E2E_ALLOW_LOCAL_MUTATIONS !== "true") return;
  const client = databaseClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM public.units WHERE company_id = $1::uuid AND cd_codigo = $2", [companyId, syntheticCode]);
    await client.query(
      "UPDATE public.companies SET name = $2, cnpj = $3, phone = $4, email = $5 WHERE id = $1::uuid",
      [companyId, originalCompany.name, originalCompany.cnpj, originalCompany.phone, originalCompany.email],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
});

test("admin AAL2 persiste empresa e unidade apenas no contexto ativo", async ({ page, loginAs }, testInfo) => {
  requireLocalMutation(testInfo.project.name);
  const unexpectedFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") unexpectedFailures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/rest/v1/rpc/")) {
      unexpectedFailures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  await loginAs("admin");
  await page.goto("/companies");
  await expect(page.getByRole("heading", { name: "Empresas & Unidades" })).toBeVisible();
  await expect(page.getByText("Empresa E2E", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova Unidade" })).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).first().click();
  await page.getByLabel("Razão social").fill("Empresa E2E Validada");
  await page.getByLabel("CNPJ").fill("12345678000195");
  await page.getByLabel("Telefone").fill("2138280349");
  await page.getByLabel("E-mail").fill("qa.empresas@prontomedic.test");
  const companyRpc = page.waitForResponse((response) => response.url().includes("/rpc/update_active_company_admin"));
  await page.getByRole("button", { name: "Salvar" }).click();
  expect((await companyRpc).ok()).toBeTruthy();
  await expect(page.getByText("Empresa E2E Validada", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Unidades/ }).click();
  await expect(page.getByText("Unidade E2E A", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nova Unidade" }).click();
  await page.getByLabel("Nome").fill("Unidade Playwright");
  await page.getByLabel("Código").fill(syntheticCode);
  await page.getByLabel("Tipo").click();
  await page.getByRole("option", { name: "Laboratório" }).click();
  const createRpc = page.waitForResponse((response) => response.url().includes("/rpc/upsert_active_company_unit_admin"));
  await page.getByRole("button", { name: "Salvar" }).click();
  expect((await createRpc).ok()).toBeTruthy();
  await expect(page.getByText("Unidade Playwright", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: /Unidades/ }).click();
  await page.getByLabel("Buscar empresas e unidades").fill(syntheticCode);
  await expect(page.getByText("Unidade Playwright", { exact: true })).toBeVisible();
  expect(unexpectedFailures).toEqual([]);
});

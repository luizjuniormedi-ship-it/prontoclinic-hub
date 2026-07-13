import { test, expect } from "./fixtures/auth";

test.describe("Farmácia F4 P0 — dispensação segura", () => {
  test("só confirma visualmente após a RPC atômica e não chama integrações externas", async ({ page, loginAs }, testInfo) => {
    const mutationRequests: Array<{ url: string; body: unknown }> = [];
    const externalRequests: string[] = [];
    const appOrigin = new URL(String(testInfo.project.use.baseURL ?? "http://localhost:5173")).origin;
    const allowedOrigins = new Set([
      appOrigin,
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]);
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (["http:", "https:"].includes(requestUrl.protocol) && !allowedOrigins.has(requestUrl.origin)) {
        externalRequests.push(route.request().url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await page.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;

      if (request.method() === "POST" && path.endsWith("/rpc/dispensar_estoque")) {
        mutationRequests.push({ url: request.url(), body: request.postDataJSON() });
        await commitGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 501,
            company_id: "11111111-1111-4111-8111-111111111111",
            cd_paciente: 101,
            dt_dispensacao: "2026-07-13T14:30:00.000Z",
            cd_usuario: "22222222-2222-4222-8222-222222222222",
            idempotent_replay: false,
          }]),
        });
        return;
      }

      if (request.method() === "GET" && path.endsWith("/user_profiles")) {
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.pgrst.object+json",
          body: JSON.stringify({
            id: "22222222-2222-4222-8222-222222222222",
            full_name: "Administrador E2E",
            role_id: null,
            role_name: "admin",
            company_id: "11111111-1111-4111-8111-111111111111",
            primary_unit_id: null,
          }),
        });
        return;
      }

      if (!['GET', 'HEAD'].includes(request.method())) {
        mutationRequests.push({ url: request.url(), body: request.postDataJSON() });
        await route.fulfill({ status: 405, body: "Unexpected mutation blocked by F4 E2E" });
        return;
      }

      if (path.endsWith("/patients")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 101,
            full_name: "Maria Teste Farmácia",
            cpf: "00000000191",
            birth_date: "1980-01-01",
          }]),
        });
        return;
      }

      if (path.endsWith("/medicamentos")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            id: 201,
            company_id: "11111111-1111-4111-8111-111111111111",
            cd_principio_ativo: "Clonazepam",
            cd_nome_comercial: "Teste controlado",
            ds_concentracao: "2 mg",
            ds_forma_farmaceutica: "COMPRIMIDO",
            lg_controlado: true,
            lg_generico: false,
            lg_ativo: true,
            created_at: "2026-07-13T12:00:00.000Z",
            updated_at: "2026-07-13T12:00:00.000Z",
          }]),
        });
        return;
      }

      if (path.endsWith("/v_estoque_atual")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{
            cd_lote: 301,
            company_id: "11111111-1111-4111-8111-111111111111",
            cd_produto_tipo: "MEDICAMENTO",
            cd_medicamento_id: 201,
            nr_lote: "F4-CLONA-2027",
            ds_produto: "Clonazepam 2 mg",
            dt_validade: "2027-12-31",
            qt_atual: 20,
            vl_custo_unitario: 1.5,
            status_validade: "OK",
          }]),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.route("**/auth/v1/token**", async (route) => {
      const now = Math.floor(Date.now() / 1000);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.mock",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "f4-e2e-refresh-token",
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            aud: "authenticated",
            role: "authenticated",
            email: "admin@prontomedic.test",
            email_confirmed_at: "2026-07-13T12:00:00.000Z",
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: {},
            identities: [],
            created_at: "2026-07-13T12:00:00.000Z",
            updated_at: "2026-07-13T12:00:00.000Z",
          },
        }),
      });
    });

    await loginAs("admin");

    await page.goto("/pharmacy");
    await page.getByRole("tab", { name: /dispensar/i }).click();

    await page.getByLabel("Buscar paciente").fill("Maria");
    await page.getByRole("button", { name: /Maria Teste Farmácia/i }).click();
    await page.getByRole("button", { name: /próximo/i }).click();

    await page.getByLabel("Buscar medicamento").fill("Clonazepam");
    await page.getByRole("button", { name: /Clonazepam 2 mg/i }).click();
    await expect(page.getByText("20 disp.")).toBeVisible();
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(page.getByText(/SNGPC não integrado/i)).toBeVisible();
    await page.getByRole("button", { name: /revisar/i }).click();

    await expect(page.getByRole("button", { name: /baixar recibo confirmado/i })).toHaveCount(0);
    await expect(page.getByText(/confirmada após o commit/i)).toHaveCount(0);

    await page.getByRole("button", { name: /confirmar e dispensar/i }).click();
    await expect.poll(() => mutationRequests.length).toBe(1);
    await expect(page.getByText("Processando...")).toBeVisible();
    await expect(page.getByText(/confirmada após o commit/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /baixar recibo confirmado/i })).toHaveCount(0);

    releaseCommit?.();

    await expect(page.getByText("Dispensação #501 confirmada após o commit.")).toBeVisible();
    await expect(page.getByRole("button", { name: /baixar recibo confirmado/i })).toBeVisible();
    await expect(page.getByText(/SNGPC não integrado/i)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /baixar recibo confirmado/i }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let receipt = "";
    for await (const chunk of stream) receipt += chunk.toString("utf8");
    expect(receipt).toContain("lote F4-CLONA-2027");
    expect(receipt).not.toMatch(/lote 301\b/);
    expect(receipt).toContain("SNGPC: PENDENTE - integracao externa nao disponivel.");

    expect(mutationRequests).toHaveLength(1);
    expect(mutationRequests[0].url).toContain("/rest/v1/rpc/dispensar_estoque");
    expect(mutationRequests[0].url).not.toMatch(/sigh|sngpc|anvisa/i);
    expect(mutationRequests[0].body).toMatchObject({
      p_paciente_id: 101,
      p_itens: [{ cd_lote: 301, qt_dispensada: 1 }],
      p_appointment_id: null,
      p_prescricao_id: null,
      p_observacao: null,
    });
    expect(mutationRequests[0].body).not.toHaveProperty("company_id");
    expect(mutationRequests[0].body).not.toHaveProperty("cd_usuario");
    expect(externalRequests, "qualquer request fora da origem do app/local auth deve falhar").toEqual([]);
  });
});


import { test, expect, type UserRole } from "./fixtures/auth";
import type { Page } from "@playwright/test";

type ControlRole = "button" | "textbox" | "tab" | "combobox";
type Interaction =
  | { kind: "fill"; value: string }
  | { kind: "click"; after?: { role: ControlRole | "heading"; name: RegExp } }
  | { kind: "select"; option: RegExp };

type UsageScenario = {
  role: UserRole;
  label: string;
  profilePattern: RegExp;
  route: string;
  heading: RegExp;
  control: { role: ControlRole; name: RegExp; withinText?: RegExp };
  interaction: Interaction;
  followUp?: {
    role: ControlRole;
    name: RegExp;
    action: "click" | "enter";
    after: { role: ControlRole | "heading"; name: RegExp };
  };
  deniedRoute: string;
  forbiddenTable: string | null;
  expectedText?: RegExp;
};

const scenarios: UsageScenario[] = [
  {
    role: "admin",
    label: "administrador",
    profilePattern: /admin|administrador/i,
    route: "/admin/users",
    heading: /^usuários do sistema$/i,
    control: {
      role: "button",
      name: /^editar$/i,
      withinText: /Admin E2E|admin@prontomedic\.test/i,
    },
    interaction: { kind: "click", after: { role: "heading", name: /^editar usuário$/i } },
    deniedRoute: "",
    forbiddenTable: null,
  },
  {
    role: "manager",
    label: "gestor",
    profilePattern: /gestor/i,
    route: "/bi",
    heading: /^bi \/ indicadores$/i,
    control: { role: "combobox", name: /período do dashboard/i },
    interaction: { kind: "select", option: /^15 dias$/i },
    deniedRoute: "/admin/users",
    forbiddenTable: "user_profiles",
  },
  {
    role: "reception",
    label: "recepção",
    profilePattern: /recepç[aã]o|recepcao/i,
    route: "/reception",
    heading: /^recepção do dia$/i,
    control: { role: "textbox", name: /buscar pacientes da recepção/i },
    interaction: { kind: "fill", value: "Paciente E2E A" },
    deniedRoute: "/nursing/care",
    forbiddenTable: "medical_records",
  },
  {
    role: "callCenter",
    label: "call center",
    profilePattern: /call[ _-]?center/i,
    route: "/callcenter",
    heading: /^call center$/i,
    control: { role: "textbox", name: /buscar contatos/i },
    interaction: { kind: "fill", value: "Paciente E2E A" },
    deniedRoute: "/reception",
    forbiddenTable: "medical_records",
  },
  {
    role: "doctor",
    label: "médico",
    profilePattern: /m[eé]dico/i,
    route: "/records",
    heading: /^prontuário eletrônico$/i,
    control: { role: "textbox", name: /buscar paciente por nome/i },
    interaction: { kind: "fill", value: "Paciente E2E A" },
    followUp: {
      role: "button",
      name: /abrir prontuário de paciente e2e a/i,
      action: "enter",
      after: { role: "heading", name: /^prontuário — paciente e2e a$/i },
    },
    deniedRoute: "/admin/users",
    forbiddenTable: "role_permissions",
  },
  {
    role: "nursing",
    label: "enfermagem",
    profilePattern: /enfermagem/i,
    route: "/nursing/triage",
    heading: /^triagem de enfermagem$/i,
    control: { role: "button", name: /nova triagem/i },
    interaction: { kind: "click", after: { role: "button", name: /fechar formulário/i } },
    deniedRoute: "/billing-accounts",
    forbiddenTable: "billing_accounts",
  },
  {
    role: "laboratory",
    label: "laboratório",
    profilePattern: /laborat[oó]rio/i,
    route: "/lab",
    heading: /^laboratório \(lis\)$/i,
    control: { role: "tab", name: /pedidos/i },
    interaction: { kind: "click" },
    deniedRoute: "/admin/users",
    forbiddenTable: "user_profiles",
  },
  {
    role: "diagnostics",
    label: "diagnóstico",
    profilePattern: /diagn[oó]stico/i,
    route: "/dicom/nodes",
    heading: /^nós DICOM \/ PACS$/i,
    control: { role: "button", name: /^novo nó$/i },
    interaction: { kind: "click", after: { role: "heading", name: /^novo nó DICOM$/i } },
    deniedRoute: "/billing-accounts",
    forbiddenTable: "billing_accounts",
  },
  {
    role: "pharmacy",
    label: "farmácia",
    profilePattern: /farm[aá]cia/i,
    route: "/pharmacy",
    heading: /^farmácia e materiais$/i,
    control: { role: "tab", name: /medicamentos/i },
    interaction: { kind: "click" },
    deniedRoute: "/records",
    forbiddenTable: "medical_records",
  },
  {
    role: "financial",
    label: "financeiro",
    profilePattern: /financeiro/i,
    route: "/billing-accounts",
    heading: /^faturamento$/i,
    control: { role: "button", name: /só pendências/i },
    interaction: { kind: "click" },
    deniedRoute: "/records",
    forbiddenTable: "medical_records",
  },
  {
    role: "billing",
    label: "faturamento",
    profilePattern: /faturamento/i,
    route: "/billing-accounts",
    heading: /^faturamento$/i,
    control: { role: "button", name: /só pendências/i },
    interaction: { kind: "click" },
    deniedRoute: "/financial",
    forbiddenTable: "medical_records",
  },
  {
    role: "dpo",
    label: "DPO",
    profilePattern: /dpo/i,
    route: "/admin/lgpd",
    heading: /^modulo lgpd$/i,
    control: { role: "tab", name: /consentimentos/i },
    interaction: { kind: "click" },
    deniedRoute: "/patients",
    forbiddenTable: "patients",
  },
  {
    role: "administrative",
    label: "administrativo",
    profilePattern: /administrativo/i,
    route: "/professionals",
    heading: /^profissionais$/i,
    control: { role: "button", name: /novo profissional/i },
    interaction: { kind: "click", after: { role: "heading", name: /^novo profissional$/i } },
    deniedRoute: "/admin/users",
    forbiddenTable: "user_profiles",
  },
  {
    role: "patient",
    label: "paciente",
    profilePattern: /paciente/i,
    route: "/meus-agendamentos",
    heading: /^meus agendamentos$/i,
    control: { role: "tab", name: /próximos/i },
    interaction: { kind: "click" },
    deniedRoute: "/patients",
    forbiddenTable: "medical_records",
    expectedText: /Fixture portal paciente/i,
  },
];

async function accessTokenFromBrowser(page: Page) {
  return page.evaluate(() => {
    for (const [key, raw] of Object.entries(window.localStorage)) {
      if (!key.includes("auth-token")) continue;
      try {
        const value = JSON.parse(raw) as { access_token?: string; currentSession?: { access_token?: string } };
        const token = value.access_token ?? value.currentSession?.access_token;
        if (token) return token;
      } catch {
        // Ignora chaves de storage que não pertençam à sessão Supabase.
      }
    }
    return null;
  });
}

test.describe("uso real de telas e controles por perfil", () => {
  test.describe.configure({ retries: 0 });

  for (const scenario of scenarios) {
    test(`${scenario.label}: usa controle permitido e bloqueia interface e API proibidas`, async ({ page, loginAs }) => {
      const pageErrors: string[] = [];
      const requestErrors: string[] = [];
      const consoleErrors: string[] = [];
      let monitorAllowedPhase = true;
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (monitorAllowedPhase && response.status() >= 400) {
          requestErrors.push(`${response.status()} ${response.url()}`);
        }
      });
      page.on("requestfailed", (request) => {
        if (monitorAllowedPhase) {
          requestErrors.push(
            `FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "sem detalhe"}`,
          );
        }
      });
      page.on("console", (message) => {
        if (monitorAllowedPhase && message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });

      await loginAs(scenario.role);
      await page.goto(scenario.route);

      const heading = page.getByRole("heading", { name: scenario.heading });
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();

      const controlScope = scenario.control.withinText
        ? page.getByRole("row").filter({ hasText: scenario.control.withinText })
        : page;
      if (scenario.control.withinText) {
        await expect(controlScope).toHaveCount(1);
      }
      const matchingControls = controlScope.getByRole(scenario.control.role, {
        name: scenario.control.name,
      });
      await expect(matchingControls).toHaveCount(1);
      const control = matchingControls;
      await expect(control).toBeVisible();

      await expect(page.getByRole("button", { name: "Selecionar empresa, unidade e perfil" }))
        .toContainText(scenario.profilePattern);

      if (scenario.interaction.kind === "fill") {
        await control.fill(scenario.interaction.value);
        await expect(control).toHaveValue(scenario.interaction.value);
      } else if (scenario.interaction.kind === "select") {
        await control.click();
        await page.getByRole("option", { name: scenario.interaction.option }).click();
        await expect(control).toContainText(scenario.interaction.option);
      } else {
        await control.click();
        if (scenario.interaction.after) {
          await expect(page.getByRole(scenario.interaction.after.role, {
            name: scenario.interaction.after.name,
          })).toBeVisible();
        } else if (scenario.control.role === "tab") {
          await expect(control).toHaveAttribute("aria-selected", "true");
        } else if (scenario.role === "financial" || scenario.role === "billing") {
          await expect(control).toHaveAttribute("aria-pressed", "true");
        }
      }

      if (scenario.expectedText) {
        await expect(page.getByText(scenario.expectedText).first()).toBeVisible();
      }

      if (scenario.followUp) {
        const followUp = page.getByRole(scenario.followUp.role, { name: scenario.followUp.name });
        await expect(followUp).toBeVisible();
        await followUp.focus();
        if (scenario.followUp.action === "enter") {
          await followUp.press("Enter");
        } else {
          await followUp.click();
        }
        await expect(page.getByRole(scenario.followUp.after.role, {
          name: scenario.followUp.after.name,
        })).toBeVisible();
      }

      if (scenario.role === "patient") {
        const portalCard = page.getByRole("listitem").filter({ hasText: /Fixture portal paciente/i });
        await expect(portalCard).toHaveCount(1);
        const confirmationResponsePromise = page.waitForResponse((response) =>
          response.url().includes("/rest/v1/rpc/update_my_appointment_status_secure")
          && response.request().method() === "POST"
        );
        await portalCard.getByRole("button", { name: /confirmar presença/i }).click();
        const confirmationResponse = await confirmationResponsePromise;
        expect(
          confirmationResponse.ok(),
          await confirmationResponse.text(),
        ).toBe(true);
        await expect(page.getByText(/presença confirmada/i)).toBeVisible();
        await expect(
          portalCard.getByRole("button", { name: /confirmar presença/i }),
        ).toHaveCount(0);

        const token = await accessTokenFromBrowser(page);
        expect(token, "sessão autenticada precisa expor access token local").toBeTruthy();
        const apiBase = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:18000";
        const persistenceResponse = await page.request.get(
          `${apiBase}/rest/v1/appointments?id=eq.91004&select=id,status`,
          {
            headers: {
              apikey: process.env.VITE_SUPABASE_ANON_KEY ?? "local-e2e-public-key",
              authorization: `Bearer ${token}`,
            },
          },
        );
        expect(persistenceResponse.status(), await persistenceResponse.text()).toBe(200);
        expect(await persistenceResponse.json()).toEqual([
          expect.objectContaining({ id: 91004, status: "confirmed" }),
        ]);

        const isolationResponse = await page.request.get(
          `${apiBase}/rest/v1/appointments?id=eq.91003&select=id`,
          {
            headers: {
              apikey: process.env.VITE_SUPABASE_ANON_KEY ?? "local-e2e-public-key",
              authorization: `Bearer ${token}`,
            },
          },
        );
        expect(isolationResponse.status(), await isolationResponse.text()).toBe(200);
        expect(await isolationResponse.json()).toEqual([]);
      }

      expect(requestErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      monitorAllowedPhase = false;

      if (scenario.deniedRoute) {
        await page.goto(scenario.deniedRoute);
        await expect(page.getByRole("heading", { name: /^acesso negado$/i })).toBeVisible();
      }

      if (scenario.forbiddenTable) {
        const token = await accessTokenFromBrowser(page);
        expect(token, "sessão autenticada precisa expor access token local").toBeTruthy();
        const apiBase = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:18000";
        const response = await page.request.get(`${apiBase}/rest/v1/${scenario.forbiddenTable}?limit=1`, {
          headers: {
            apikey: process.env.VITE_SUPABASE_ANON_KEY ?? "local-e2e-public-key",
            authorization: `Bearer ${token}`,
          },
        });
        expect(response.status(), await response.text()).toBe(403);
      }

      expect(pageErrors).toEqual([]);
    });
  }
});


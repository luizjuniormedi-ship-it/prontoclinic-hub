import {
  clearBrowserAuth,
  credentialsForOrNull,
  expect,
  loginAsRole,
  test,
  type UserRole,
} from "./fixtures/auth";

const waveReady = process.env.E2E_CLINICAL_WAVE_READY === "true";

const routes = [
  "/nursing/clinical",
  "/prescriptions",
  "/care-protocols",
  "/exam-requests",
] as const;

async function requireAccount(role: UserRole) {
  if (waveReady && !credentialsForOrNull(role)) {
    throw new Error(`Conta ${role} é obrigatória quando E2E_CLINICAL_WAVE_READY=true.`);
  }
}

function requireFixture(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} é obrigatório quando E2E_CLINICAL_WAVE_READY=true.`);
  return value.trim();
}

test.describe("M19-M22 — segurança de rota @readonly", () => {
  test.beforeEach(() => {
    test.skip(
      !waveReady,
      "E2E_CLINICAL_WAVE_READY=true é obrigatório e pressupõe build com M19-M22 habilitados.",
    );
  });

  test.afterEach(async ({ page }) => {
    await clearBrowserAuth(page);
  });

  for (const route of routes) {
    test(`sessão anônima não abre ${route}`, async ({ page }) => {
      await clearBrowserAuth(page);
      await page.goto(route);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    });
  }
});

test.describe("M19-M22 — matriz UI autenticada @readonly", () => {
  test.beforeEach(() => {
    test.skip(
      !waveReady,
      "E2E_CLINICAL_WAVE_READY=true é obrigatório e pressupõe build com M19-M22 habilitados.",
    );
  });

  test.afterEach(async ({ page }) => {
    await clearBrowserAuth(page);
  });

  test("farmácia consulta prescrições sem criar nova", async ({ page }) => {
    await requireAccount("pharmacyA");
    await loginAsRole(page, "pharmacyA");
    await page.goto("/prescriptions");
    await expect(page.getByRole("heading", { name: "Prescrição eletrônica" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova prescrição" })).toHaveCount(0);
  });

  test("médico mantém criação de prescrição", async ({ page }) => {
    await requireAccount("doctorA");
    await loginAsRole(page, "doctorA");
    await page.goto("/prescriptions");
    await expect(page.getByRole("button", { name: "Nova prescrição" })).toBeVisible();
  });

  test("enfermagem executa protocolos sem gerenciar definições", async ({ page }) => {
    await requireAccount("nurseA");
    await loginAsRole(page, "nurseA");
    await page.goto("/care-protocols");
    await expect(page.getByRole("heading", { name: "Protocolos assistenciais" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova definição" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Publicar versão" })).toHaveCount(0);
  });

  test("gestor mantém gerenciamento de definições", async ({ page }) => {
    await requireAccount("managerA");
    await loginAsRole(page, "managerA");
    await page.goto("/care-protocols");
    await expect(page.getByRole("button", { name: "Nova definição" })).toBeVisible();
  });

  test("diagnóstico consulta e executa sem criar pedidos", async ({ page }) => {
    await requireAccount("diagnosticA");
    await loginAsRole(page, "diagnosticA");
    await page.goto("/exam-requests");
    await expect(page.getByRole("heading", { name: "Solicitação de exames" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nova requisição" })).toHaveCount(0);
  });

  test("recepção é recusada nos quatro módulos", async ({ page }) => {
    await requireAccount("receptionA");
    await loginAsRole(page, "receptionA");
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByText(/acesso negado|sem permissão/i)).toBeVisible();
    }
  });

  test("empresa B não lista prescrições do paciente sintético da empresa A", async ({ page }) => {
    await requireAccount("doctorB");
    const companyAPatientId = requireFixture(
      process.env.E2E_COMPANY_A_M20_PATIENT_ID,
      "E2E_COMPANY_A_M20_PATIENT_ID",
    );

    await loginAsRole(page, "doctorB");
    await page.goto("/prescriptions");
    await page.getByLabel("Identificador do paciente").fill(companyAPatientId);
    await page.getByRole("button", { name: "Consultar" }).click();
    await expect(page.getByText("Nenhuma prescrição carregada.")).toBeVisible();
  });

  test("enfermagem da empresa B abre M19 no próprio contexto", async ({ page }) => {
    await requireAccount("nurseB");
    await loginAsRole(page, "nurseB");
    await page.goto("/nursing/clinical");
    await expect(page.getByRole("heading", { name: "Enfermagem e triagem" })).toBeVisible();
  });

  test("rota legada preserva appointment, paciente e fila ao encaminhar para M19", async ({ page }) => {
    await requireAccount("nurseA");
    await loginAsRole(page, "nurseA");
    await page.goto(
      "/nursing/triage?patientId=91001&appointmentId=91001&queueId=91001&origin=reception",
    );

    await expect(page).toHaveURL(
      /\/nursing\/clinical\?patientId=91001&appointmentId=91001&queueId=91001&origin=reception$/,
    );
    await expect(page.getByRole("heading", { name: "Enfermagem e triagem" })).toBeVisible();
  });

  test("M19 mantém o contexto canônico em viewport móvel", async ({ page }) => {
    await requireAccount("nurseA");
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsRole(page, "nurseA");
    await page.goto(
      "/nursing/clinical?patientId=91001&appointmentId=91001&queueId=91001&origin=reception",
    );

    await expect(page.getByRole("heading", { name: "Enfermagem e triagem" })).toBeVisible();
    await expect(page.getByLabel("Paciente")).toHaveValue("91001");
    await expect(page.getByLabel("Agendamento")).toHaveValue("91001");
    await expect(page.getByLabel("Senha da fila")).toHaveValue("91001");
    await expect(page.getByLabel("Paciente")).toHaveAttribute("readonly");
    await expect(page.getByLabel("Agendamento")).toHaveAttribute("readonly");
    await expect(page.getByLabel("Senha da fila")).toHaveAttribute("readonly");
    await expect.poll(() => page.evaluate(() => ({
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }))).toEqual({ viewport: 390, content: 390 });
    const classification = page.getByRole("combobox", { name: "Classificação de risco" });
    await classification.scrollIntoViewIfNeeded();
    await classification.click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    const completeButton = page.getByRole("button", { name: "Concluir triagem" });
    await completeButton.scrollIntoViewIfNeeded();
    await expect(completeButton).toBeInViewport();
    await expect(completeButton).toBeDisabled();
  });
});

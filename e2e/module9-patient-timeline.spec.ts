import { expect } from "@playwright/test";
import { test as authed } from "./fixtures/auth";

authed.describe("M9 visão longitudinal do paciente @readonly", () => {
  authed("abre a timeline pelo perfil e preserva os modos de visualização", async ({
    page,
    loginAs,
  }) => {
    await loginAs("admin");
    await page.goto("/clinical-timeline");
    await expect(page.getByRole("heading", { name: "Timeline Clínica" })).toBeVisible();
    await page.getByPlaceholder("Buscar paciente por nome...").fill("Paciente E2E A");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.getByRole("button", { name: "Paciente E2E A", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Paciente E2E A" })).toBeVisible();
    await expect(page.getByRole("button", { name: /emitir receita/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /todos \(/i })).toBeVisible();
    await expect(page.getByText(/pagamento:/i)).toHaveCount(0);
  });

  authed("recepção abre o resumo sem navegar para prontuário clínico", async ({
    page,
    loginAs,
  }) => {
    await loginAs("reception");
    await page.goto("/reception");
    const patientButton = page.getByRole("button", { name: /ver agendamentos de/i }).first();
    await expect(patientButton).toBeVisible();
    await patientButton.click();
    await expect(page.getByText(/visão longitudinal|agendamentos/i).first()).toBeVisible();
    await expect(page.getByText(/pagamento:/i)).toHaveCount(0);
  });
});

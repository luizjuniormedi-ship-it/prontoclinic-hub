import { describe, expect, it } from "vitest";
import { canAccessRoute, normalizeRoleName } from "@/config/routePermissions";

describe("routePermissions — fluxo operacional", () => {
  it("mantém atendimento restrito ao perfil clínico", () => {
    expect(canAccessRoute("Recepção", "/attendance/123")).toBe(false);
    expect(canAccessRoute("Médico", "/attendance/123")).toBe(true);
  });

  it("permite faturamento aos perfis financeiros autorizados", () => {
    expect(canAccessRoute("Financeiro", "/billing-accounts")).toBe(true);
    expect(canAccessRoute("Recepção", "/billing-accounts")).toBe(false);
  });

  it("normaliza aliases usados no fluxo", () => {
    expect(normalizeRoleName(" recepcionista ")).toBe("recepcao");
    expect(normalizeRoleName("diagnóstico")).toBe("diagnostico");
  });
});

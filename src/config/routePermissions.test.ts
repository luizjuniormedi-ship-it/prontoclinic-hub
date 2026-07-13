import { describe, expect, it } from "vitest";
import {
  canAccessRoute,
  getAccessiblePrefixes,
  normalizeRoleName,
  ROLES,
} from "@/config/routePermissions";

describe("routePermissions — Farmácia F4", () => {
  it.each([
    "farmacia",
    "Farmácia",
    "farmaceutico",
    "Farmacêutico",
    "farmaceutica",
    "Farmacêutica",
  ])("normaliza o papel %s para o papel canônico de farmácia", (role) => {
    expect(normalizeRoleName(role)).toBe(ROLES.FARMACIA);
  });

  it("permite a rota de farmácia somente para farmácia e admin", () => {
    expect(canAccessRoute("farmacia", "/pharmacy")).toBe(true);
    expect(canAccessRoute("Farmacêutico", "/pharmacy")).toBe(true);
    expect(canAccessRoute("admin", "/pharmacy")).toBe(true);

    for (const role of ["medico", "gestor", "administrativo", "recepcao"]) {
      expect(canAccessRoute(role, "/pharmacy")).toBe(false);
    }
  });

  it("expõe o prefixo da farmácia ao papel canônico", () => {
    expect(getAccessiblePrefixes("farmacia")).toContain("/pharmacy");
    expect(getAccessiblePrefixes("medico")).not.toContain("/pharmacy");
  });
});


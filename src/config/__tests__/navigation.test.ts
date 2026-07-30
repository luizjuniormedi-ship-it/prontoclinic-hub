import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/moduleRollout", () => ({
  isWaveModuleEnabled: () => true,
}));

import {
  canOfferQuickCreate,
  getAuthorizedJourneys,
  getAuthorizedNavigation,
  getNavigationItemForPath,
  getPrimaryNavigation,
  navigationAreaOrder,
  navigationItems,
} from "@/config/navigation";
import {
  canAccessRoute,
  ROLES,
  type RoleName,
} from "@/config/routePermissions";

const ALL_ROLES = Object.values(ROLES) as RoleName[];

describe("navigation catalog", () => {
  it("keeps a unique route for each discoverable module", () => {
    const routes = navigationItems.map((item) => item.url);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it.each(ALL_ROLES)(
    "limits the daily sidebar for %s to at most eight authorized destinations",
    (role) => {
      const primary = getPrimaryNavigation(role);

      expect(primary.length).toBeGreaterThan(0);
      expect(primary.length).toBeLessThanOrEqual(8);
      expect(primary.every((item) => canAccessRoute(role, item.url))).toBe(true);
    },
  );

  it.each(ALL_ROLES)(
    "keeps every authorized catalog item available in the launcher for %s",
    (role) => {
      const authorized = getAuthorizedNavigation(role);

      expect(authorized).toEqual(
        navigationItems.filter((item) => canAccessRoute(role, item.url)),
      );
    },
  );

  it("prioritizes call center without granting unrelated schedule or patient access", () => {
    const routes = getPrimaryNavigation(ROLES.CALL_CENTER).map((item) => item.url);

    expect(routes).toContain("/callcenter");
    expect(routes).not.toContain("/schedule");
    expect(routes).not.toContain("/patients");
  });

  it("routes the reception supervisor through the canonical reception journey", () => {
    expect(canAccessRoute("supervisor_recepcao", "/reception")).toBe(true);
    expect(canAccessRoute("Supervisor de Recepção", "/reception")).toBe(true);
    expect(canAccessRoute("supervisor_recepcao", "/admin/users")).toBe(false);
  });

  it("keeps security outside the operational catalog because it belongs to the account menu", () => {
    expect(navigationItems.some((item) => item.url === "/account/security")).toBe(false);
  });

  it("does not infer write access from read-only module access", () => {
    expect(canOfferQuickCreate(ROLES.ADMIN, "patient")).toBe(true);
    expect(canOfferQuickCreate(ROLES.RECEPCAO, "appointment")).toBe(true);
    expect(canOfferQuickCreate(ROLES.MEDICO, "patient")).toBe(false);
    expect(canOfferQuickCreate(ROLES.GESTOR, "appointment")).toBe(false);
  });

  it("resolves contextual child routes to the owning module", () => {
    expect(getNavigationItemForPath("/patients/new")?.title).toBe("Pacientes");
    expect(getNavigationItemForPath("/bi/metas")?.title).toBe("Metas e resultados");
    expect(getNavigationItemForPath("/unmapped")).toBeNull();
  });

  it("uses labels that explain the operational purpose of ambiguous modules", () => {
    const titles = new Map(navigationItems.map((item) => [item.url, item.title]));

    expect(titles.get("/reception")).toBe("Entrada do paciente");
    expect(titles.get("/schedule")).toBe("Agenda de pacientes");
    expect(titles.get("/financial")).toBe("Caixa: Pix, cartão e dinheiro");
    expect(titles.get("/billing-accounts")).toBe("Faturamento de convênios");
    expect(titles.get("/dicom/nodes")).toBe("Servidores PACS e Worklist");
    expect(titles.get("/admin/tiss")).toBe("Guias TISS e lotes");
    expect(titles.get("/admin/organization")).toBe("Unidades, setores e recursos");
  });

  it("organizes the complete catalog in a small set of task-oriented areas", () => {
    expect(navigationAreaOrder).toEqual([
      "Meu trabalho",
      "Entrada e agenda",
      "Assistência clínica",
      "Exames e laudos",
      "Caixa e convênios",
      "Gestão",
      "Configurações",
    ]);
    expect(navigationItems.every((item) => navigationAreaOrder.includes(item.area))).toBe(true);
  });

  it("offers explicit payer journeys without granting unrelated modules", () => {
    expect(getAuthorizedJourneys(ROLES.RECEPCAO).map((item) => item.title)).toEqual([
      "Agendar paciente",
      "Dar entrada no paciente",
    ]);
    expect(getAuthorizedJourneys(ROLES.FINANCEIRO).map((item) => item.title)).toEqual([
      "Receber particular ou coparticipação",
      "Faturar atendimento pelo convênio",
    ]);
    expect(getAuthorizedJourneys(ROLES.ADMIN).map((item) => item.title)).toEqual([
      "Agendar paciente",
      "Dar entrada no paciente",
      "Receber particular ou coparticipação",
      "Faturar atendimento pelo convênio",
    ]);
  });

  it("routes payment terms to Caixa instead of Reception", () => {
    const reception = navigationItems.find((item) => item.url === "/reception");
    const financial = navigationItems.find((item) => item.url === "/financial");

    expect(reception?.keywords).not.toContain("pagamento");
    expect(financial?.keywords).toEqual(
      expect.arrayContaining(["pix", "cartão", "dinheiro", "pagamento", "particular"]),
    );
  });

  it("keeps the three payer paths visible in the administrator primary menu", () => {
    const primaryTitles = getPrimaryNavigation(ROLES.ADMIN).map((item) => item.title);

    expect(primaryTitles).toContain("Entrada do paciente");
    expect(primaryTitles).toContain("Caixa: Pix, cartão e dinheiro");
    expect(primaryTitles).toContain("Faturamento de convênios");
    expect(primaryTitles).toHaveLength(8);
  });
});

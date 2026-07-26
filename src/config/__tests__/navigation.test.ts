import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAccessibleNavigation,
  getNavigationItemForPath,
  getNavigationSearchValue,
  getSidebarNavigation,
  navigationItems,
  navigationWorkspaces,
} from "@/config/navigation";
import { canAccessRoute, normalizeRoleName, type RoleName } from "@/config/routePermissions";

const roles: RoleName[] = [
  "admin",
  "gestor",
  "recepcao",
  "medico",
  "enfermagem",
  "laboratorio",
  "diagnostico",
  "farmacia",
  "financeiro",
  "faturamento",
  "call_center",
  "dpo",
  "administrativo",
  "paciente",
];

const expectedSidebarIds: Record<RoleName, string[]> = {
  admin: ["dashboard", "schedule", "reception", "patients", "encounters", "billing-accounts", "financial", "bi"],
  gestor: ["dashboard", "schedule", "reception", "patients", "billing-accounts", "financial", "bi"],
  recepcao: ["dashboard", "schedule", "reception", "patients", "call-center", "pa"],
  medico: ["dashboard", "schedule", "encounters", "records", "radiology-reports", "telemedicine", "internacao"],
  enfermagem: ["dashboard", "nursing-triage", "nursing-care", "nursing-queue", "internacao", "pa"],
  laboratorio: ["dashboard", "lab", "imaging-execution"],
  diagnostico: ["dashboard", "imaging-orders", "imaging-execution", "dicom-worklist", "pacs", "radiology-reports"],
  farmacia: ["dashboard", "pharmacy", "purchases"],
  financeiro: ["dashboard", "billing-accounts", "billing-production", "financial", "professional-payment", "tiss"],
  faturamento: ["dashboard", "billing-accounts", "billing-production", "tiss", "price-tables"],
  call_center: ["dashboard", "call-center", "schedule", "patients"],
  dpo: ["dashboard", "lgpd", "audit", "admin-notifications"],
  administrativo: ["dashboard", "professionals", "companies", "insurances", "credentialing", "price-tables", "master-data", "settings"],
  paciente: ["my-appointments"],
};

describe("navigation catalog", () => {
  it("keeps every entry complete, unique and understandable", () => {
    const ids = new Set<string>();
    const urls = new Set<string>();

    for (const entry of navigationItems) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(12);
      expect(entry.url.startsWith("/")).toBe(true);
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(navigationWorkspaces.some((workspace) => workspace.id === entry.workspace)).toBe(true);
      expect(ids.has(entry.id), `id duplicado: ${entry.id}`).toBe(false);
      expect(urls.has(entry.url), `URL duplicada: ${entry.url}`).toBe(false);
      ids.add(entry.id);
      urls.add(entry.url);
    }
  });

  it("represents every private AppLayout route in the catalog or as a contextual route", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const privateRoutes = Array.from(
      appSource.matchAll(/<Route\s+path="([^"]+)"\s+element={<AppLayout>/g),
      (match) => match[1],
    );

    expect(privateRoutes.length).toBeGreaterThan(50);
    for (const route of privateRoutes) {
      const concretePath = route.replace(/:[^/]+/g, "fixture");
      expect(
        getNavigationItemForPath(concretePath),
        `rota privada sem ponto de acesso catalogado: ${route}`,
      ).toBeDefined();
    }
  });

  it("keeps the App route gate equivalent to the permission advertised for that route", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const routeGates = Array.from(
      appSource.matchAll(
        /<Route path="([^"]+)" element={<AppLayout><ProtectedRoute path="([^"]+)"/g,
      ),
      (match) => ({ routePath: match[1], protectedPath: match[2] }),
    );

    expect(routeGates.length).toBeGreaterThan(50);
    for (const { routePath, protectedPath } of routeGates) {
      for (const role of roles) {
        expect(
          canAccessRoute(role, routePath),
          `${routePath} anuncia uma permissão diferente do gate ${protectedPath} para ${role}`,
        ).toBe(canAccessRoute(role, protectedPath));
      }
    }
  });

  it("uses segment boundaries when matching navigation and permissions", () => {
    expect(getNavigationItemForPath("/patients/123")?.id).toBe("patients");
    expect(getNavigationItemForPath("/attendance/123")?.id).toBe("encounters");
    expect(getNavigationItemForPath("/patients-legacy")).toBeUndefined();
    expect(canAccessRoute("recepcao", "/patients-legacy")).toBe(false);
  });

  it("exposes searchable names, descriptions and keywords", () => {
    const reception = navigationItems.find((entry) => entry.id === "reception");
    expect(reception).toBeDefined();
    expect(getNavigationSearchValue(reception!)).toContain("check-in");
    expect(getNavigationSearchValue(reception!)).toContain("Faça check-in");
  });

  it("keeps the exact daily menu for each supported profile", () => {
    for (const role of roles) {
      const sidebar = getSidebarNavigation(role);
      expect(sidebar.map((entry) => entry.id)).toEqual(expectedSidebarIds[role]);
      expect(sidebar.length).toBeGreaterThan(0);
      expect(sidebar.length).toBeLessThanOrEqual(8);
      for (const entry of sidebar) {
        expect(canAccessRoute(role, entry.url)).toBe(true);
      }
    }
  });

  it("preserves all modules for the administrator launcher", () => {
    expect(getAccessibleNavigation("admin")).toHaveLength(navigationItems.length);
  });

  it("does not expose unauthorized modules in the launcher", () => {
    const receptionIds = getAccessibleNavigation("recepcao").map((entry) => entry.id);
    expect(receptionIds).toEqual(expect.arrayContaining(["schedule", "reception", "patients", "call-center"]));
    expect(receptionIds).not.toEqual(expect.arrayContaining(["admin-users", "financial", "audit"]));

    const dpoIds = getAccessibleNavigation("dpo").map((entry) => entry.id);
    expect(dpoIds).toEqual(expect.arrayContaining(["lgpd", "audit", "admin-notifications"]));
    expect(dpoIds).not.toEqual(expect.arrayContaining(["patients", "billing-accounts"]));

    const patientIds = getAccessibleNavigation("paciente").map((entry) => entry.id);
    expect(patientIds).toEqual(["dashboard", "my-appointments"]);
    expect(patientIds).not.toEqual(expect.arrayContaining(["patients", "records", "admin-users"]));

    const administrativeIds = getAccessibleNavigation("administrativo").map((entry) => entry.id);
    expect(administrativeIds).not.toEqual(expect.arrayContaining(["admin-users", "admin-profiles", "admin-permissions"]));

    const receptionIdsAfterSegregation = getAccessibleNavigation("recepcao").map((entry) => entry.id);
    expect(receptionIdsAfterSegregation).toContain("nursing-queue");
    expect(receptionIdsAfterSegregation).not.toEqual(expect.arrayContaining(["nursing-triage", "nursing-care"]));
  });

  it("normalizes canonical, accented and operational role names", () => {
    expect(normalizeRoleName("Enfermagem")).toBe("enfermagem");
    expect(normalizeRoleName("Laboratório")).toBe("laboratorio");
    expect(normalizeRoleName("Farmácia")).toBe("farmacia");
    expect(normalizeRoleName("Recepção")).toBe("recepcao");
    expect(normalizeRoleName("Técnico")).toBe("diagnostico");
    expect(normalizeRoleName("Paciente")).toBe("paciente");
  });

  it("uses the most specific route when identifying the current screen", () => {
    expect(getNavigationItemForPath("/dicom/worklist")?.id).toBe("dicom-worklist");
    expect(getNavigationItemForPath("/admin/price-tables")?.id).toBe("price-tables");
    expect(getNavigationItemForPath("/")?.id).toBe("dashboard");
  });
});


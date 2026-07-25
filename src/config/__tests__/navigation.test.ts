import { describe, expect, it } from "vitest";
import {
  getAccessibleNavigation,
  getNavigationItemForPath,
  getSidebarNavigation,
  navigationItems,
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
  "dpo",
  "administrativo",
];

describe("navigation catalog", () => {
  it("keeps every menu entry understandable", () => {
    for (const entry of navigationItems) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(12);
      expect(entry.url.startsWith("/")).toBe(true);
    }
  });

  it("limits the daily sidebar without removing access to allowed modules", () => {
    for (const role of roles) {
      const sidebar = getSidebarNavigation(role);
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

  it("gives reception direct access to its daily journey", () => {
    const ids = getSidebarNavigation("recepcao").map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["schedule", "reception", "patients", "call-center"]));
  });

  it("normalizes canonical and accented role names", () => {
    expect(normalizeRoleName("Enfermagem")).toBe("enfermagem");
    expect(normalizeRoleName("Laboratório")).toBe("laboratorio");
    expect(normalizeRoleName("Farmácia")).toBe("farmacia");
    expect(normalizeRoleName("Recepção")).toBe("recepcao");
  });

  it("uses the most specific route when identifying the current screen", () => {
    expect(getNavigationItemForPath("/dicom/worklist")?.id).toBe("dicom-worklist");
    expect(getNavigationItemForPath("/admin/price-tables")?.id).toBe("price-tables");
    expect(getNavigationItemForPath("/")?.id).toBe("dashboard");
  });
});

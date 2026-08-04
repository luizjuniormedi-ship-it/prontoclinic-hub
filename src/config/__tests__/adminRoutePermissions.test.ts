import { describe, expect, it } from "vitest";
import { canAccessRoute, getAccessiblePrefixes } from "@/config/routePermissions";

describe("administrative route authorization", () => {
  it.each(["admin", "Administrador", "superadmin", "super_admin"])(
    "allows a strong administrative role (%s)",
    (role) => {
      expect(canAccessRoute(role, "/admin/users")).toBe(true);
    },
  );

  it.each(["administrativo", "gestor", "recepcao", "financeiro", null])(
    "rejects a non-admin role from the protected admin prefix (%s)",
    (role) => {
      expect(canAccessRoute(role, "/admin/users")).toBe(false);
    },
  );

  it("keeps the operational administrativo routes available", () => {
    expect(canAccessRoute("administrativo", "/settings")).toBe(true);
    expect(canAccessRoute("administrativo", "/master-data")).toBe(true);
    expect(canAccessRoute("administrativo", "/purchases")).toBe(true);
    expect(getAccessiblePrefixes("administrativo")).not.toContain("/admin");
  });
});

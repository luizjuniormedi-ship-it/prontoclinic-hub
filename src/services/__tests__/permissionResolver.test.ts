import { describe, expect, it } from "vitest";
import { resolvePermission } from "@/services/permissionResolver";

const role = { id: 1, role_id: 1, module: "patients", can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false };

describe("permissionResolver", () => {
  it("applies the role permission for the requested action", () => {
    expect(resolvePermission({ module: "patients", action: "view", rolePermission: role })).toBe(true);
    expect(resolvePermission({ module: "patients", action: "create", rolePermission: role })).toBe(false);
  });

  it("lets a scoped grant apply only to its unit", () => {
    const override = { module: "patients", action: "create", effect: "grant" as const, unit_id: 2 };
    expect(resolvePermission({ module: "patients", action: "create", rolePermission: role, unitId: 1, overrides: [override] })).toBe(false);
    expect(resolvePermission({ module: "patients", action: "create", rolePermission: role, unitId: 2, overrides: [override] })).toBe(true);
  });

  it("gives explicit deny precedence over grants and delegation", () => {
    expect(resolvePermission({
      module: "patients",
      action: "export",
      rolePermission: role,
      overrides: [{ module: "patients", action: "export", effect: "grant" }, { module: "patients", action: "export", effect: "deny" }],
      delegations: [{ module: "patients", actions: ["export"], approval_status: "approved", starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" }],
      at: new Date("2026-07-19T12:00:00Z"),
    })).toBe(false);
  });

  it("ignores expired and pending delegation", () => {
    expect(resolvePermission({
      module: "patients",
      action: "export",
      rolePermission: role,
      delegations: [{ module: "patients", actions: ["export"], approval_status: "pending", starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" }],
      at: new Date("2026-07-19T12:00:00Z"),
    })).toBe(false);
  });
});

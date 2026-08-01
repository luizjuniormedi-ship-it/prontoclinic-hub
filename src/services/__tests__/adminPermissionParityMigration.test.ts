import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731042000_admin_permission_parity_for_active_companies.sql",
  ),
  "utf8",
);

describe("admin permission parity migration", () => {
  it("backfills operational modules for active companies", () => {
    expect(migration).toContain("private.seed_admin_permissions_for_company");
    expect(migration).toContain("WHERE company_record.lg_ativo IS TRUE");
    expect(migration).toContain("('agenda')");
    expect(migration).toContain("('recepcao')");
    expect(migration).toContain("('nursing')");
    expect(migration).toContain("ON CONFLICT (company_id, role_id, module) DO UPDATE");
    expect(migration).toContain("CREATE TRIGGER companies_seed_admin_permissions");
  });

  it("does not expose the seeding helper to application roles", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION");
  });
});

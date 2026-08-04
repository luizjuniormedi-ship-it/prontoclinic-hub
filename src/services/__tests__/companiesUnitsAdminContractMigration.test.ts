import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260804033225_secure_companies_units_admin_contract.sql",
), "utf8");

describe("companies and units administrative contract", () => {
  it("removes permissive unit writes and direct authenticated DML", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS units_insert ON public\.units/);
    expect(migration).toMatch(/DROP POLICY IF EXISTS units_update ON public\.units/);
    expect(migration).toMatch(/DROP POLICY IF EXISTS units_delete ON public\.units/);
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.units FROM authenticated/);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*USING\s*\(\s*TRUE\s*\)/i);
  });

  it("requires the active AAL2 administrative context in both RPCs", () => {
    const checks = migration.match(/current_context_is_company_admin\(v_company_id\)/g) ?? [];
    expect(checks).toHaveLength(2);
    expect(migration).toMatch(/WHERE id = p_unit_id\s+AND company_id = v_company_id/);
    expect(migration).toMatch(/WHEN 'ambulatorio' THEN 'CLINICA'/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.update_active_company_admin[\s\S]*TO authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.upsert_active_company_unit_admin[\s\S]*TO authenticated/);
  });
});

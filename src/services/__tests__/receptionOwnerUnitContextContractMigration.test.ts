import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731023000_reception_owner_unit_context_contract.sql",
  "utf8",
);

describe("reception owner unit context contract migration", () => {
  it("scopes units to the active company", () => {
    expect(migration).toMatch(
      /CREATE POLICY m11_reception_owner_units_read[\s\S]*FOR SELECT TO prontomedic_reception_rpc_owner[\s\S]*company_id = public\.current_company_id\(\)[\s\S]*lg_ativo = TRUE/i,
    );
  });

  it("scopes unit access to the active company and authenticated user", () => {
    expect(migration).toMatch(
      /CREATE POLICY m11_reception_owner_unit_access_read[\s\S]*FOR SELECT TO prontomedic_reception_rpc_owner[\s\S]*company_id = public\.current_company_id\(\)[\s\S]*user_id = auth\.uid\(\)/i,
    );
  });

  it("does not introduce global access", () => {
    expect(migration).not.toMatch(/USING\s*\(\s*TRUE\s*\)/i);
    expect(migration).not.toMatch(/TO\s+(?:PUBLIC|anon)\b/i);
  });
});

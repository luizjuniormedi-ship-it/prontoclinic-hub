import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731022500_reception_owner_profile_context_contract.sql",
  "utf8",
);

describe("reception owner profile context contract migration", () => {
  it("scopes the RPC owner to the canonical user and active company", () => {
    expect(migration).toMatch(
      /CREATE POLICY m11_reception_owner_profiles_read[\s\S]*FOR SELECT TO prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toMatch(
      /company_id = public\.current_company_id\(\)/i,
    );
    expect(migration).toMatch(
      /\(id = auth\.uid\(\) OR user_id = auth\.uid\(\)\)/i,
    );
    expect(migration).toMatch(/lg_ativo = TRUE/i);
  });

  it("does not introduce global or anonymous profile reads", () => {
    expect(migration).not.toMatch(/USING\s*\(\s*TRUE\s*\)/i);
    expect(migration).not.toMatch(/TO\s+(?:PUBLIC|anon)\b/i);
  });
});

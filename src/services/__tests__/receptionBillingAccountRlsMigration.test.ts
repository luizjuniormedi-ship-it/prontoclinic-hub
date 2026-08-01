import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730180000_reception_billing_account_rls_closure.sql",
  ),
  "utf8",
);

describe("Reception billing account RLS closure", () => {
  it("replaces both legacy company-wide read policies", () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS billing_accounts_authenticated_read[\s\S]*DROP POLICY IF EXISTS billing_accounts_runtime_read/i,
    );
    expect(migration.match(/CREATE POLICY billing_accounts_(?:authenticated|runtime)_read/gi))
      .toHaveLength(2);
  });

  it("requires company, active unit and an explicit operational capability", () => {
    const policyBodies = migration.match(
      /CREATE POLICY billing_accounts_(?:authenticated|runtime)_read[\s\S]*?\n {2}\);/gi,
    );

    expect(policyBodies).toHaveLength(2);
    for (const policy of policyBodies ?? []) {
      expect(policy).toMatch(/company_id = public\.current_company_id\(\)/i);
      expect(policy).toMatch(/unit_id = public\.active_unit_id\(\)/i);
      expect(policy).toMatch(/public\.can_access\('recepcao', 'view'\)/i);
      expect(policy).toMatch(/public\.can_access\('faturamento', 'view'\)/i);
    }
  });

  it("fails migration replay when the final policies lose their scope", () => {
    expect(migration).toMatch(
      /RECEPTION_RLS_CONTRACT: billing account read policies are not unit and capability scoped/i,
    );
    expect(migration).toMatch(/v_policy_count <> 2/i);
  });
});

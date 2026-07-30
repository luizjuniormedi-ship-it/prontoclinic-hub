import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730214500_secure_patient_search.sql",
  "utf8",
);

describe("secure patient search migration", () => {
  it("keeps tenant and permission checks inside the secure contract", () => {
    expect(migration).toContain("active_company_id()");
    expect(migration).toContain("active_unit_id()");
    expect(migration).toContain("current_application_session_is_active()");
    expect(migration).toContain("org_can_access_unit");
    expect(migration).toContain("can_access('patients', 'view')");
    expect(migration).toContain("patient.company_id = v_company_id");
  });

  it("is bounded and unavailable to public and anon", () => {
    expect(migration).toContain("LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("FROM anon");
    expect(migration).toContain("TO authenticated");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731003000_reception_insurance_plan_canonicalization.sql",
  ),
  "utf8",
);

describe("Reception insurance plan canonicalization migration", () => {
  it("normalizes both legacy references and rejects non-numeric values", () => {
    expect(migration).toContain("'insurance_authorizations'");
    expect(migration).toContain("'insurance_eligibility_checks'");
    expect(migration).toMatch(/insurance_plan_id::TEXT !~ ''\^\[0-9\]\+\$''/);
    expect(migration).toContain(
      "ALTER COLUMN insurance_plan_id TYPE INTEGER",
    );
  });

  it("adds the canonical insurance plan foreign keys idempotently", () => {
    expect(migration).toContain(
      "constraint_record.confrelid = 'public.insurance_plans'::regclass",
    );
    expect(migration).toContain(
      "FOREIGN KEY (insurance_plan_id) REFERENCES public.insurance_plans(id)",
    );
    expect(migration).toContain(
      "20260731003000_reception_insurance_plan_canonicalization.sql",
    );
  });

  it("recreates the legacy compatibility views with restricted grants", () => {
    expect(migration).toContain(
      "DROP VIEW IF EXISTS public.reception_authorizations",
    );
    expect(migration).toContain(
      "CREATE VIEW public.reception_authorizations",
    );
    expect(migration).toContain("WITH (security_invoker = TRUE)");
    expect(migration).toContain(
      "REVOKE ALL ON public.reception_authorizations FROM PUBLIC, anon",
    );
  });
});

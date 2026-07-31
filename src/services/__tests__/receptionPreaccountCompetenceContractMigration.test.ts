import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731025500_reception_preaccount_competence_date_contract.sql",
  "utf8",
);

describe("reception preaccount competence contract migration", () => {
  it("writes competence_month as the canonical first-day DATE", () => {
    expect(migration).toMatch(
      /date_trunc\(''month'', CURRENT_DATE\)::DATE/i,
    );
    expect(migration).toMatch(
      /replace\([\s\S]*to_char\(CURRENT_DATE, ''YYYY-MM''\)[\s\S]*date_trunc/i,
    );
  });

  it("keeps the helper owned only by the reception RPC owner", () => {
    expect(migration).toMatch(
      /OWNER TO prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.m11_ensure_billing_preaccount[\s\S]*FROM PUBLIC, anon, authenticated, app_prontomedic/i,
    );
  });
});

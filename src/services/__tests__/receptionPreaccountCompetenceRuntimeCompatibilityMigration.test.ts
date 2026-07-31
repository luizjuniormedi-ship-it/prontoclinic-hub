import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731040000_reception_preaccount_competence_runtime_compatibility.sql",
  "utf8",
);

describe("reception preaccount competence runtime compatibility", () => {
  it("supports the legacy varchar and canonical date baselines", () => {
    expect(migration).toMatch(/v_competence_type = 'date'/i);
    expect(migration).toMatch(/v_competence_type = 'character varying'/i);
    expect(migration).toMatch(/date_trunc\(''month'', CURRENT_DATE\)::DATE/i);
    expect(migration).toMatch(/to_char\(CURRENT_DATE, ''YYYY-MM''\)/i);
  });

  it("keeps the helper private to the Reception RPC owner", () => {
    expect(migration).toMatch(/OWNER TO prontomedic_reception_rpc_owner/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.m11_ensure_billing_preaccount[\s\S]*FROM PUBLIC, anon, authenticated, app_prontomedic/i,
    );
  });

  it("fails closed for an unknown schema and records deployment", () => {
    expect(migration).toMatch(/Tipo de billing_accounts\.competence_month nao suportado/i);
    expect(migration).toContain(
      "20260731040000_reception_preaccount_competence_runtime_compatibility.sql",
    );
    expect(migration.trim()).toMatch(/COMMIT;$/i);
  });
});

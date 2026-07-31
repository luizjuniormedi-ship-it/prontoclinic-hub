import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731021000_units_active_company_read_contract.sql",
  ),
  "utf8",
);

describe("units active-company read contract migration", () => {
  it("grants authenticated reads without exposing units from other companies", () => {
    expect(migration).toMatch(
      /CREATE POLICY units_select[\s\S]*FOR SELECT[\s\S]*TO authenticated[\s\S]*USING \(company_id = private\.current_company_id\(\)\)/,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\.units TO authenticated/,
    );
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });
});

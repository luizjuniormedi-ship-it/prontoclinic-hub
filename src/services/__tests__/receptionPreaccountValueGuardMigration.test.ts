import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260730182000_reception_preaccount_value_guard.sql"),
  "utf8",
);

describe("reception pre-account value guard migration", () => {
  it("exige valor positivo ou gratuidade formal no workflow", () => {
    expect(migration).toMatch(/COALESCE\(NEW\.total_gross_amount, 0\) > 0/i);
    expect(migration).toMatch(/v_request->>'priority' IS DISTINCT FROM 'legal'/i);
    expect(migration).toMatch(/v_request->>'exception_reason'/i);
    expect(migration).toMatch(/ERRCODE = '23514'/i);
  });

  it("protege inserções e atualizações da pré-conta da recepção", () => {
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OF/i);
    expect(migration).toMatch(/ON public\.billing_accounts/i);
    expect(migration).toMatch(/NEW\.checkin_operation IS DISTINCT FROM 'billing_preaccount'/i);
  });
});

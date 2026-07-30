import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730150000_nursing_care_runtime_contract.sql",
  ),
  "utf8",
);

describe("nursing care migration ACL contract", () => {
  it("grants access only to nursing identity sequences", () => {
    expect(migration).not.toMatch(
      /GRANT\s+USAGE,\s*SELECT\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public/i,
    );

    for (const sequence of [
      "nursing_medication_administrations_id_seq",
      "nursing_incidents_id_seq",
      "nursing_procedures_id_seq",
      "nursing_shift_handoffs_id_seq",
    ]) {
      expect(migration).toContain(`SEQUENCE public.${sequence}`);
    }
  });
});

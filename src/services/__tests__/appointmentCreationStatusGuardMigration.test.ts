import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260730181000_appointment_creation_status_guard.sql"),
  "utf8",
);

describe("appointment creation status guard migration", () => {
  it("bloqueia inserções que tentam nascer fora de scheduled", () => {
    expect(migration).toMatch(/BEFORE INSERT ON public\.appointments/i);
    expect(migration).toMatch(/NEW\.status IS DISTINCT FROM 'scheduled'/i);
    expect(migration).toMatch(/ERRCODE = '23514'/i);
  });

  it("mantém a função do trigger sem execução pública direta", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.enforce_appointment_initial_status\(\) FROM PUBLIC/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.enforce_appointment_initial_status\(\) FROM authenticated/i,
    );
  });
});

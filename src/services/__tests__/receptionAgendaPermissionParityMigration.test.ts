import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731020000_reception_agenda_permission_parity.sql",
  ),
  "utf8",
);

describe("Reception agenda permission parity migration", () => {
  it("materializa o modulo agenda para os perfis operacionais", () => {
    expect(migration).toContain("'agenda'");
    expect(migration).toContain("'recepcao'");
    expect(migration).toContain("'supervisor_recepcao'");
    expect(migration).toContain("'callcenter'");
  });

  it("mantem recepcao sem edicao ampla e sem exclusao", () => {
    expect(migration).toContain(
      "role_record.name IN ('supervisor_recepcao', 'callcenter')",
    );
    expect(migration).toContain("role_permission.can_delete IS DISTINCT FROM FALSE");
  });

  it("registra a migration no ledger de deploy", () => {
    expect(migration).toContain(
      "20260731020000_reception_agenda_permission_parity.sql",
    );
  });
});

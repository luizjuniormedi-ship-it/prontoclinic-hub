import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731020500_reception_operational_permission_parity.sql",
  ),
  "utf8",
);

describe("reception operational permission parity migration", () => {
  it("provisions both UI and gateway aliases", () => {
    for (const module of [
      "patients",
      "pacientes",
      "schedule",
      "agenda",
      "reception",
      "recepcao",
      "callcenter",
      "insurance_companies",
      "insurance_plans",
      "faturamento",
    ]) {
      expect(migration).toContain(`'${module}'`);
    }
  });

  it("keeps common reception unable to edit the agenda", () => {
    expect(migration).toContain(
      "('recepcao', 'agenda', TRUE, TRUE, FALSE)",
    );
    expect(migration).toContain(
      "('supervisor_recepcao', 'agenda', TRUE, TRUE, TRUE)",
    );
    expect(migration).toContain(
      "('recepcao', 'faturamento', TRUE, TRUE, FALSE)",
    );
    expect(migration).toContain(
      "('callcenter', 'recepcao', TRUE, TRUE, TRUE)",
    );
    expect(migration).toContain(
      "('callcenter', 'patients', TRUE, TRUE, FALSE)",
    );
  });

  it("is idempotent and fail-fast", () => {
    expect(migration).toContain(
      "ON CONFLICT (company_id, role_id, module) DO UPDATE",
    );
    expect(migration).toContain(
      "Paridade operacional de permissoes da Recepcao nao foi estabelecida",
    );
    expect(migration).toContain(
      "20260731020500_reception_operational_permission_parity.sql",
    );
  });

  it("provides an explicit bootstrap routine for company provisioning", () => {
    expect(migration).toContain(
      "private.seed_reception_operational_permissions_for_company",
    );
    expect(migration).toContain("DO $seed_existing_companies$");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET row_security = off");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).not.toContain("AFTER INSERT ON public.companies");
  });
});

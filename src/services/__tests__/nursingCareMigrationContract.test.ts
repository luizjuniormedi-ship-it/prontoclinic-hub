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
const runtimeClosure = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260829012947_canonical_runtime_rpc_contracts.sql",
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
      expect(migration).toMatch(
        new RegExp(`ON\\s+SEQUENCE\\s+public\\.${sequence}`, "i"),
      );
    }
  });

  it("revoga update direto e publica comandos atomicos de medicacao", () => {
    expect(runtimeClosure).toMatch(
      /REVOKE\s+UPDATE\s+ON\s+public\.nursing_medication_administrations/i,
    );
    expect(runtimeClosure).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.nursing_administer_medication_secure/i,
    );
    expect(runtimeClosure).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.nursing_refuse_medication_secure/i,
    );
  });

  it("fecha a checagem beira-leito por empresa, unidade, permissao e janela", () => {
    expect(runtimeClosure).toMatch(
      /nursing_bedside_check_secure[\s\S]*active_company_id\(\)[\s\S]*active_unit_id\(\)/i,
    );
    expect(runtimeClosure).toMatch(
      /nursing_bedside_check_secure[\s\S]*can_access\('prontuario',\s*'edit'\)/i,
    );
    expect(runtimeClosure).toMatch(
      /medication\.company_id\s*=\s*v_company[\s\S]*medication\.unit_id\s*=\s*v_unit/i,
    );
    expect(runtimeClosure).toMatch(
      /scheduled_at\s+IS\s+NOT\s+NULL[\s\S]*BETWEEN\s+NOW\(\)\s*-\s*INTERVAL\s+'2 hours'/i,
    );
  });

  it("exige capacidade de escrita e valida referencias no conflito da agenda", () => {
    expect(runtimeClosure).toMatch(
      /m9_check_patient_appointment_conflicts_secure[\s\S]*can_access\('agenda',\s*'create'\)[\s\S]*can_access\('agenda',\s*'edit'\)/i,
    );
    for (const relation of ["patients", "units", "professionals", "appointments"]) {
      expect(runtimeClosure).toMatch(
        new RegExp(`FROM\\s+public\\.${relation}`, "i"),
      );
    }
  });
});

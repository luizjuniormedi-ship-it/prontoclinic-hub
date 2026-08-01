import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731022000_reception_workflow_appointment_lock_contract.sql",
  "utf8",
);

describe("reception workflow appointment lock contract migration", () => {
  it("keeps the appointment-scoped advisory lock without taking a row update lock", () => {
    expect(migration).toMatch(
      /pg_advisory_xact_lock\([\s\S]*reception_checkin:[\s\S]*p_appointment_id/i,
    );
    expect(migration).toMatch(
      /FROM public\.appointments appointment[\s\S]*appointment\.id = p_appointment_id[\s\S]*appointment\.company_id = v_company[\s\S]*appointment\.unit_id = v_unit;/i,
    );
    expect(migration).not.toMatch(
      /FROM public\.appointments appointment[\s\S]*FOR UPDATE[\s\S]*IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado no tenant'/i,
    );
  });

  it("does not widen the workflow owner to appointment updates", () => {
    expect(migration).not.toMatch(
      /GRANT\s+UPDATE[\s\S]*public\.appointments[\s\S]*prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toMatch(
      /OWNER TO prontomedic_reception_rpc_owner/i,
    );
  });
});

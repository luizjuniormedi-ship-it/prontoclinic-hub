import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730235000_reception_workflow_cross_session_resume.sql",
  ),
  "utf8",
);

describe("reception workflow cross-session resume migration", () => {
  it("resumes the appointment aggregate only when the request is identical", () => {
    expect(migration).toContain("v_company := public.current_company_id();");
    expect(migration).not.toContain("request.jwt.claim.company_id");
    expect(migration).toContain("v_unit := public.active_unit_id();");
    expect(migration).toMatch(
      /pg_advisory_xact_lock[\s\S]*set_config\([\s\S]*app\.reception\.appointment_id[\s\S]*SELECT \* INTO v_appointment/,
    );
    expect(migration).toMatch(
      /workflow\.appointment_id = p_appointment_id[\s\S]*FOR UPDATE/,
    );
    expect(migration).toMatch(
      /v_workflow\.request_hash <> v_hash[\s\S]*v_workflow\.request_payload IS DISTINCT FROM p_request_payload/,
    );
    expect(migration).toContain(
      "Agendamento possui workflow com payload diferente",
    );
  });

  it("keeps the private entrypoint restricted to the Reception owner", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.m11_start_workflow\(BIGINT, TEXT, JSONB\)[\s\S]*FROM PUBLIC, anon, authenticated, app_prontomedic/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION private\.m11_start_workflow\(BIGINT, TEXT, JSONB\)[\s\S]*TO prontomedic_reception_rpc_owner/,
    );
  });
});

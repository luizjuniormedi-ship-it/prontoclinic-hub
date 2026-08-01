import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260729223000_module39_financial_transaction_commands.sql",
  ),
  "utf8",
);

const authFoundationMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716203000_auth_foundation.sql",
  ),
  "utf8",
);

describe("Module 39 financial command boundary", () => {
  it("forces RLS and removes browser write grants from billings", () => {
    expect(migration).toMatch(/ALTER TABLE public\.billings FORCE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.billings[\s\S]*authenticated, app_prontomedic/i,
    );
  });

  it("rejects privileged or inherited RPC owner state", () => {
    expect(migration).toMatch(/NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER/i);
    expect(migration).toMatch(/pg_auth_members[\s\S]*must not have role memberships/i);
  });

  it("keeps manual billings in the canonical billing account aggregate", () => {
    expect(migration).toMatch(
      /INSERT INTO public\.billing_accounts[\s\S]*RETURNING id INTO v_account_id/i,
    );
    expect(migration).toMatch(
      /INSERT INTO public\.billings[\s\S]*billing_account_id[\s\S]*v_account_id/i,
    );
  });

  it("preserves idempotency integrity and serializes retries", () => {
    expect(migration).toMatch(/billings_command_key_chk[\s\S]*command_request_hash/i);
    expect(migration).toMatch(/pg_advisory_xact_lock/i);
    expect(migration).toMatch(/command_request_hash IS DISTINCT FROM v_hash/i);
  });

  it("finalizes attendance and billing inside one database call", () => {
    expect(migration).toMatch(
      /finalize_attendance_with_billing_secure[\s\S]*finalize_attendance_secure[\s\S]*sync_completed_appointment_billing_secure/i,
    );
    expect(migration).toMatch(/trg_audit_financial_transactions/i);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.m18_can_edit_attendance\(\)[\s\S]*TO prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toMatch(
      /GRANT UPDATE ON TABLE public\.appointments[\s\S]*TO prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toMatch(
      /CREATE POLICY appointments_reception_billing_lock[\s\S]*FOR ALL TO prontomedic_reception_rpc_owner[\s\S]*app\.reception\.appointment_id[\s\S]*app\.reception\.company_id[\s\S]*app\.reception\.unit_id/i,
    );
    expect(migration).not.toMatch(
      /CREATE POLICY appointments_reception_billing_lock[\s\S]*USING \(TRUE\)/i,
    );
    expect(migration).toMatch(
      /finalize_attendance_with_billing_secure[\s\S]*set_config\(\s*'app\.reception\.appointment_id'[\s\S]*set_config\(\s*'app\.reception\.company_id'[\s\S]*set_config\(\s*'app\.reception\.unit_id'[\s\S]*sync_completed_appointment_billing_secure/i,
    );
    const receptionBilling = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260725103000_reception_billing_continuity.sql",
      ),
      "utf8",
    );
    expect(receptionBilling).toMatch(
      /appointment\.id = p_appointment_id[\s\S]*appointment\.company_id = v_company/i,
    );
    expect(receptionBilling).toMatch(
      /v_company IS NULL OR NOT public\.m18_can_edit_attendance\(\)/i,
    );
    expect(migration).toMatch(
      /finalize_attendance_with_billing_secure[\s\S]*finalize_attendance_secure[\s\S]*sync_completed_appointment_billing_secure/i,
    );
  });

  it("keeps the hardened profile policy compatible with auth replay", () => {
    expect(migration).toMatch(
      /CREATE POLICY user_profiles_financial_rpc_select[\s\S]*TO prontomedic_financial_rpc_owner/i,
    );
    expect(authFoundationMigration).toMatch(
      /policyname NOT IN \([\s\S]*'user_profiles_financial_rpc_select'[\s\S]*\)/i,
    );
  });
});

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
  });
});

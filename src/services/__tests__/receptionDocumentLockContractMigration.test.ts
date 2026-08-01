import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731024000_reception_document_lock_contract.sql",
  "utf8",
);

describe("reception document lock contract migration", () => {
  it("keeps document resolution behind the secure RPC without locking appointments", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.resolve_reception_document_issue_secure",
    );
    expect(migration).toContain("UPDATE public.patient_documents");
    expect(migration).not.toMatch(
      /FROM public\.appointments\s+WHERE id = p_appointment_id\s+FOR UPDATE/i,
    );
    expect(migration).toMatch(
      /FROM public\.patient_documents[\s\S]*?FOR UPDATE/i,
    );
    expect(migration).toContain("RETURNS JSONB");
    expect(migration).toMatch(
      /GRANT SELECT, UPDATE ON TABLE public\.patient_documents\s+TO prontomedic_reception_rpc_owner/i,
    );
    expect(migration).toContain(
      "CREATE POLICY patient_documents_reception_rpc_update",
    );
    expect(migration).toMatch(
      /WITH CHECK \(company_id = public\.current_company_id\(\)\)/i,
    );
  });
});

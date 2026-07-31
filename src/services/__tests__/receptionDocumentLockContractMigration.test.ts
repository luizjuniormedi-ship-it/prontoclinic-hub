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
      /FROM public\.appointments[\s\S]*?FOR UPDATE/,
    );
  });
});

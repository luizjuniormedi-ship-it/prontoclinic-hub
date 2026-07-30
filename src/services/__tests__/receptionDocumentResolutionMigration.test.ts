import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730234000_reception_document_resolution_idempotency.sql",
  ),
  "utf8",
);

describe("reception document resolution migration", () => {
  it("serializa o documento e retorna a repetição sem novo histórico", () => {
    expect(migration).toMatch(
      /FROM public\.patient_documents[\s\S]*FOR UPDATE/,
    );
    expect(migration).toMatch(
      /IF v_document\.status = 'active'[\s\S]*'idempotent', TRUE[\s\S]*RETURN/,
    );
    expect(migration.indexOf("'idempotent', TRUE")).toBeLessThan(
      migration.indexOf("INSERT INTO public.reception_admin_history"),
    );
  });

  it("fixa o owner operacional e registra a migration no ledger", () => {
    expect(migration).toMatch(
      /ALTER FUNCTION public\.resolve_reception_document_issue_secure\([\s\S]*OWNER TO prontomedic_reception_rpc_owner/,
    );
    expect(migration).toContain(
      "20260730234000_reception_document_resolution_idempotency.sql",
    );
    expect(migration).toMatch(
      /INSERT INTO public\.prontomedic_deployment_migrations\(filename\)/,
    );
  });
});

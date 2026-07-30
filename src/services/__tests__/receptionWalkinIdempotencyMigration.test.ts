import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260730230000_reception_walkin_idempotent_workflow.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("reception walk-in idempotency migration", () => {
  it("serializa a operação por empresa e chave antes de criar o appointment", () => {
    expect(migration).toContain("private.reception_walkin_operations");
    expect(migration).toMatch(
      /UNIQUE \(company_id, idempotency_key\)/,
    );
    expect(migration).toMatch(
      /pg_advisory_xact_lock\([\s\S]*company_id::TEXT \|\| ':walkin:' \|\| p_idempotency_key/,
    );
    expect(migration.indexOf("INSERT INTO private.reception_walkin_operations"))
      .toBeLessThan(
        migration.indexOf(
          "v_appointment := private.reception_insert_walkin_appointment",
        ),
      );
  });

  it("retoma somente o mesmo payload e o mesmo appointment", () => {
    expect(migration).toContain(
      "Mesma chave de idempotencia com dados de atendimento diferentes",
    );
    expect(migration).toMatch(
      /operation\.appointment_id[\s\S]*appointment\.is_walkin IS TRUE/,
    );
    expect(migration).toContain("'idempotent', TRUE");
  });

  it("entrega o appointment ao workflow canônico sem criar fluxo paralelo", () => {
    expect(migration).toContain("public.reception_checkin_workflows");
    expect(migration).toContain("'workflow_required'");
    expect(migration).toContain("'workflow_handoff', 'reception_checkin'");
    expect(migration).not.toMatch(/INSERT INTO public\.reception_checkins/);
    expect(migration).not.toMatch(/INSERT INTO public\.billing_accounts/);
  });

  it("mantém a assinatura legada e restringe a assinatura idempotente", () => {
    expect(migration).toMatch(
      /CREATE FUNCTION public\.create_reception_walkin_secure\([\s\S]*p_idempotency_key TEXT/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_reception_walkin_secure\([\s\S]*p_notes TEXT DEFAULT NULL[\s\S]*RETURNS BIGINT/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_reception_walkin_secure\([\s\S]*TEXT, TEXT[\s\S]*FROM PUBLIC, anon/,
    );
  });
});

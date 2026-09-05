import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260902022540_nursing_rpc_owner_rls_closure.sql",
  ),
  "utf8",
);

describe("nursing RPC owner RLS closure", () => {
  it("uses an exclusive owner without RLS bypass", () => {
    expect(migration).toContain("prontomedic_nursing_rpc_owner");
    expect(migration).toMatch(/NOLOGIN NOINHERIT NOBYPASSRLS/);
    expect(migration).toMatch(
      /nursing_administer_medication_secure\(BIGINT, BIGINT\)[\s\S]*OWNER TO prontomedic_nursing_rpc_owner/,
    );
    expect(migration).toMatch(
      /nursing_refuse_medication_secure\(BIGINT, TEXT\)[\s\S]*OWNER TO prontomedic_nursing_rpc_owner/,
    );
  });

  it("scopes owner writes to company, unit and clinical permission", () => {
    expect(migration).toContain("CREATE POLICY nursing_rpc_owner_update");
    expect(migration).toMatch(/company_id = public\.active_company_id\(\)/);
    expect(migration).toMatch(/unit_id = public\.active_unit_id\(\)/);
    expect(migration).toContain("public.can_access('prontuario', 'edit')");
  });

  it("requires clinical read permission for prescription safety", () => {
    expect(migration).toContain("public.can_access('prontuario', 'view')");
    expect(migration).toContain("ERRCODE = '42501'");
  });
});

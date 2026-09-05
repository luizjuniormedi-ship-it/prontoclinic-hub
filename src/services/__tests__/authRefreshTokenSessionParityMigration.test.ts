import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260829014500_auth_native_session_contract.sql",
  ),
  "utf8",
);

describe("auth refresh token session parity migration", () => {
  it("valida session_id nativo sem alterar tabela protegida", () => {
    expect(migration).toContain("column_name = 'session_id'");
    expect(migration).toContain("data_type = 'uuid'");
    expect(migration).not.toContain("ALTER TABLE auth.refresh_tokens");
    expect(migration).toContain("to_regclass('auth.sessions')");
  });

  it("falha explicitamente quando o contrato nativo nao existe", () => {
    expect(migration).toContain(
      "auth.refresh_tokens.session_id UUID is required",
    );
    expect(migration).toContain("must reference auth.sessions(id)");
  });
});

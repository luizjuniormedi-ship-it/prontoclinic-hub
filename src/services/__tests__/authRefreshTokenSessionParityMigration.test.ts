import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731013000_auth_refresh_token_session_parity.sql",
  ),
  "utf8",
);

describe("auth refresh token session parity migration", () => {
  it("adiciona session_jti de forma idempotente", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS session_jti UUID",
    );
  });

  it("indexa somente refresh tokens ativos por usuario e sessao", () => {
    expect(migration).toContain(
      "ON auth.refresh_tokens(user_id, session_jti)",
    );
    expect(migration).toContain("WHERE revoked = FALSE");
  });
});

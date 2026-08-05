import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("contrato HTTP da Edge Function auth-admin", () => {
  const source = readFileSync(resolve("supabase/functions/auth-admin/index.ts"), "utf8");

  it("rejeita active ausente ou inválido antes da transição administrativa", () => {
    const validation = source.indexOf('typeof body.active !== "boolean"');
    const transition = source.indexOf('rpc("prepare_user_access_active"');
    expect(validation).toBeGreaterThan(-1);
    expect(transition).toBeGreaterThan(validation);
    expect(source).toContain('return respond({ error: "Estado ativo inválido." }, 400)');
  });
});

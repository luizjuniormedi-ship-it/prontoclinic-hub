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

  it("vincula a transição ao administrador AAL2 e bloqueia autossuspensão", () => {
    expect(source).toContain("!active && userId === userData.user.id");
    expect(source).toContain("p_actor_user_id: userData.user.id");
    expect(source).not.toContain("p_actor_user_id: body.");
  });

  it("persiste auditoria e revoga sessões internas no mesmo contrato", () => {
    expect(source).toContain('rpc("admin_record_auth_operation"');
    expect(source).toContain('active ? "none" : "company"');
    expect(source).toContain('"logout_global", "global"');
    expect(source).toContain("crypto.randomUUID()");
  });
});

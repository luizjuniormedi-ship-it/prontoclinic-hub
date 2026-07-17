import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "local-auth-server.mjs"), "utf8");

describe("local auth server security invariants", () => {
  it("falha fechado fora de desenvolvimento e testes", () => {
    expect(source).toContain("const LOCAL_AUTH_MODE = process.env.LOCAL_AUTH_MODE");
    expect(source).toContain("if (!['development', 'test'].includes(LOCAL_AUTH_MODE))");
    expect(source).toContain("use GoTrue/Supabase Auth em producao");
  });

  it("nega RPC que nao esteja na allowlist", () => {
    expect(source).not.toContain("if (!required) return { ok: true }");
    expect(source).toContain("if (!required) return { ok: false");
  });

  it("delega o escopo de empresa e unidade ao RLS em todas as consultas REST", () => {
    expect(source).not.toContain("requiredCompanyScope(profile, table)");
    expect(source).toContain("SET LOCAL ROLE authenticated");
    expect(source).toContain("queryAsAuthenticated(payload, query, values)");
    expect(source).toContain("`INSERT INTO public.\"${table}\"");
    expect(source).toContain("`UPDATE public.\"${table}\"");
  });

  it("revoga refresh token antigo durante a rotacao", () => {
    expect(source).toContain("UPDATE auth.refresh_tokens");
    expect(source).toContain("SET revoked = true");
    expect(source).toContain("RETURNING user_id");
    expect(source).toContain("INSERT INTO auth.refresh_tokens (token, user_id, parent, session_id)");
  });

  it("limita o corpo HTTP e revoga sessoes no logout", () => {
    expect(source).toContain("function parseBody(req, maxBytes = 1024 * 1024)");
    expect(source).toContain("request body excede o limite de 1 MB");
    expect(source).toContain("WHERE user_id = $1 AND revoked = false");
  });

  it("restringe origem, compara JWT em tempo constante e limita tentativas", () => {
    expect(source).toContain("timingSafeEqual(actualBuffer, expectedBuffer)");
    expect(source).toContain("CORS_ALLOWED_ORIGINS");
    expect(source).not.toContain("Access-Control-Allow-Origin', '*'");
    expect(source).toContain("LOGIN_MAX_ATTEMPTS");
    expect(source).toContain("Too many login attempts");
  });

  it("autoriza o cabecalho global enviado pelo cliente Supabase", () => {
    expect(source).toContain("Access-Control-Allow-Headers");
    expect(source).toContain("x-application-name");
  });

  it("executa consultas REST sob o papel authenticated para exercer RLS real", () => {
    expect(source).toContain("SET LOCAL ROLE authenticated");
    expect(source).toContain("queryAsAuthenticated(payload, query, values)");
  });

  it("nao concede bypass total a cargos administrativos secundarios", () => {
    expect(source).toContain("if (role === 'admin') return { ok: true };");
    expect(source).not.toContain("role === 'admin' || role === 'adm_medicos'");
    expect(source).not.toContain("role === 'admin' || role === 'diretoria'");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "local-auth-server.mjs"), "utf8");

function loadTableToModule() {
  const start = source.indexOf("const REFERENCE_TABLES");
  const end = source.indexOf("const METHOD_TO_ACTION");
  const tableMappingSource = source.slice(start, end);

  return new Function(`${tableMappingSource}; return tableToModule;`)() as (
    table: string,
    method?: string,
  ) => string | null;
}

describe("local auth server security invariants", () => {
  it("nega RPC que nao esteja na allowlist", () => {
    expect(source).not.toContain("if (!required) return { ok: true }");
    expect(source).toContain("if (!required) return { ok: false");
  });

  it("aplica company_id derivado do perfil em leitura, insercao e alteracao", () => {
    expect(source).toContain("requiredCompanyScope(profile, table)");
    expect(source).toContain('conditions.push(`"company_id" = $${paramIdx}`)');
    expect(source).toContain("body.company_id = companyId");
    expect(source).toContain("AND company_id = $${keys.length + 2}");
  });

  it("revoga refresh token antigo durante a rotacao", () => {
    expect(source).toContain("UPDATE auth.refresh_tokens");
    expect(source).toContain("SET revoked = true");
    expect(source).toContain("RETURNING user_id");
    expect(source).toContain("INSERT INTO auth.refresh_tokens (token, user_id, parent)");
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

  it("nao concede bypass total a cargos administrativos secundarios", () => {
    expect(source).toContain("if (role === 'admin') return { ok: true };");
    expect(source).not.toContain("role === 'admin' || role === 'adm_medicos'");
    expect(source).not.toContain("role === 'admin' || role === 'diretoria'");
  });

  it("autoriza leitura dos catalogos operacionais pela agenda", () => {
    const tableToModule = loadTableToModule();

    for (const table of [
      "professionals",
      "specialties",
      "appointment_types",
      "services_catalog",
    ]) {
      expect(tableToModule(table, "GET")).toBe("agenda");
      expect(tableToModule(table, "HEAD")).toBe("agenda");
    }
  });

  it("exige semantica administrativa para alterar catalogos da agenda", () => {
    const tableToModule = loadTableToModule();

    for (const table of [
      "professionals",
      "specialties",
      "appointment_types",
      "services_catalog",
    ]) {
      expect(tableToModule(table, "POST")).toBe("admin");
      expect(tableToModule(table, "PATCH")).toBe("admin");
      expect(tableToModule(table, "DELETE")).toBe("admin");
    }
  });

  it("mantem tabelas desconhecidas negadas por padrao", () => {
    const tableToModule = loadTableToModule();

    expect(tableToModule("unmapped_catalog", "GET")).toBe("__unmapped__");
    expect(source).toContain("const module = tableToModule(table, method);");
  });

  it("autoriza os read models financeiros somente por permissao explicita", () => {
    expect(source).toContain(
      "list_billing_production_secure: { module: 'faturamento', action: 'can_view' }",
    );
    expect(source).toContain(
      "list_tiss_read_model_secure: { module: 'faturamento', action: 'can_view' }",
    );
    expect(source).toContain(
      "list_tiss_glosas_read_secure: { module: 'faturamento', action: 'can_view' }",
    );
    expect(source).toContain(
      "list_tiss_protocols_read_secure: { module: 'faturamento', action: 'can_view' }",
    );
    expect(source).toContain(
      "list_billing_financial_summary_secure: { module: 'financeiro', action: 'can_view' }",
    );
    expect(source).toContain("const permissions = await loadRolePerms(role)");
    expect(source).toContain("if (!rule?.[required.action])");
    expect(source).toContain("const CENTRAL_PERMISSION_RPCS = new Set([");
    expect(source).toContain(
      "role === 'admin' && !CENTRAL_PERMISSION_RPCS.has(functionName)",
    );
  });

  it("nao expoe mensagens PostgreSQL nas respostas HTTP", () => {
    expect(source).toContain("function databaseError(res, scope, context, error");
    expect(source).toContain("message: 'Database request failed'");
    expect(source).toContain("console.error(`[${scope}]`, context, error)");
    expect(source).not.toContain("{ error: e.message");
    expect(source).toContain("message: 'Internal server error'");
  });

  it("executa REST e RPC sob claims e papel PostgreSQL autenticado", () => {
    expect(source).toContain("async function withAuthenticatedDbSession(payload, operation)");
    expect(source).toContain("set_config('request.jwt.claim.sub', $1, true)");
    expect(source).toContain("set_config('request.jwt.claims', $2, true)");
    expect(source).toContain("set_config('request.jwt.claim.role', 'authenticated', true)");
    expect(source).toContain("SET LOCAL ROLE authenticated");
    expect(source).toContain("withAuthenticatedDbSession(hPayload");
    expect(source).toContain("withAuthenticatedDbSession(payload");
  });

  it("bloqueia DML direto nas tabelas clinicas de enfermagem", () => {
    expect(source).toContain("const RPC_ONLY_TABLES = new Set([");
    for (const table of [
      "nursing_medication_administrations",
      "nursing_incidents",
      "nursing_procedures",
      "nursing_shift_handoffs",
      "triagens",
      "news2_avaliacoes",
      "triagem_fila",
    ]) {
      expect(source).toContain(`'${table}'`);
    }
    expect(source).toContain("if (RPC_ONLY_TABLES.has(table))");
    expect(source).toContain("Mutacao permitida somente por RPC segura");
    for (const rpc of [
      "enqueue_nursing_triage_secure",
      "call_nursing_triage_secure",
      "complete_nursing_triage_secure",
    ]) {
      expect(source).toContain(`${rpc}: { module: 'enfermagem'`);
    }
    expect(source).not.toContain("const result = await pool.query(\n            `INSERT INTO public");
    expect(source).not.toContain("const result = await pool.query(\n            `UPDATE public");
  });

  it("mantem dados e count no mesmo cliente e nao mascara falha HEAD", () => {
    expect(source).toContain("const countResult = await client.query(countQuery, values)");
    expect(source).not.toContain("res.writeHead(200, { 'content-range': '0-0/0' })");
    expect(source).toContain("[REST_HEAD_ERROR]");
  });
});


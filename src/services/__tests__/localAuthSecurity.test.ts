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
    expect(source).toContain("queryAsAuthenticated(payload, query, values, profile)");
    expect(source).toContain("set_config('app.current_company_id'");
    expect(source).toContain("set_config('app.current_unit_id'");
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
    expect(source).toContain("queryAsAuthenticated(payload, query, values, profile)");
  });

  it("autoriza pelo contexto ativo da sessao e isola o cache por empresa e papel", () => {
    expect(source).toContain("async function getAuthorizationContext(payload)");
    expect(source).toContain("ctx.session_id = $2::uuid");
    expect(source).toContain("public.active_company_id() AS company_id");
    expect(source).toContain("public.active_company_id() IS NOT NULL");
    expect(source).not.toContain("public.current_application_session_is_active()");
    expect(source).not.toContain("JOIN public.application_sessions app_session");
    expect(source).not.toContain("JOIN public.application_devices device");
    expect(source).toContain("const cacheKey = `${profile.company_id}:${profile.role_id}`");
    expect(source).toContain("WHERE rp.company_id = $1");
    expect(source).toContain("AND rp.role_id = $2");
    expect(source).not.toContain("async function loadRolePerms(role)");
  });

  it("limita o bootstrap às RPCs de contexto e exige contexto ativo no self-service", () => {
    expect(source).toContain("list_authorized_access_contexts: { scope: 'bootstrap' }");
    expect(source).toContain("activate_application_context: { scope: 'bootstrap' }");
    expect(source).toContain("update_my_appointment_status_secure: { scope: 'self' }");
    expect(source).toContain("required?.scope === 'bootstrap'");
    expect(source).not.toContain("required?.scope === 'self'\n        ? await getUserProfile");
  });

  it("preserva catalogos seguros sem expor a matriz bruta de autorizacao", () => {
    expect(source).toMatch(/REFERENCE_TABLES[\s\S]*'professionals'/);
    expect(source).toMatch(/REFERENCE_TABLES[\s\S]*'roles'/);
    const referenceBlock = source.match(/const REFERENCE_TABLES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    expect(referenceBlock).not.toContain("'role_permissions'");
    expect(source).toContain("if (REFERENCE_TABLES.has(t)) return null");
    expect(source.indexOf("if (REFERENCE_TABLES.has(t)) return null"))
      .toBeLessThan(source.indexOf("for (const [re, mod] of map)"));
  });

  it("permite ao call center atualizar a fila sem conceder edicao ampla da agenda", () => {
    expect(source).toContain(
      "refresh_confirmation_queue_secure: { module: 'agenda', action: 'can_create' }",
    );
    expect(source).not.toContain(
      "refresh_confirmation_queue_secure: { module: 'agenda', action: 'can_edit' }",
    );
    expect(source).toContain(
      "record_confirmation_attempt_secure: { module: 'agenda', action: 'can_create' }",
    );
  });

  it("mapeia filas do call center para agenda e contratos de BI para bi", () => {
    expect(source).toContain(
      "[/^scheduling_contact_logs|^scheduling_call_center_tasks|^scheduling_confirmation_/, 'agenda']",
    );
    expect(source).toContain(
      "[/^v_ocupacao_profissional$|^v_faturamento_convenio$/, 'bi']",
    );
  });

  it("autoriza apenas as projecoes laboratoriais e traduz RLS negado para 403", () => {
    expect(source).toContain(
      "get_lab_order_summaries: { module: 'laboratorio', action: 'can_view' }",
    );
    expect(source).toContain(
      "get_lab_critical_alerts: { module: 'laboratorio', action: 'can_view' }",
    );
    expect(source).toContain("return error?.code === '42501' ? 403 : 400");
  });

  it("autoriza a manutencao administrativa de permissoes e invalida o cache", () => {
    expect(source).toContain("upsert_role_permission: { module: 'admin', action: 'can_edit' }");
    expect(source).toContain("if (fnName === 'upsert_role_permission') permCache.clear()");
  });

  it("nao concede bypass total a cargos administrativos secundarios", () => {
    expect(source).toContain("if (role === 'admin') return { ok: true };");
    expect(source).not.toContain("role === 'admin' || role === 'adm_medicos'");
    expect(source).not.toContain("role === 'admin' || role === 'diretoria'");
  });
});

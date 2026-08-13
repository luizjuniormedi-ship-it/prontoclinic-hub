import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "local-auth-server.mjs"), "utf8");

describe("local auth server security invariants", () => {
  it("exige modo explícito e endurece o gateway em produção", () => {
    expect(source).toContain("const LOCAL_AUTH_MODE = process.env.LOCAL_AUTH_MODE");
    expect(source).toContain("['development', 'test', 'production']");
    expect(source).toContain("if (LOCAL_AUTH_MODE === 'production')");
    expect(source).toContain(
      "CORS_ALLOWED_ORIGINS de producao deve conter somente origens publicas explicitas",
    );
    expect(source).toContain("PGPASSWORD obrigatorio em producao");
  });

  it("mantem health check dependente do PostgreSQL", () => {
    expect(source).toContain("req.method === 'GET' && path === '/health'");
    expect(source).toContain("await pool.query('SELECT 1')");
    expect(source).toContain("{ status: 'ok', database: 'reachable' }");
    expect(source).toContain(
      "{ status: 'error', database: 'unreachable' }, 503",
    );
  });

  it("nega RPC que nao esteja na allowlist", () => {
    expect(source).not.toContain("if (!required) return { ok: true }");
    expect(source).toContain("if (!required) return { ok: false");
  });

  it("autoriza somente os contratos operacionais publicados de recepcao, TISS e portal", () => {
    const requiredRpcContracts = [
      "get_reception_precheckin_context",
      "get_reception_patient_appointments_secure",
      "get_reception_exception_capability",
      "transition_reception_queue_ticket_secure",
      "create_insurance_authorization_secure",
      "transition_insurance_authorization_secure",
      "create_insurance_eligibility_check_secure",
      "update_insurance_eligibility_check_secure",
      "record_reception_term_acceptance_secure",
      "create_reception_document_pickup_secure",
      "release_reception_document_pickup_secure",
      "resolve_reception_document_issue_secure",
      "create_reception_walkin_secure",
      "search_patients_secure",
      "start_reception_checkin_workflow_secure",
      "advance_reception_checkin_workflow_secure",
      "ensure_billing_preaccount_for_checkin_secure",
      "ensure_tiss_guide_for_checkin_secure",
      "ensure_reception_worklist_for_checkin_secure",
      "ensure_financial_receivable_for_checkin_secure",
      "m19_prepare_triage_handoff_secure",
      "m19_complete_triage_secure",
      "m19_reclassify_triage_secure",
      "finalize_attendance_with_billing_secure",
      "m18_finalize_appointment_with_billing_secure",
      "tiss_get_stats",
      "m16_list_xml_secure",
      "m16_get_xml_document_secure",
      "m16_list_denials_secure",
      "m16_list_protocols_secure",
      "m16_list_guides_secure",
      "m16_generate_monthly_batch_secure",
      "m16_persist_xml_secure",
      "m16_process_return_secure",
      "m16_record_manual_denial_secure",
      "m16_save_protocol_secure",
      "m39_list_billing_accounts_secure",
      "m39_review_billing_account_secure",
      "m39_reopen_billing_account_secure",
      "m39_list_billing_competences_secure",
      "m39_close_billing_competence_secure",
      "m39_reopen_billing_competence_secure",
      "m37_list_billing_audit_queue_secure",
      "m37_claim_billing_audit_secure",
      "m37_decide_billing_audit_secure",
      "patient_portal_list_appointments_secure",
      "patient_portal_confirm_appointment_secure",
      "patient_portal_cancel_appointment_secure",
      "patient_portal_reschedule_appointment_secure",
      "current_company_id",
      "save_secure_clinical_draft",
      "get_secure_clinical_draft",
      "list_secure_clinical_drafts",
      "delete_secure_clinical_draft",
      "list_application_devices",
      "revoke_application_device",
      "log_data_access",
      "request_anonymize_patient",
      "criar_sala_telemedicina",
      "detectar_alertas_bi",
      "gerar_senha_triagem",
      "upsert_role_permission",
      "registrar_movimentacao_estoque",
      "calcular_valor_estoque",
      "dispensar_estoque_atomic",
    ];

    for (const rpc of requiredRpcContracts) {
      expect(source).toMatch(new RegExp(`\\n\\s*${rpc}:`));
    }
  });

  it("nao expoe pelo backend de navegador o gateway de transmissao TISS", () => {
    expect(source).not.toMatch(
      /\n\s*m16_record_transmission_result_gateway:/,
    );
  });

  it("mantem RPCs inseguros ou inexistentes fora do catalogo", () => {
    const blockedRpcContracts = [
      "anonymize_patient",
      "bedside_check",
      "billing_check_pending",
      "calc_imc",
      "calcular_kpis_diarios",
      "cancel_pre_cadastro",
      "check_prescription_safety",
      "confirm_pre_cadastro",
      "create_pre_cadastro",
      "finalizar_sala_telemedicina",
      "promote_pre_cadastro",
      "publish_dicom_report",
      "queue_notification",
      "registrar_consentimento_gravacao",
      "set_access_context",
      "set_professional_schedule_grid_status_secure",
      "update_reception_authorization_secure",
      "update_reception_eligibility_secure",
      "upsert_professional_schedule_grid_secure",
    ];

    for (const rpc of blockedRpcContracts) {
      expect(source).not.toMatch(new RegExp(`\\n\\s*${rpc}:`));
    }
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
    expect(source).toContain("INSERT INTO auth.refresh_tokens (token, user_id, parent, session_jti)");
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

  it("serializa retornos RPC compostos como JSON compativel com PostgREST", () => {
    expect(source).toContain(
      '`SELECT to_jsonb(public."${fnName}"(${namedArgs})) AS result`',
    );
    expect(source).toContain(
      'FROM public."${fnName}"(${namedArgs}) AS result_row',
    );
    expect(source).toContain("SELECT to_jsonb(result_row) AS result");
    expect(source).not.toContain(
      '`SELECT public."${fnName}"(${namedArgs}) AS result`',
    );
  });

  it("bloqueia waiting pela RPC publica da Agenda", () => {
    expect(source).toMatch(
      /fnName === 'update_appointment_status_secure'[\s\S]*body\.p_new_status === 'waiting'[\s\S]*code: '42501'[\s\S]*403/,
    );
  });

  it("autoriza pelo contexto ativo e sem bypass estatico de administrador", () => {
    expect(source).toContain("getActiveAccessContext(payload)");
    expect(source).toContain("public.can_access($1, $2)");
    expect(source).not.toContain("if (role === 'admin') return { ok: true };");
    expect(source).not.toContain("const permCache = new Map()");
  });

  it("permite leitura contextual dos catalogos compartilhados sem liberar escrita", () => {
    expect(source).toContain("const SHARED_CATALOG_ACCESS");
    expect(source).toContain("companies: { readModules: [], writeModule: 'admin' }");
    expect(source).toContain("units: { readModules: [], writeModule: 'admin' }");
    expect(source).toContain("roles: { readModules: [], writeModule: 'admin' }");
    expect(source).toContain(
      "insurance_companies: { readModules: ['recepcao', 'faturamento'], writeModule: 'faturamento' }",
    );
    expect(source).toContain(
      "lgpd_termos: { readModules: ['recepcao', 'auditoria'], writeModule: 'auditoria' }",
    );
    expect(source).toContain("sharedCatalog.readModules");
    expect(source).toContain("sharedCatalog.writeModule");
  });

  it("reutiliza a conexao da transacao durante a rotacao de refresh", () => {
    expect(source).toContain("queryAsAuthenticatedInTransaction(");
    expect(source).toContain("connectionTimeoutMillis");
    expect(source).not.toContain("const profile = await getUserProfile(nextPayload)");
  });
});

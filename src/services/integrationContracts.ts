export type IntegrationContractKind = "schema" | "rpc" | "schema+rpc";
export type BaselineResourceStatus = "comprovada" | "ausente" | "dependente-runtime";
export type BaselineResourceKind = "tabela" | "rpc" | "view";

export interface BaselineResource {
  name: string;
  kind: BaselineResourceKind;
  status: BaselineResourceStatus;
  evidence: string;
}

export interface IntegrationContract {
  id: string;
  flow: "agenda" | "callcenter" | "reception" | "attendance" | "billing";
  kind: IntegrationContractKind;
  requiredTables: string[];
  requiredRpcs: string[];
  preconditions: string[];
  postconditions: string[];
  baselineResources?: BaselineResource[];
  runtimeDependencies?: string[];
}

export const operationalIntegrationContracts: IntegrationContract[] = [
  {
    id: "agenda.read-write",
    flow: "agenda",
    kind: "schema+rpc",
    requiredTables: ["appointments", "patients", "professionals", "specialties", "appointment_types", "services_catalog"],
    requiredRpcs: ["create_appointment_with_requirements_secure", "update_appointment_status_secure", "reschedule_appointment_secure"],
    preconditions: ["appointment_date/start_time are valid local calendar values", "patient and professional IDs are numeric-compatible", "actor has company/unit scope"],
    postconditions: ["status transition is allowed", "returned appointment contains the persisted ID and status"],
    baselineResources: [
      ...["appointments", "patients", "professionals", "specialties", "appointment_types", "services_catalog"].map((name) => ({ name, kind: "tabela" as const, status: "comprovada" as const, evidence: "referenciada pela baseline local de tabelas/RLS e/ou scheduling" })),
      { name: "create_appointment_secure", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "update_appointment_status_secure", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "reschedule_appointment_secure", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "can_transition_appointment_status", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "get_scheduling_actor", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql/20260711090000_base_tables_rls_tenant_hardening.sql" },
      { name: "assert_scheduling_permission", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "assert_appointment_slot_available", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "create_appointment_with_requirements_secure", kind: "rpc", status: "ausente", evidence: "chamado por appointmentsService, sem definição nas migrations locais" },
      { name: "get_scheduling_requirements", kind: "rpc", status: "ausente", evidence: "chamado por appointmentsService, sem definição nas migrations locais" },
    ],
    runtimeDependencies: ["sessão authenticated", "actor com company_id/role_name", "RLS/grants efetivamente aplicados"],
  },
  {
    id: "callcenter.contacts-confirmations",
    flow: "callcenter",
    kind: "schema+rpc",
    requiredTables: ["user_profiles", "scheduling_contact_logs", "scheduling_call_center_tasks", "scheduling_confirmation_queue", "patients"],
    requiredRpcs: ["refresh_confirmation_queue_secure", "record_confirmation_attempt_secure"],
    preconditions: ["authenticated actor resolves to a company", "contact reason is non-empty", "patient/appointment IDs are numeric-compatible"],
    postconditions: ["contact and optional task share the same company and contact ID", "confirmation outcome is auditable"],
    baselineResources: [
      { name: "user_profiles", kind: "tabela", status: "comprovada", evidence: "20260711090000_base_tables_rls_tenant_hardening.sql" },
      { name: "patients", kind: "tabela", status: "comprovada", evidence: "baseline local de tabelas/RLS" },
      { name: "scheduling_contact_logs", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem CREATE TABLE nas migrations locais" },
      { name: "scheduling_call_center_tasks", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem CREATE TABLE nas migrations locais" },
      { name: "scheduling_confirmation_queue", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem CREATE TABLE nas migrations locais" },
      { name: "refresh_confirmation_queue_secure", kind: "rpc", status: "ausente", evidence: "chamada pelo serviço, sem definição nas migrations locais" },
      { name: "record_confirmation_attempt_secure", kind: "rpc", status: "ausente", evidence: "chamada pelo serviço, sem definição nas migrations locais" },
    ],
    runtimeDependencies: ["auth.getUser() válido", "user_profiles.id = auth.uid()", "company_id e RLS/grants efetivos"],
  },
  {
    id: "reception.checkin-readiness",
    flow: "reception",
    kind: "rpc",
    requiredTables: ["appointments", "reception_authorizations", "reception_eligibility_checks"],
    requiredRpcs: ["get_reception_checkin_readiness", "perform_reception_checkin_secure"],
    preconditions: ["appointment exists and is scheduled/confirmed", "readiness issues are evaluated", "exception requires a non-empty reason"],
    postconditions: ["successful check-in produces a ticket", "appointment enters waiting and an audit trail is created"],
  },
  {
    id: "attendance.record-billing",
    flow: "attendance",
    kind: "schema",
    requiredTables: ["appointments", "medical_records", "billings"],
    requiredRpcs: ["update_appointment_status_secure"],
    preconditions: ["appointment is in_progress or can enter in_progress", "clinical record has required content", "appointment_id is available for billing lookup"],
    postconditions: ["one clinical record is saved", "appointment becomes completed", "at most one billing exists for appointment_id/company_id"],
    baselineResources: [
      { name: "appointments", kind: "tabela", status: "comprovada", evidence: "20260711090000_base_tables_rls_tenant_hardening.sql" },
      { name: "patients", kind: "tabela", status: "comprovada", evidence: "baseline local de tabelas/RLS" },
      { name: "medical_records", kind: "tabela", status: "comprovada", evidence: "20251231003000_create_medical_records_stub.sql + baseline RLS" },
      { name: "billings", kind: "tabela", status: "comprovada", evidence: "20251231005000_create_billings_stub.sql + baseline RLS" },
      { name: "price_tables", kind: "tabela", status: "comprovada", evidence: "20260101000005_price_tables.sql" },
      { name: "update_appointment_status_secure", kind: "rpc", status: "comprovada", evidence: "20260708090000_scheduling_phase1.sql" },
      { name: "find_price", kind: "rpc", status: "comprovada", evidence: "20260101000005_price_tables.sql" },
      { name: "billings_company_appointment_key", kind: "rpc", status: "dependente-runtime", evidence: "constraint é criada por migration local, mas precisa estar aplicada e sem duplicidades no banco" },
    ],
    runtimeDependencies: ["sessão authenticated com company_id", "RLS de medical_records/billings", "constraint tenant de billing aplicada", "dados de preço vigentes"],
  },
  {
    id: "billing.accounts-pending",
    flow: "billing",
    kind: "schema+rpc",
    requiredTables: ["billing_accounts", "billing_pending_issues", "billing_competencies", "patients"],
    requiredRpcs: ["billing_check_pending"],
    preconditions: ["billing account belongs to the actor company", "status is valid for the requested operation", "competence is open for changes"],
    postconditions: ["pending issues are resolved/audited", "reopen requires a reason", "closed competence rejects retroactive changes"],
    baselineResources: [
      { name: "patients", kind: "tabela", status: "comprovada", evidence: "baseline local de tabelas/RLS" },
      { name: "billings", kind: "tabela", status: "comprovada", evidence: "20251231005000_create_billings_stub.sql + baseline RLS" },
      { name: "billing_accounts", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
      { name: "billing_pending_issues", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
      { name: "billing_competencies", kind: "tabela", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
      { name: "billing_check_pending", kind: "rpc", status: "ausente", evidence: "chamada pelo serviço, sem definição nas migrations locais" },
      { name: "v_billing_receita_convenio", kind: "view", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
      { name: "v_billing_receita_mensal", kind: "view", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
      { name: "v_billing_indicadores", kind: "view", status: "ausente", evidence: "usada pelo serviço, sem definição nas migrations locais" },
    ],
    runtimeDependencies: ["perfil financeiro/gestor autorizado", "RLS tenant efetivo", "competência aberta e dados de faturamento disponíveis"],
  },
];

export function getIntegrationContract(id: string): IntegrationContract | undefined {
  return operationalIntegrationContracts.find((contract) => contract.id === id);
}

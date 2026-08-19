import { supabase } from "@/lib/supabase";
import {
  receptionService,
  type CheckinIssue,
  type CheckinReadiness,
  type CheckinResult,
  type ReceptionPrecheckinContext,
} from "@/services/receptionService";
import type { InsuranceCompany, InsurancePlan } from "@/services/insuranceService";

export interface ReceptionPatientPayerSource {
  insurance_plan_id: string | null;
}

export interface ReceptionBillingQuote {
  billingType: "particular" | "convenio";
  insuranceId: number | null;
  totalGrossAmount: number;
}

export function resolveReceptionPayer(
  patient: ReceptionPatientPayerSource | undefined,
  insurancePlans: InsurancePlan[],
  insuranceCompanies: InsuranceCompany[],
  insuranceCatalogReady: boolean,
) {
  if (!patient) throw new Error("Cadastro do paciente indisponível. O check-in foi bloqueado.");
  if (!patient.insurance_plan_id) return { plan: null, insurer: null, billingType: "particular" as const };
  if (!insuranceCatalogReady) throw new Error("Não foi possível carregar convênios e planos. O pagador não pode ser definido com segurança.");
  const plan = insurancePlans.find((item) => String(item.id) === String(patient.insurance_plan_id));
  if (!plan) throw new Error("Plano do paciente não foi encontrado. O check-in foi bloqueado.");
  const insurer = insuranceCompanies.find((item) => item.id === plan.insurance_company_id);
  if (!insurer) throw new Error("Convênio do paciente não foi encontrado. O check-in foi bloqueado.");
  return { plan, insurer, billingType: "convenio" as const };
}

export function assertReceptionPriceFound(found: boolean): void {
  if (!found) throw new Error("Preço não cadastrado para este atendimento. A pré-conta não pode ser aberta com valor presumido.");
}

export function assertReceptionBillingIntegrity(quote: ReceptionBillingQuote | null, submitted: ReceptionBillingQuote): void {
  if (!quote) throw new Error("Cotação da pré-conta indisponível. Reabra o check-in.");
  if (quote.billingType !== submitted.billingType || quote.insuranceId !== submitted.insuranceId || Math.abs(quote.totalGrossAmount - submitted.totalGrossAmount) > 0.001) {
    throw new Error("Pagador ou valor da pré-conta divergiu da cotação validada. Reabra o check-in.");
  }
}

export function assertReceptionReceivableIntegrity(
  billingType: "particular" | "convenio",
  totalGrossAmount: number,
  receivableType: "copayment" | "private",
  receivableAmount: number,
): void {
  if (receivableAmount <= 0 || receivableAmount > totalGrossAmount) throw new Error("Valor do recebível deve ser positivo e não pode exceder a pré-conta.");
  if ((billingType === "particular" && receivableType !== "private") || (billingType === "convenio" && receivableType !== "copayment")) {
    throw new Error("Tipo do recebível incompatível com a fonte pagadora.");
  }
}

export function assertReceptionReceivableRequired(billingType: "particular" | "convenio", createReceivable: boolean): void {
  if (billingType === "particular" && !createReceivable) throw new Error("Atendimento particular exige título financeiro pendente antes do check-in.");
}

function workflowStorageKey(companyId: string | null, unitId: number | null, appointmentId: string): string {
  return `prontomedic:reception-workflow:${companyId || "company"}:${unitId || "unit"}:${appointmentId}`;
}

function walkinStorageKey(companyId: string | null, unitId: number | null): string {
  return `prontomedic:reception-walkin:${companyId || "company"}:${unitId || "unit"}`;
}

function createOperationKey(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`.slice(0, 120);
}

export function getOrCreateWalkinKey(companyId: string | null, unitId: number | null): string {
  const storageKey = walkinStorageKey(companyId, unitId);
  const existing = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(storageKey) : null;
  if (existing) return existing;
  const value = createOperationKey("walkin");
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, value);
  return value;
}

export function clearWalkinKey(companyId: string | null, unitId: number | null): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(walkinStorageKey(companyId, unitId));
}

export function getOrCreateWorkflowKey(appointmentId: string, companyId: string | null, unitId: number | null): string {
  const storageKey = workflowStorageKey(companyId, unitId, appointmentId);
  const existing = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(storageKey) : null;
  if (existing) return existing;
  const value = createOperationKey(`reception:${appointmentId}`);
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, value);
  return value;
}

export function clearWorkflowKey(appointmentId: string, companyId: string | null, unitId: number | null): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(workflowStorageKey(companyId, unitId, appointmentId));
}

export type ReceptionWorkflowStatus = "in_progress" | "blocked" | "failed" | "completed";
export type ReceptionWorkflowStep =
  | "precheck"
  | "billing"
  | "tiss"
  | "financial"
  | "checkin"
  | "completed";

export interface ReceptionCheckinWorkflow {
  id: string;
  company_id: string;
  unit_id: number;
  appointment_id: number;
  patient_id: number;
  operation: "reception_checkin";
  idempotency_key: string;
  request_hash: string;
  request_payload: Record<string, unknown>;
  correlation_id: string;
  requires_tiss: boolean;
  requires_financial: boolean;
  status: ReceptionWorkflowStatus;
  current_step: ReceptionWorkflowStep;
  billing_account_id: string | null;
  tiss_guide_id: string | null;
  financial_transaction_id: number | null;
  checkin_id: number | null;
  result_payload: Record<string, unknown>;
  attempt_count: number;
  version: number;
  error_code: string | null;
  error_message: string | null;
}

export interface ReceptionWorkflowInput {
  appointmentId: number;
  idempotencyKey: string;
  priority?: "normal" | "legal" | "urgent";
  exceptionReason?: string;
  billing: {
    type: "particular" | "convenio";
    accountType?: string;
    insuranceId?: number;
    totalGrossAmount: number;
  };
  tiss?: {
    guideType:
      | "CONSULTA"
      | "SP/SADT"
      | "INTERNACAO"
      | "RESUMO_INTERNACAO"
      | "HONORARIO"
      | "OUTRAS_DESPESAS"
      | "RECURSO_GLOSA";
    environment?: "HOMOLOGACAO" | "PRODUCAO";
  };
  receivable?: {
    type: "copayment" | "private";
    amount: number;
    dueDate: string;
  };
}

export interface ReceptionWorkflowRunResult {
  workflow: ReceptionCheckinWorkflow;
  checkin?: CheckinResult;
}

interface WorkflowArtifact {
  id: string | number;
}

interface ReceptionWorklistResult {
  required: boolean;
  released: boolean;
  item_count: number;
}

export interface ReceptionWorkflowDependencies {
  start(
    appointmentId: number,
    idempotencyKey: string,
    requestPayload: Record<string, unknown>,
  ): Promise<ReceptionCheckinWorkflow>;
  advance(input: {
    workflowId: string;
    expectedVersion: number;
    nextStep: ReceptionWorkflowStep;
    status: ReceptionWorkflowStatus;
    billingAccountId?: string;
    tissGuideId?: string;
    financialTransactionId?: number;
    checkinId?: number;
    resultPayload?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<ReceptionCheckinWorkflow>;
  getReadiness(appointmentId: number): Promise<CheckinReadiness>;
  getPrecheckinContext(appointmentId: number): Promise<ReceptionPrecheckinContext>;
  ensureBilling(
    workflowId: string,
    billing: ReceptionWorkflowInput["billing"],
  ): Promise<WorkflowArtifact>;
  ensureFinancial(
    workflowId: string,
    receivable: NonNullable<ReceptionWorkflowInput["receivable"]>,
  ): Promise<WorkflowArtifact>;
  performCheckin(
    workflowId: string,
    input: ReceptionWorkflowInput,
  ): Promise<CheckinResult>;
  ensureWorklist(workflowId: string): Promise<ReceptionWorklistResult>;
  getCompletedCheckin(
    workflow: ReceptionCheckinWorkflow,
  ): Promise<CheckinResult>;
}

export class ReceptionWorkflowBlockedError extends Error {
  constructor(
    message: string,
    public readonly workflow: ReceptionCheckinWorkflow,
  ) {
    super(message);
    this.name = "ReceptionWorkflowBlockedError";
  }
}

export class ReceptionWorkflowExecutionError extends Error {
  constructor(
    message: string,
    public readonly workflow?: ReceptionCheckinWorkflow,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "ReceptionWorkflowExecutionError";
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

const OWNER_HANDOFF_PATTERN =
  /sem permiss[aã]o|sem acesso|perfil operacional ativo n[aã]o encontrado/i;
const CONCURRENCY_PATTERN = /outra sess[aã]o|version|vers[aã]o/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_STATUSES: ReceptionWorkflowStatus[] = [
  "in_progress",
  "blocked",
  "failed",
  "completed",
];
const WORKFLOW_STEPS: ReceptionWorkflowStep[] = [
  "precheck",
  "billing",
  "tiss",
  "financial",
  "checkin",
  "completed",
];

function parsePositiveSafeInteger(value: unknown, label: string): number {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`${label} inválido`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} inválido`);
  }
  return parsed;
}

function assertWorkflowResponse(
  value: unknown,
  label: string,
): ReceptionCheckinWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: resposta estruturalmente inválida`);
  }
  const record = value as Record<string, unknown>;
  if (!UUID_PATTERN.test(String(record.id ?? ""))) {
    throw new Error(`${label}: workflow sem UUID válido`);
  }
  if (typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 0) {
    throw new Error(`${label}: versão do workflow inválida`);
  }
  if (!WORKFLOW_STATUSES.includes(record.status as ReceptionWorkflowStatus)) {
    throw new Error(`${label}: status do workflow inválido`);
  }
  if (!WORKFLOW_STEPS.includes(record.current_step as ReceptionWorkflowStep)) {
    throw new Error(`${label}: etapa do workflow inválida`);
  }
  if (!UUID_PATTERN.test(String(record.company_id ?? ""))) {
    throw new Error(`${label}: empresa do workflow inválida`);
  }
  for (const [field, fieldLabel] of [
    ["unit_id", "unidade"],
    ["appointment_id", "agendamento"],
    ["patient_id", "paciente"],
  ] as const) {
    if (
      typeof record[field] !== "number"
      || !Number.isSafeInteger(record[field])
      || record[field] <= 0
    ) {
      throw new Error(`${label}: ${fieldLabel} do workflow inválido`);
    }
  }
  if (record.operation !== "reception_checkin") {
    throw new Error(`${label}: operação do workflow inválida`);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(record.idempotency_key ?? ""))) {
    throw new Error(`${label}: chave de idempotência do workflow inválida`);
  }
  return value as ReceptionCheckinWorkflow;
}

function assertWorkflowIdentity(
  value: ReceptionCheckinWorkflow,
  expected: Pick<
    ReceptionCheckinWorkflow,
    "company_id" | "unit_id" | "appointment_id" | "patient_id" | "operation" | "idempotency_key"
  >,
  label: string,
): ReceptionCheckinWorkflow {
  const workflow = assertWorkflowResponse(value, label);
  const fields = [
    "company_id",
    "unit_id",
    "appointment_id",
    "patient_id",
    "operation",
    "idempotency_key",
  ] as const;
  if (fields.some((field) => workflow[field] !== expected[field])) {
    throw new Error(`${label}: identidade do workflow divergiu da operação iniciada`);
  }
  return workflow;
}

function assertInput(input: ReceptionWorkflowInput): void {
  if (!Number.isSafeInteger(input.appointmentId) || input.appointmentId <= 0) {
    throw new Error("Agendamento inválido para o workflow de check-in");
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new Error("Chave de idempotência inválida");
  }
  if (!Number.isFinite(input.billing.totalGrossAmount) || input.billing.totalGrossAmount < 0) {
    throw new Error("Valor da pré-conta inválido");
  }
  if (
    input.billing.totalGrossAmount === 0
    && (
      input.priority !== "legal"
      || (input.exceptionReason?.trim().length ?? 0) < 10
    )
  ) {
    throw new Error("Gratuidade exige prioridade legal e justificativa formal");
  }
  if (input.billing.type === "convenio" && !input.billing.insuranceId) {
    throw new Error("Convênio obrigatório para a pré-conta");
  }
  if (input.billing.type === "particular" && input.billing.insuranceId) {
    throw new Error("Conta particular não aceita convênio");
  }
  if (input.receivable) {
    if (!Number.isFinite(input.receivable.amount) || input.receivable.amount <= 0) {
      throw new Error("Valor do título pendente inválido");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivable.dueDate)) {
      throw new Error("Vencimento do título pendente inválido");
    }
  }
}

function buildRequestPayload(input: ReceptionWorkflowInput): Record<string, unknown> {
  return {
    priority: input.priority ?? "normal",
    exception_reason: input.exceptionReason?.trim() || null,
    requires_tiss: false,
    requires_financial: Boolean(input.receivable),
    billing: {
      type: input.billing.type,
      account_type: input.billing.accountType?.trim() || "ambulatorial",
      insurance_id: input.billing.insuranceId ?? null,
      total_gross_amount: input.billing.totalGrossAmount,
    },
    receivable: input.receivable
      ? {
          type: input.receivable.type,
          amount: input.receivable.amount,
          due_date: input.receivable.dueDate,
          payment_confirmed: false,
        }
      : null,
  };
}

function collectBlockingIssues(
  readiness: CheckinReadiness,
  context: ReceptionPrecheckinContext,
): CheckinIssue[] {
  const issues = [...(readiness.issues ?? []), ...(context.issues ?? [])];
  const unique = new Map(
    issues.map((issue) => [
      `${issue.type}:${issue.severity}:${issue.description}`,
      issue,
    ]),
  );
  return [...unique.values()].filter((issue) => issue.severity === "blocking");
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Falha não identificada";
  return raw
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento omitido]")
    .replace(/bearer\s+\S+/gi, "Bearer [token omitido]")
    .replace(/token[=:]\s*\S+/gi, "token=[omitido]")
    .slice(0, 500);
}

type DynamicRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

type DynamicRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => PromiseLike<DynamicRpcResult>;

async function rpcSingle<T>(
  functionName: string,
  args: Record<string, unknown>,
  label: string,
): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as DynamicRpc;
  const { data, error } = await rpc(functionName, args);
  if (error) throw new Error(`${label}: ${error.message}`);
  if (!data) throw new Error(`${label}: resposta vazia`);
  return data as T;
}

const defaultDependencies: ReceptionWorkflowDependencies = {
  start: async (appointmentId, idempotencyKey, requestPayload) =>
    assertWorkflowResponse(
      await rpcSingle<unknown>(
      "start_reception_checkin_workflow_secure",
      {
        p_appointment_id: appointmentId,
        p_idempotency_key: idempotencyKey,
        p_request_payload: requestPayload,
      },
      "Erro ao iniciar workflow de check-in",
      ),
      "Erro ao iniciar workflow de check-in",
    ),
  advance: async (input) =>
    assertWorkflowResponse(
      await rpcSingle<unknown>(
      "advance_reception_checkin_workflow_secure",
      {
        p_workflow_id: input.workflowId,
        p_expected_version: input.expectedVersion,
        p_next_step: input.nextStep,
        p_status: input.status,
        p_billing_account_id: input.billingAccountId ?? null,
        p_tiss_guide_id: input.tissGuideId ?? null,
        p_financial_transaction_id: input.financialTransactionId ?? null,
        p_checkin_id: input.checkinId ?? null,
        p_result_payload: input.resultPayload ?? null,
        p_error_code: input.errorCode ?? null,
        p_error_message: input.errorMessage ?? null,
      },
      "Erro ao avançar workflow de check-in",
      ),
      "Erro ao avançar workflow de check-in",
    ),
  getReadiness: (appointmentId) => receptionService.getReadiness(String(appointmentId)),
  getPrecheckinContext: (appointmentId) =>
    receptionService.getPrecheckinContext(String(appointmentId)),
  ensureBilling: (workflowId, billing) =>
    rpcSingle<WorkflowArtifact>(
      "ensure_billing_preaccount_for_checkin_secure",
      {
        p_workflow_id: workflowId,
        p_billing_type: billing.type,
        p_account_type: billing.accountType?.trim() || "ambulatorial",
        p_insurance_id: billing.insuranceId ?? null,
        p_total_gross_amount: billing.totalGrossAmount,
      },
      "Erro ao preparar pré-conta",
    ),
  ensureFinancial: (workflowId, receivable) =>
    rpcSingle<WorkflowArtifact>(
      "ensure_financial_receivable_for_checkin_secure",
      {
        p_workflow_id: workflowId,
        p_amount: receivable.amount,
        p_due_date: receivable.dueDate,
        p_receivable_type: receivable.type,
      },
      "Erro ao preparar título pendente",
    ),
  performCheckin: (workflowId, input) =>
    receptionService.checkin(
      workflowId,
      String(input.appointmentId),
      input.priority ?? "normal",
      input.exceptionReason,
    ),
  ensureWorklist: (workflowId) =>
    rpcSingle<ReceptionWorklistResult>(
      "ensure_reception_worklist_for_checkin_secure",
      { p_workflow_id: workflowId },
      "Erro ao liberar Worklist do atendimento",
    ),
  getCompletedCheckin: async (workflow) => {
    const checkinId = parsePositiveSafeInteger(
      workflow.checkin_id,
      "Identificador do check-in concluído",
    );
    const ticketId = parsePositiveSafeInteger(
      workflow.result_payload.ticket_id,
      "Identificador da senha concluída",
    );
    const [{ data: checkin, error: checkinError }, { data: ticket, error: ticketError }] =
      await Promise.all([
        supabase
          .from("reception_checkins")
          .select("id,released_by_exception")
          .eq("id", checkinId)
          .eq("appointment_id", workflow.appointment_id)
          .maybeSingle(),
        supabase
          .from("reception_queue_tickets")
          .select("id,checkin_id,prefix,number")
          .eq("id", ticketId)
          .eq("checkin_id", checkinId)
          .maybeSingle(),
      ]);
    if (checkinError || !checkin) {
      throw new Error(
        `Falha ao recuperar check-in concluído: ${checkinError?.message ?? "registro ausente"}`,
      );
    }
    if (ticketError || !ticket) {
      throw new Error(
        `Falha ao recuperar senha concluída: ${ticketError?.message ?? "registro ausente"}`,
      );
    }
    return {
      checkin_id: Number(checkin.id),
      ticket_id: Number(ticket.id),
      ticket: `${ticket.prefix}${String(ticket.number).padStart(3, "0")}`,
      released_by_exception: Boolean(checkin.released_by_exception),
      issues: [],
      idempotent: true,
    };
  },
};

export function createReceptionWorkflowService(
  dependencies: ReceptionWorkflowDependencies = defaultDependencies,
) {
  async function markInterrupted(
    workflow: ReceptionCheckinWorkflow,
    error: unknown,
  ): Promise<never> {
    const message = safeErrorMessage(error);
    if (CONCURRENCY_PATTERN.test(message)) {
      throw new ReceptionWorkflowExecutionError(
        "Workflow alterado por outra sessão; retome com o mesmo idempotency key",
        workflow,
        { cause: error },
      );
    }

    const ownerHandoff = OWNER_HANDOFF_PATTERN.test(message);
    let persisted = workflow;
    try {
      persisted = await dependencies.advance({
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        nextStep: workflow.current_step,
        status: ownerHandoff ? "blocked" : "failed",
        errorCode: ownerHandoff
          ? `OWNER_HANDOFF_${workflow.current_step.toUpperCase()}`
          : `STEP_FAILED_${workflow.current_step.toUpperCase()}`,
        errorMessage: message,
      });
    } catch (persistError) {
      if (CONCURRENCY_PATTERN.test(safeErrorMessage(persistError))) {
        throw new ReceptionWorkflowExecutionError(
          "A etapa foi executada, mas outra sessão atualizou o workflow; retome com a mesma chave",
          workflow,
          { cause: error },
        );
      }
      throw new ReceptionWorkflowExecutionError(
        `Falha na etapa ${workflow.current_step} e ao persistir seu estado`,
        workflow,
        { cause: persistError },
      );
    }

    if (ownerHandoff) {
      throw new ReceptionWorkflowBlockedError(message, persisted);
    }
    throw new ReceptionWorkflowExecutionError(message, persisted, { cause: error });
  }

  async function run(input: ReceptionWorkflowInput): Promise<ReceptionWorkflowRunResult> {
    assertInput(input);
    let workflow = assertWorkflowResponse(
      await dependencies.start(
        input.appointmentId,
        input.idempotencyKey,
        buildRequestPayload(input),
      ),
      "Erro ao iniciar workflow de check-in",
    );
    if (
      workflow.appointment_id !== input.appointmentId
      || workflow.idempotency_key !== input.idempotencyKey
    ) {
      throw new Error("Workflow retornado não corresponde ao agendamento solicitado");
    }
    const workflowIdentity = workflow;
    const validateTransition = (
      value: ReceptionCheckinWorkflow,
      label: string,
    ) => assertWorkflowIdentity(value, workflowIdentity, label);
    let checkinResult: CheckinResult | undefined;

    if (workflow.status === "completed") {
      return {
        workflow,
        checkin: await dependencies.getCompletedCheckin(workflow),
      };
    }

    for (let transition = 0; transition < 7; transition += 1) {
      try {
        switch (workflow.current_step) {
          case "precheck": {
            const [readiness, context] = await Promise.all([
              dependencies.getReadiness(input.appointmentId),
              dependencies.getPrecheckinContext(input.appointmentId),
            ]);
            const blockingIssues = collectBlockingIssues(readiness, context);
            if (blockingIssues.length > 0 && !input.exceptionReason?.trim()) {
              const persisted = validateTransition(await dependencies.advance({
                workflowId: workflow.id,
                expectedVersion: workflow.version,
                nextStep: "precheck",
                status: "blocked",
                errorCode: "PRECHECK_BLOCKED",
                errorMessage: blockingIssues.map((issue) => issue.description).join("; "),
                resultPayload: { blocking_issue_count: blockingIssues.length },
              }), "Erro ao persistir bloqueio de pré-check-in");
              throw new ReceptionWorkflowBlockedError(
                "Pré-check-in possui pendências bloqueantes",
                persisted,
              );
            }
            workflow = validateTransition(await dependencies.advance({
              workflowId: workflow.id,
              expectedVersion: workflow.version,
              nextStep: "billing",
              status: "in_progress",
              resultPayload: {
                precheck_ready: blockingIssues.length === 0,
                exception_authorized: blockingIssues.length > 0,
              },
            }), "Erro ao avançar pré-check-in");
            break;
          }
          case "billing": {
            const account = await dependencies.ensureBilling(workflow.id, input.billing);
            const nextStep = input.receivable ? "financial" : "checkin";
            workflow = validateTransition(await dependencies.advance({
              workflowId: workflow.id,
              expectedVersion: workflow.version,
              nextStep,
              status: "in_progress",
              billingAccountId: String(account.id),
              resultPayload: { billing_preaccount_ready: true },
            }), "Erro ao avançar pré-conta");
            break;
          }
          case "tiss": {
            workflow = validateTransition(await dependencies.advance({
              workflowId: workflow.id,
              expectedVersion: workflow.version,
              nextStep: input.receivable ? "financial" : "checkin",
              status: "in_progress",
              resultPayload: { legacy_tiss_step_skipped: true },
            }), "Erro ao ignorar etapa TISS legada");
            break;
          }
          case "financial": {
            if (!input.receivable) {
              throw new Error("Recebível ausente para etapa financeira obrigatória");
            }
            const receivable = await dependencies.ensureFinancial(
              workflow.id,
              input.receivable,
            );
            const financialTransactionId = parsePositiveSafeInteger(
              receivable.id,
              "Identificador do título financeiro",
            );
            workflow = validateTransition(await dependencies.advance({
              workflowId: workflow.id,
              expectedVersion: workflow.version,
              nextStep: "checkin",
              status: "in_progress",
              financialTransactionId,
              resultPayload: {
                receivable_pending: true,
                payment_confirmed: false,
              },
            }), "Erro ao avançar etapa financeira");
            break;
          }
          case "checkin": {
            checkinResult = await dependencies.performCheckin(workflow.id, input);
            const worklist = await dependencies.ensureWorklist(workflow.id);
            workflow = validateTransition(await dependencies.advance({
              workflowId: workflow.id,
              expectedVersion: workflow.version,
              nextStep: "completed",
              status: "completed",
              checkinId: checkinResult.checkin_id,
              resultPayload: {
                checkin_completed: true,
                ticket_id: checkinResult.ticket_id,
                payment_confirmed: false,
                worklist_required: worklist.required,
                worklist_released: worklist.released,
                worklist_item_count: worklist.item_count,
              },
            }), "Erro ao concluir check-in");
            break;
          }
          case "completed":
            return { workflow, checkin: checkinResult };
          default:
            throw new Error("Etapa desconhecida no workflow de check-in");
        }
      } catch (error) {
        if (error instanceof ReceptionWorkflowBlockedError) throw error;
        return await markInterrupted(workflow, error);
      }

      if (workflow.status === "completed") {
        return { workflow, checkin: checkinResult };
      }
    }

    throw new ReceptionWorkflowExecutionError(
      "Workflow excedeu o limite seguro de transições",
      workflow,
    );
  }

  return { run };
}

export const receptionWorkflowService = createReceptionWorkflowService();

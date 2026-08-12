import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createReceptionWorkflowService,
  ReceptionWorkflowBlockedError,
  type ReceptionCheckinWorkflow,
  type ReceptionWorkflowDependencies,
  type ReceptionWorkflowInput,
  type ReceptionWorkflowStep,
} from "@/services/receptionWorkflowService";

const baseInput: ReceptionWorkflowInput = {
  appointmentId: 42,
  idempotencyKey: "checkin-42-attempt-1",
  priority: "normal",
  billing: {
    type: "convenio",
    accountType: "ambulatorial",
    insuranceId: 7,
    totalGrossAmount: 180,
  },
  tiss: {
    guideType: "SP/SADT",
    environment: "HOMOLOGACAO",
  },
  receivable: {
    type: "copayment",
    amount: 30,
    dueDate: "2026-07-25",
  },
};

function workflowAt(
  currentStep: ReceptionWorkflowStep,
  overrides: Partial<ReceptionCheckinWorkflow> = {},
): ReceptionCheckinWorkflow {
  return {
    id: "0f75bf1a-6f72-4e34-b291-5ee64c256fea",
    company_id: "59f8cc7f-69f5-4a0d-8e44-7888efcb9c20",
    unit_id: 3,
    appointment_id: 42,
    patient_id: 9,
    operation: "reception_checkin",
    idempotency_key: baseInput.idempotencyKey,
    request_hash: "a".repeat(64),
    request_payload: {},
    correlation_id: "12aac558-3b5c-4c4f-bfa8-218a62c4dc0b",
    requires_tiss: true,
    requires_financial: true,
    status: "in_progress",
    current_step: currentStep,
    billing_account_id: null,
    tiss_guide_id: null,
    financial_transaction_id: null,
    checkin_id: null,
    result_payload: {},
    attempt_count: 1,
    version: 1,
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

function createDependencies(initial: ReceptionCheckinWorkflow) {
  let state = { ...initial };
  const transitions: ReceptionWorkflowStep[] = [];

  const dependencies: ReceptionWorkflowDependencies = {
    start: vi.fn(async () => ({ ...state })),
    advance: vi.fn(async (input) => {
      if (input.expectedVersion !== state.version) {
        throw new Error("Workflow alterado por outra sessão");
      }
      transitions.push(input.nextStep);
      state = {
        ...state,
        current_step: input.nextStep,
        status: input.status,
        billing_account_id: state.billing_account_id ?? input.billingAccountId ?? null,
        tiss_guide_id: state.tiss_guide_id ?? input.tissGuideId ?? null,
        financial_transaction_id:
          state.financial_transaction_id ?? input.financialTransactionId ?? null,
        checkin_id: state.checkin_id ?? input.checkinId ?? null,
        result_payload: {
          ...state.result_payload,
          ...(input.resultPayload ?? {}),
        },
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        version: state.version + 1,
      };
      return { ...state };
    }),
    getReadiness: vi.fn(async () => ({
      appointment_id: 42,
      patient_id: 9,
      ready: true,
      issues: [],
      has_authorization_pending: false,
      has_document_pending: false,
    })),
    getPrecheckinContext: vi.fn(async () => ({
      appointment_id: 42,
      patient_id: 9,
      unit_id: 3,
      ready: true,
      issues: [],
      has_document_pending: false,
      has_consent_pending: false,
      document_issues: [],
      consent_issues: [],
    })),
    ensureBilling: vi.fn(async () => ({
      id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
    })),
    ensureTiss: vi.fn(async () => ({
      id: "15993f35-ad6b-4585-856c-596a77330468",
    })),
    ensureFinancial: vi.fn(async () => ({ id: 778 })),
    performCheckin: vi.fn(async () => ({
      checkin_id: 99,
      ticket_id: 123,
      ticket: "C123",
      released_by_exception: false,
      issues: [],
      idempotent: false,
    })),
    ensureWorklist: vi.fn(async () => ({
      required: true,
      released: true,
      item_count: 1,
    })),
    getCompletedCheckin: vi.fn(async () => ({
      checkin_id: 99,
      ticket_id: 123,
      ticket: "C123",
      released_by_exception: false,
      issues: [],
      idempotent: true,
    })),
  };

  return {
    dependencies,
    transitions,
    currentState: () => ({ ...state }),
  };
}

describe("receptionWorkflowService", () => {
  it("bloqueia pré-conta zerada sem gratuidade formal", async () => {
    const { dependencies } = createDependencies(workflowAt("precheck"));
    const service = createReceptionWorkflowService(dependencies);
    await expect(
      service.run({
        ...baseInput,
        billing: { ...baseInput.billing, totalGrossAmount: 0 },
      }),
    ).rejects.toThrow(/Gratuidade exige prioridade legal e justificativa formal/);
  });

  it("aceita gratuidade formal com prioridade legal e justificativa", async () => {
    const { dependencies } = createDependencies(workflowAt("precheck"));
    const service = createReceptionWorkflowService(dependencies);
    await service.run(
      {
        ...baseInput,
        priority: "legal",
        exceptionReason: "Gratuidade autorizada para atendimento social QA",
        billing: { ...baseInput.billing, totalGrossAmount: 0 },
      },
    );

    expect(dependencies.ensureBilling).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ totalGrossAmount: 0 }),
    );
  });

  it("executa a ordem completa sem confirmar pagamento", async () => {
    const mock = createDependencies(workflowAt("precheck"));
    const service = createReceptionWorkflowService(mock.dependencies);

    const result = await service.run(baseInput);

    expect(mock.transitions).toEqual([
      "billing",
      "tiss",
      "financial",
      "checkin",
      "completed",
    ]);
    expect(mock.dependencies.ensureBilling).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureTiss).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureFinancial).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: 30, type: "copayment" }),
    );
    expect(mock.dependencies.ensureWorklist).toHaveBeenCalledWith(
      "0f75bf1a-6f72-4e34-b291-5ee64c256fea",
    );
    expect(result.workflow.status).toBe("completed");
    expect(result.workflow.result_payload).toMatchObject({
      receivable_pending: true,
      payment_confirmed: false,
      checkin_completed: true,
      worklist_required: true,
      worklist_released: true,
      worklist_item_count: 1,
    });
  });

  it("recupera check-in e senha persistidos ao repetir workflow concluído", async () => {
    const mock = createDependencies(
      workflowAt("completed", {
        status: "completed",
        checkin_id: 99,
        billing_account_id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
        result_payload: { checkin_completed: true, ticket_id: 123 },
      }),
    );
    const service = createReceptionWorkflowService(mock.dependencies);

    const result = await service.run(baseInput);

    expect(mock.dependencies.getCompletedCheckin).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.performCheckin).not.toHaveBeenCalled();
    expect(mock.dependencies.ensureWorklist).not.toHaveBeenCalled();
    expect(result.checkin).toMatchObject({
      checkin_id: 99,
      ticket_id: 123,
      ticket: "C123",
      idempotent: true,
    });
  });

  it("retoma na etapa financeira sem duplicar pré-conta ou guia", async () => {
    const mock = createDependencies(
      workflowAt("financial", {
        version: 8,
        billing_account_id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
        tiss_guide_id: "15993f35-ad6b-4585-856c-596a77330468",
      }),
    );
    const service = createReceptionWorkflowService(mock.dependencies);

    const result = await service.run(baseInput);

    expect(mock.dependencies.ensureBilling).not.toHaveBeenCalled();
    expect(mock.dependencies.ensureTiss).not.toHaveBeenCalled();
    expect(mock.dependencies.ensureFinancial).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.performCheckin).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureWorklist).toHaveBeenCalledTimes(1);
    expect(mock.transitions).toEqual(["checkin", "completed"]);
    expect(result.workflow.financial_transaction_id).toBe(778);
  });

  it("retoma após falha intermediária com a mesma chave sem duplicar artefatos", async () => {
    const mock = createDependencies(workflowAt("precheck"));
    let financialCreations = 0;

    vi.mocked(mock.dependencies.ensureFinancial)
      .mockRejectedValueOnce(new Error("Falha transitória ao persistir título financeiro"))
      .mockImplementationOnce(async () => {
        financialCreations += 1;
        return { id: 778 };
      });

    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(service.run(baseInput)).rejects.toMatchObject({
      name: "ReceptionWorkflowExecutionError",
      workflow: expect.objectContaining({
        status: "failed",
        current_step: "financial",
        billing_account_id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
        tiss_guide_id: "15993f35-ad6b-4585-856c-596a77330468",
        financial_transaction_id: null,
        checkin_id: null,
      }),
    });

    const result = await service.run(baseInput);

    expect(mock.dependencies.start).toHaveBeenCalledTimes(2);
    expect(mock.dependencies.start).toHaveBeenNthCalledWith(
      1,
      baseInput.appointmentId,
      baseInput.idempotencyKey,
      expect.any(Object),
    );
    expect(mock.dependencies.start).toHaveBeenNthCalledWith(
      2,
      baseInput.appointmentId,
      baseInput.idempotencyKey,
      expect.any(Object),
    );
    expect(mock.dependencies.ensureBilling).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureTiss).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureFinancial).toHaveBeenCalledTimes(2);
    expect(financialCreations).toBe(1);
    expect(mock.dependencies.performCheckin).toHaveBeenCalledTimes(1);
    expect(mock.dependencies.ensureWorklist).toHaveBeenCalledTimes(1);
    expect(result.workflow).toMatchObject({
      status: "completed",
      current_step: "completed",
      billing_account_id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
      tiss_guide_id: "15993f35-ad6b-4585-856c-596a77330468",
      financial_transaction_id: 778,
      checkin_id: 99,
    });
  });

  it("conclui atendimento sem imagem sem criar item de Worklist", async () => {
    const mock = createDependencies(workflowAt("checkin"));
    vi.mocked(mock.dependencies.ensureWorklist).mockResolvedValueOnce({
      required: false,
      released: false,
      item_count: 0,
    });
    const service = createReceptionWorkflowService(mock.dependencies);

    const result = await service.run(baseInput);

    expect(result.workflow.status).toBe("completed");
    expect(result.workflow.result_payload).toMatchObject({
      worklist_required: false,
      worklist_released: false,
      worklist_item_count: 0,
    });
  });

  it("retoma Worklist com a mesma chave sem duplicar check-in", async () => {
    const mock = createDependencies(workflowAt("checkin"));
    vi.mocked(mock.dependencies.ensureWorklist)
      .mockRejectedValueOnce(new Error("Item DICOM incompleto"))
      .mockResolvedValueOnce({ required: true, released: true, item_count: 1 });
    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(service.run(baseInput)).rejects.toMatchObject({
      name: "ReceptionWorkflowExecutionError",
      workflow: expect.objectContaining({
        status: "failed",
        current_step: "checkin",
      }),
    });

    const result = await service.run(baseInput);

    expect(mock.dependencies.performCheckin).toHaveBeenCalledTimes(2);
    expect(mock.dependencies.ensureWorklist).toHaveBeenCalledTimes(2);
    expect(result.workflow).toMatchObject({
      status: "completed",
      current_step: "completed",
      checkin_id: 99,
    });
    expect(result.workflow.result_payload).toMatchObject({
      worklist_released: true,
      worklist_item_count: 1,
    });
  });

  it("interrompe o workflow quando o identificador financeiro é inválido", async () => {
    const mock = createDependencies(
      workflowAt("financial", {
        version: 8,
        billing_account_id: "3e0cfdf4-66af-44af-a500-81e9f25a7587",
        tiss_guide_id: "15993f35-ad6b-4585-856c-596a77330468",
      }),
    );
    vi.mocked(mock.dependencies.ensureFinancial).mockResolvedValueOnce({
      id: "não-numérico",
    });
    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(service.run(baseInput)).rejects.toMatchObject({
      name: "ReceptionWorkflowExecutionError",
      workflow: expect.objectContaining({
        status: "failed",
        current_step: "financial",
      }),
    });
    expect(mock.dependencies.performCheckin).not.toHaveBeenCalled();
  });

  it("persiste handoff blocked quando o papel atual não é dono da etapa", async () => {
    const mock = createDependencies(workflowAt("billing"));
    vi.mocked(mock.dependencies.ensureBilling).mockRejectedValueOnce(
      new Error("Perfil sem permissao para esta etapa"),
    );
    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(service.run(baseInput)).rejects.toMatchObject({
      name: "ReceptionWorkflowBlockedError",
      workflow: expect.objectContaining({
        status: "blocked",
        current_step: "billing",
        error_code: "OWNER_HANDOFF_BILLING",
      }),
    } satisfies Partial<ReceptionWorkflowBlockedError>);
    expect(mock.dependencies.ensureTiss).not.toHaveBeenCalled();
    expect(mock.dependencies.ensureFinancial).not.toHaveBeenCalled();
    expect(mock.dependencies.performCheckin).not.toHaveBeenCalled();
  });

  it("não abre artefatos quando o pré-check-in possui bloqueio", async () => {
    const mock = createDependencies(workflowAt("precheck"));
    vi.mocked(mock.dependencies.getReadiness).mockResolvedValueOnce({
      appointment_id: 42,
      patient_id: 9,
      ready: false,
      issues: [
        {
          type: "document",
          severity: "blocking",
          description: "Documento obrigatório ausente",
        },
      ],
      has_authorization_pending: false,
      has_document_pending: true,
    });
    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(service.run(baseInput)).rejects.toBeInstanceOf(
      ReceptionWorkflowBlockedError,
    );
    expect(mock.transitions).toEqual(["precheck"]);
    expect(mock.dependencies.ensureBilling).not.toHaveBeenCalled();
  });

  it("rejeita qualquer tentativa de modelar TISS em conta particular", async () => {
    const mock = createDependencies(workflowAt("precheck"));
    const service = createReceptionWorkflowService(mock.dependencies);

    await expect(
      service.run({
        ...baseInput,
        billing: {
          type: "particular",
          totalGrossAmount: 100,
        },
      }),
    ).rejects.toThrow(/TISS exige pré-conta de convênio/);
    expect(mock.dependencies.start).not.toHaveBeenCalled();
  });
});

describe("migration M11 check-in workflow — regressões P0/P1", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260725091000_module11_checkin_workflow.sql",
    ),
    "utf8",
  );
  const serviceSource = readFileSync(
    resolve(process.cwd(), "src/services/receptionWorkflowService.ts"),
    "utf8",
  );
  const workflowScopeMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728160000_reception_checkin_workflow_scope.sql",
    ),
    "utf8",
  );
  const appointmentRpcReadScopeMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728163000_reception_appointment_rpc_read_scope.sql",
    ),
    "utf8",
  );
  const appointmentActiveContextMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728170000_reception_appointment_active_context.sql",
    ),
    "utf8",
  );
  const appointmentTransactionCapabilityMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728173000_reception_appointment_transaction_capability.sql",
    ),
    "utf8",
  );
  const appointmentLockPolicyMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728180000_reception_appointment_lock_policy.sql",
    ),
    "utf8",
  );
  const canonicalScheduleTransitionMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728183000_reception_use_canonical_schedule_transition.sql",
    ),
    "utf8",
  );
  const canonicalTransitionGuardMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728190000_reception_canonical_transition_guard.sql",
    ),
    "utf8",
  );
  const waitingFailClosedMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728191500_reception_waiting_transition_fail_closed.sql",
    ),
    "utf8",
  );
  const privateTransitionCoreMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728193000_reception_private_schedule_transition_core.sql",
    ),
    "utf8",
  );
  const recreatedTransitionEntrypointsMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260728194500_reception_recreate_schedule_entrypoints.sql",
    ),
    "utf8",
  );

  it("não autoriza por current_user nem concede escrita financeira ao runtime", () => {
    expect(migration).not.toMatch(/current_user\s*=\s*'app_prontomedic'/i);
    expect(migration).not.toMatch(
      /CREATE POLICY[\s\S]{0,200}financial_transactions[\s\S]{0,100}FOR ALL TO authenticated/i,
    );
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.financial_transactions[\s\S]*authenticated, app_prontomedic/i,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION private\.[\s\S]{0,180}TO authenticated/i,
    );
  });

  it("amarra idempotência a operação, chave e hash e recusa transição inválida", () => {
    expect(migration).toContain(
      "UNIQUE (company_id, operation, idempotency_key)",
    );
    expect(migration).toContain("request_hash TEXT NOT NULL");
    expect(migration).toContain(
      "Mesma chave de idempotencia com operacao ou payload diferente",
    );
    expect(migration).toContain("Agendamento ja possui workflow com outra chave");
    expect(migration).toContain("Transicao de workflow invalida");
  });

  it("valida todos os identificadores no escopo e mantém financeiro pendente", () => {
    expect(migration).toContain(
      "Pre-conta nao pertence integralmente ao workflow",
    );
    expect(migration).toContain(
      "Guia TISS nao pertence integralmente ao workflow",
    );
    expect(migration).toContain(
      "Titulo financeiro nao pertence integralmente ao workflow",
    );
    expect(migration).toContain(
      "Check-in nao pertence integralmente ao workflow",
    );
    expect(migration).toMatch(
      /'em_aberto'[\s\S]*paid_amount[\s\S]*payment_method/i,
    );
    expect(serviceSource).not.toContain("record_reception_payment_secure");
    expect(serviceSource).not.toContain("paidAmount");
    expect(migration.toLowerCase()).not.toContain("datasigh");
  });

  it("finaliza o check-in no escopo imutável do workflow autorizado", () => {
    expect(workflowScopeMigration).toContain(
      "v_appointment.id := v_workflow.appointment_id",
    );
    expect(workflowScopeMigration).toContain(
      "v_appointment.company_id := v_workflow.company_id",
    );
    expect(workflowScopeMigration).not.toMatch(
      /SELECT \* INTO v_appointment\s+FROM public\.appointments/i,
    );
  });

  it("permite ao RPC bloquear somente o agendamento da empresa e unidade ativas", () => {
    expect(appointmentRpcReadScopeMigration).toContain(
      "FOR SELECT TO prontomedic_reception_rpc_owner",
    );
    expect(appointmentRpcReadScopeMigration).toContain(
      "company_id = public.current_company_id()",
    );
    expect(appointmentRpcReadScopeMigration).toContain(
      "private.reception_actor_can_access_unit(company_id, unit_id)",
    );
    expect(appointmentRpcReadScopeMigration).not.toMatch(
      /FOR SELECT TO (authenticated|app_prontomedic)/,
    );
    expect(appointmentActiveContextMigration).toMatch(
      /FOR SELECT TO prontomedic_reception_rpc_owner[\s\S]*company_id = public\.active_company_id\(\)[\s\S]*unit_id = public\.active_unit_id\(\)/,
    );
    expect(appointmentActiveContextMigration).toMatch(
      /FOR UPDATE TO prontomedic_reception_rpc_owner[\s\S]*WITH CHECK[\s\S]*unit_id = public\.active_unit_id\(\)/,
    );
    expect(appointmentActiveContextMigration).not.toContain(
      "reception_actor_can_access_unit",
    );
    expect(appointmentActiveContextMigration).not.toMatch(
      /FOR (SELECT|UPDATE) TO (authenticated|app_prontomedic)/,
    );
    expect(appointmentTransactionCapabilityMigration).toContain(
      "'app.reception.appointment_id'",
    );
    expect(appointmentTransactionCapabilityMigration).toContain(
      "'app.reception.company_id'",
    );
    expect(appointmentTransactionCapabilityMigration).toContain(
      "'app.reception.unit_id'",
    );
    expect(appointmentTransactionCapabilityMigration).toMatch(
      /set_config\([\s\S]*p_appointment_id::TEXT[\s\S]*TRUE[\s\S]*SELECT \*[\s\S]*FOR UPDATE/,
    );
    expect(appointmentTransactionCapabilityMigration).toMatch(
      /FOR SELECT TO prontomedic_reception_rpc_owner[\s\S]*id = NULLIF\([\s\S]*app\.reception\.appointment_id/,
    );
    expect(appointmentTransactionCapabilityMigration).not.toMatch(
      /FOR (SELECT|UPDATE) TO (authenticated|app_prontomedic)/,
    );
    expect(appointmentLockPolicyMigration).toMatch(
      /FOR ALL TO prontomedic_reception_rpc_owner/,
    );
    expect(appointmentLockPolicyMigration).toContain(
      "current_setting('app.reception.appointment_id', TRUE)",
    );
    expect(appointmentLockPolicyMigration).not.toMatch(
      /FOR ALL TO (authenticated|app_prontomedic)/,
    );
    expect(canonicalScheduleTransitionMigration).toMatch(
      /v_reception_waiting BOOLEAN[\s\S]*p_new_status = 'waiting'[\s\S]*public\.can_access\('recepcao', 'edit'\)/,
    );
    expect(canonicalScheduleTransitionMigration).toMatch(
      /private\.reception_mark_appointment_waiting[\s\S]*public\.update_appointment_status_secure\([\s\S]*'waiting'/,
    );
    expect(canonicalScheduleTransitionMigration).toMatch(
      /DROP POLICY IF EXISTS appointments_reception_rpc_lock/,
    );
    expect(canonicalScheduleTransitionMigration).toMatch(
      /REVOKE UPDATE \(status, notes, updated_at\) ON public\.appointments[\s\S]*FROM prontomedic_reception_rpc_owner/,
    );
    expect(canonicalTransitionGuardMigration).toMatch(
      /private\.reception_waiting_transition_authorized\(p_appointment_id\)/,
    );
    expect(canonicalTransitionGuardMigration).toMatch(
      /workflow\.status = 'in_progress'[\s\S]*workflow\.current_step = 'checkin'/,
    );
    expect(canonicalTransitionGuardMigration).toMatch(
      /workflow\.billing_account_id IS NOT NULL/,
    );
    expect(canonicalTransitionGuardMigration).toMatch(
      /checkin_record\.status = 'checked_in'[\s\S]*checkin_record\.created_by = auth\.uid\(\)/,
    );
    expect(canonicalTransitionGuardMigration).toMatch(
      /JOIN public\.reception_queue_tickets ticket/,
    );
    expect(canonicalTransitionGuardMigration).not.toMatch(
      /p_new_status = 'waiting'\s+AND public\.can_access\('recepcao', 'edit'\)/,
    );
    expect(waitingFailClosedMigration).toMatch(
      /p_new_status = 'waiting' AND NOT v_waiting_authorized[\s\S]*ERRCODE = '42501'/,
    );
    expect(waitingFailClosedMigration).toMatch(
      /v_waiting_transition[\s\S]*AND NOT v_waiting_authorized/,
    );
    expect(privateTransitionCoreMigration).toMatch(
      /p_new_status = 'waiting'[\s\S]*NOT p_reception_workflow[\s\S]*ERRCODE = '42501'/,
    );
    expect(privateTransitionCoreMigration).toMatch(
      /public\.update_appointment_status_secure[\s\S]*private\.transition_appointment_status_core\([\s\S]*FALSE/,
    );
    expect(privateTransitionCoreMigration).toMatch(
      /private\.transition_reception_appointment_to_waiting[\s\S]*private\.transition_appointment_status_core\([\s\S]*TRUE/,
    );
    expect(privateTransitionCoreMigration).toMatch(
      /REVOKE ALL ON FUNCTION private\.transition_appointment_status_core/,
    );
    expect(recreatedTransitionEntrypointsMigration).toMatch(
      /DROP FUNCTION public\.update_appointment_status_secure/,
    );
    expect(recreatedTransitionEntrypointsMigration).toMatch(
      /IF p_new_status = 'waiting'[\s\S]*ERRCODE = '42501'/,
    );
    expect(recreatedTransitionEntrypointsMigration).toMatch(
      /pg_get_functiondef\([\s\S]*Public schedule transition did not retain the waiting veto/,
    );
  });

  it("permite à recepção preparar artefatos sem conceder baixa financeira", () => {
    expect(migration).toMatch(
      /m11_ensure_billing_preaccount[\s\S]*ARRAY\['admin','gestor','recepcao','faturista'\]/,
    );
    expect(migration).toMatch(
      /m11_ensure_tiss_guide[\s\S]*ARRAY\['admin','gestor','recepcao','faturista'\]/,
    );
    expect(migration).toMatch(
      /m11_ensure_financial_receivable[\s\S]*ARRAY\['admin','gestor','recepcao','financeiro'\]/,
    );
    expect(migration).toContain("payment_confirmed");
    expect(migration).toContain("FALSE");
  });
});

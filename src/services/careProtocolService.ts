import { supabase } from "@/lib/supabase";
import type {
  CareProtocolAlert,
  CareProtocolContent,
  CareProtocolDefinition,
  CareProtocolEscalation,
  CareProtocolExecution,
  CareProtocolExecutionBundle,
  CareProtocolExecutionStep,
  CareProtocolObservation,
  CareProtocolOverride,
  CareProtocolTask,
  CareProtocolVersion,
  ProtocolAlertStatus,
  ProtocolDefinitionStatus,
  ProtocolExecutionStatus,
  ProtocolOverrideType,
  ProtocolStepStatus,
  ProtocolStepType,
  StartCareProtocolExecutionInput,
} from "@/types/careProtocols";

const allowedStepTypes = new Set<ProtocolStepType>([
  "TASK",
  "OBSERVATION",
  "CHECKLIST",
  "ALERT_REVIEW",
  "ESCALATION",
]);

const prohibitedAutomaticActions = new Set([
  "PRESCRIPTION",
  "PRESCRICAO",
  "PRESCRIÇÃO",
  "MEDICATION",
  "MEDICATION_ORDER",
  "DRUG_ORDER",
  "AUTO_PRESCRIBE",
]);

const executionTransitions: Record<ProtocolExecutionStatus, ProtocolExecutionStatus[]> = {
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const stepTransitions: Record<ProtocolStepStatus, ProtocolStepStatus[]> = {
  PENDING: ["IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"],
  IN_PROGRESS: ["COMPLETED", "SKIPPED", "BLOCKED"],
  BLOCKED: ["IN_PROGRESS", "SKIPPED"],
  COMPLETED: [],
  SKIPPED: [],
};

const alertTransitions: Record<ProtocolAlertStatus, ProtocolAlertStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED"],
  ACKNOWLEDGED: ["RESOLVED"],
  RESOLVED: [],
};

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface CareProtocolClient {
  rpc<T = unknown>(name: string, parameters?: Record<string, unknown>): RpcResult<T>;
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: unknown): unknown;
      order(column: string, options?: { ascending?: boolean }): unknown;
    };
  };
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório`);
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} inválido`);
  return parsed;
}

export function normalizeProtocolContent(input: unknown): CareProtocolContent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Conteúdo do protocolo deve ser um objeto");
  }
  const raw = input as { priority?: unknown; steps?: unknown };
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("Protocolo deve possuir ao menos um passo");
  }
  const keys = new Set<string>();
  const steps = raw.steps.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Passo ${index + 1} inválido`);
    }
    const step = candidate as Record<string, unknown>;
    const key = requiredText(step.key, `Chave do passo ${index + 1}`);
    if (keys.has(key)) throw new Error(`Chave de passo duplicada: ${key}`);
    keys.add(key);
    const rawType = String(step.type ?? "TASK").trim().toUpperCase();
    if (prohibitedAutomaticActions.has(rawType)) {
      throw new Error("M21 não pode prescrever ou criar ordem medicamentosa automaticamente");
    }
    if (!allowedStepTypes.has(rawType as ProtocolStepType)) {
      throw new Error(`Tipo de passo não suportado: ${rawType}`);
    }
    const dueMinutes = step.dueMinutes == null || step.dueMinutes === ""
      ? null
      : positiveInteger(step.dueMinutes, `Prazo do passo ${index + 1}`);
    return {
      key,
      sequence: step.sequence == null
        ? index + 1
        : positiveInteger(step.sequence, `Sequência do passo ${index + 1}`),
      title: requiredText(step.title, `Título do passo ${index + 1}`),
      instructions: String(step.instructions ?? "").trim() || null,
      type: rawType as ProtocolStepType,
      required: step.required !== false,
      assignedRole: String(step.assignedRole ?? step.assigned_role ?? "").trim() || null,
      dueMinutes,
    };
  });
  const sequences = new Set(steps.map((step) => step.sequence));
  if (sequences.size !== steps.length) throw new Error("Sequências de passos devem ser únicas");
  const priority = String(raw.priority ?? "ROUTINE").trim().toUpperCase();
  if (!["ROUTINE", "URGENT", "IMMEDIATE"].includes(priority)) {
    throw new Error("Prioridade do protocolo inválida");
  }
  return {
    priority: priority as CareProtocolContent["priority"],
    steps: [...steps].sort((a, b) => a.sequence - b.sequence),
  };
}

export function assertExecutionTransition(
  from: ProtocolExecutionStatus,
  to: ProtocolExecutionStatus,
  reason?: string | null,
): void {
  if (!executionTransitions[from]?.includes(to)) {
    throw new Error(`Transição de execução inválida: ${from} -> ${to}`);
  }
  if ((to === "PAUSED" || to === "CANCELLED") && !reason?.trim()) {
    throw new Error("Informe o motivo da pausa ou cancelamento");
  }
}

export function assertStepTransition(
  from: ProtocolStepStatus,
  to: ProtocolStepStatus,
  reason?: string | null,
): void {
  if (!stepTransitions[from]?.includes(to)) {
    throw new Error(`Transição de passo inválida: ${from} -> ${to}`);
  }
  if ((to === "SKIPPED" || to === "BLOCKED") && !reason?.trim()) {
    throw new Error("Informe o motivo do bloqueio ou salto");
  }
}

export function assertAlertTransition(
  from: ProtocolAlertStatus,
  to: ProtocolAlertStatus,
  reason?: string | null,
): void {
  if (!alertTransitions[from]?.includes(to)) {
    throw new Error(`Transição de alerta inválida: ${from} -> ${to}`);
  }
  if (to === "RESOLVED" && !reason?.trim()) {
    throw new Error("Informe o motivo da resolução do alerta");
  }
}

function unwrap<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data == null) throw new Error(`${context}: resposta vazia`);
  return data;
}

function asQuery<T>(value: unknown): QueryResult<T> {
  return value as QueryResult<T>;
}

export function createCareProtocolService(client: CareProtocolClient = supabase as unknown as CareProtocolClient) {
  return {
    async listDefinitions(unitId?: number | null): Promise<CareProtocolDefinition[]> {
      let query = client.from("care_protocol_definitions").select("*");
      if (unitId != null) {
        query = query.eq("unit_id", unitId) as typeof query;
      }
      const { data, error } = await asQuery<CareProtocolDefinition>(
        query.order("updated_at", { ascending: false }),
      );
      if (error) throw new Error(`Erro ao listar protocolos: ${error.message}`);
      return data ?? [];
    },

    async listVersions(definitionId: string): Promise<CareProtocolVersion[]> {
      const query = client
        .from("care_protocol_versions")
        .select("*")
        .eq("protocol_definition_id", requiredText(definitionId, "Protocolo")) as {
          order(column: string, options?: { ascending?: boolean }): unknown;
        };
      const { data, error } = await asQuery<CareProtocolVersion>(
        query.order("version_number", { ascending: false }),
      );
      if (error) throw new Error(`Erro ao listar versões: ${error.message}`);
      return data ?? [];
    },

    async createDefinition(input: {
      unitId?: number | null;
      code: string;
      name: string;
      category?: string;
      description?: string | null;
    }): Promise<CareProtocolDefinition> {
      const { data, error } = await client.rpc<CareProtocolDefinition>(
        "m21_create_protocol_definition_secure",
        {
          p_unit_id: input.unitId ?? null,
          p_code: requiredText(input.code, "Código"),
          p_name: requiredText(input.name, "Nome"),
          p_category: String(input.category ?? "CLINICAL").trim().toUpperCase(),
          p_description: input.description?.trim() || null,
        },
      );
      return unwrap(data, error, "Erro ao criar protocolo");
    },

    async publishVersion(input: {
      definitionId: string;
      content: unknown;
      changeSummary: string;
    }): Promise<CareProtocolVersion> {
      const content = normalizeProtocolContent(input.content);
      const { data, error } = await client.rpc<CareProtocolVersion>(
        "m21_publish_protocol_version_secure",
        {
          p_protocol_definition_id: requiredText(input.definitionId, "Protocolo"),
          p_content: {
            priority: content.priority,
            steps: content.steps.map((step) => ({
              key: step.key,
              sequence: step.sequence,
              title: step.title,
              instructions: step.instructions,
              type: step.type,
              required: step.required,
              assigned_role: step.assignedRole,
              due_minutes: step.dueMinutes,
            })),
          },
          p_change_summary: requiredText(input.changeSummary, "Resumo da versão"),
        },
      );
      return unwrap(data, error, "Erro ao publicar versão");
    },

    async transitionDefinition(input: {
      definitionId: string;
      expectedStatus: ProtocolDefinitionStatus;
      newStatus: ProtocolDefinitionStatus;
      reason: string;
    }): Promise<CareProtocolDefinition> {
      const { data, error } = await client.rpc<CareProtocolDefinition>(
        "m21_transition_protocol_definition_secure",
        {
          p_protocol_definition_id: requiredText(input.definitionId, "Protocolo"),
          p_expected_status: input.expectedStatus,
          p_new_status: input.newStatus,
          p_reason: requiredText(input.reason, "Motivo"),
        },
      );
      return unwrap(data, error, "Erro ao alterar protocolo");
    },

    async startExecution(input: StartCareProtocolExecutionInput): Promise<CareProtocolExecution> {
      const unitId = positiveInteger(input.unitId, "Unidade");
      const patientId = positiveInteger(input.patientId, "Paciente");
      const payload = input.sourceSignalPayload ?? {};
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Sinal de origem deve ser um objeto");
      }
      const { data, error } = await client.rpc<CareProtocolExecution>(
        "m21_start_protocol_execution_secure",
        {
          p_protocol_version_id: requiredText(input.protocolVersionId, "Versão"),
          p_unit_id: unitId,
          p_patient_id: patientId,
          p_encounter_id: input.encounterId || null,
          p_source_signal_type: input.sourceSignalType?.trim() || null,
          p_source_signal_id: input.sourceSignalId?.trim() || null,
          p_source_signal_payload: payload,
          p_assigned_to: input.assignedTo || null,
        },
      );
      return unwrap(data, error, "Erro ao iniciar protocolo");
    },

    async listExecutions(filters?: {
      unitId?: number;
      patientId?: number;
      status?: ProtocolExecutionStatus;
    }): Promise<CareProtocolExecution[]> {
      let query = client.from("care_protocol_executions").select("*");
      if (filters?.unitId) query = query.eq("unit_id", filters.unitId) as typeof query;
      if (filters?.patientId) query = query.eq("patient_id", filters.patientId) as typeof query;
      if (filters?.status) query = query.eq("status", filters.status) as typeof query;
      const { data, error } = await asQuery<CareProtocolExecution>(
        query.order("created_at", { ascending: false }),
      );
      if (error) throw new Error(`Erro ao listar execuções: ${error.message}`);
      return data ?? [];
    },

    async getExecutionBundle(executionId: string): Promise<CareProtocolExecutionBundle> {
      const id = requiredText(executionId, "Execução");
      const tables = [
        ["care_protocol_executions", "execution"],
        ["care_protocol_execution_steps", "steps"],
        ["care_protocol_observations", "observations"],
        ["care_protocol_alerts", "alerts"],
        ["care_protocol_escalations", "escalations"],
        ["care_protocol_overrides", "overrides"],
        ["care_protocol_tasks", "tasks"],
      ] as const;
      const results = await Promise.all(tables.map(async ([table, key]) => {
        const query = client.from(table).select("*");
        const scoped = key === "execution"
          ? query.eq("id", id)
          : query.eq("execution_id", id);
        const { data, error } = await asQuery<Record<string, unknown>>(scoped);
        if (error) throw new Error(`Erro ao carregar ${table}: ${error.message}`);
        return [key, data ?? []] as const;
      }));
      const rows = Object.fromEntries(results) as Record<string, Record<string, unknown>[]>;
      const execution = rows.execution?.[0] as unknown as CareProtocolExecution | undefined;
      if (!execution) throw new Error("Execução não encontrada");
      return {
        execution,
        steps: ((rows.steps ?? []) as unknown as CareProtocolExecutionStep[])
          .sort((a, b) => a.sequence_number - b.sequence_number),
        observations: ((rows.observations ?? []) as unknown as CareProtocolObservation[])
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)),
        alerts: ((rows.alerts ?? []) as unknown as CareProtocolAlert[])
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        escalations: ((rows.escalations ?? []) as unknown as CareProtocolEscalation[])
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        overrides: ((rows.overrides ?? []) as unknown as CareProtocolOverride[])
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        tasks: ((rows.tasks ?? []) as unknown as CareProtocolTask[])
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      };
    },

    async transitionExecution(
      executionId: string,
      expectedStatus: ProtocolExecutionStatus,
      newStatus: ProtocolExecutionStatus,
      reason?: string | null,
    ): Promise<CareProtocolExecution> {
      assertExecutionTransition(expectedStatus, newStatus, reason);
      const { data, error } = await client.rpc<CareProtocolExecution>(
        "m21_transition_protocol_execution_secure",
        {
          p_execution_id: requiredText(executionId, "Execução"),
          p_expected_status: expectedStatus,
          p_new_status: newStatus,
          p_reason: reason?.trim() || null,
        },
      );
      return unwrap(data, error, "Erro ao alterar execução");
    },

    async transitionStep(
      stepId: string,
      expectedStatus: ProtocolStepStatus,
      newStatus: ProtocolStepStatus,
      reason?: string | null,
    ): Promise<CareProtocolExecutionStep> {
      assertStepTransition(expectedStatus, newStatus, reason);
      const { data, error } = await client.rpc<CareProtocolExecutionStep>(
        "m21_transition_protocol_step_secure",
        {
          p_step_id: requiredText(stepId, "Passo"),
          p_expected_status: expectedStatus,
          p_new_status: newStatus,
          p_reason: reason?.trim() || null,
        },
      );
      return unwrap(data, error, "Erro ao alterar passo");
    },

    async addObservation(input: {
      executionId: string;
      stepId?: string | null;
      type: string;
      value?: Record<string, unknown>;
      notes?: string | null;
    }): Promise<CareProtocolObservation> {
      const { data, error } = await client.rpc<CareProtocolObservation>(
        "m21_add_protocol_observation_secure",
        {
          p_execution_id: requiredText(input.executionId, "Execução"),
          p_step_id: input.stepId || null,
          p_observation_type: requiredText(input.type, "Tipo da observação"),
          p_value: input.value ?? {},
          p_notes: input.notes?.trim() || null,
        },
      );
      return unwrap(data, error, "Erro ao registrar observação");
    },

    async raiseAlert(input: {
      executionId: string;
      stepId?: string | null;
      code: string;
      severity: "INFO" | "WARNING" | "CRITICAL";
      message: string;
    }): Promise<CareProtocolAlert> {
      const { data, error } = await client.rpc<CareProtocolAlert>(
        "m21_raise_protocol_alert_secure",
        {
          p_execution_id: requiredText(input.executionId, "Execução"),
          p_step_id: input.stepId || null,
          p_code: requiredText(input.code, "Código do alerta"),
          p_severity: input.severity,
          p_message: requiredText(input.message, "Mensagem do alerta"),
        },
      );
      return unwrap(data, error, "Erro ao registrar alerta");
    },

    async transitionAlert(
      alertId: string,
      expectedStatus: ProtocolAlertStatus,
      newStatus: ProtocolAlertStatus,
      reason?: string | null,
    ): Promise<CareProtocolAlert> {
      assertAlertTransition(expectedStatus, newStatus, reason);
      const { data, error } = await client.rpc<CareProtocolAlert>(
        "m21_transition_protocol_alert_secure",
        {
          p_alert_id: requiredText(alertId, "Alerta"),
          p_expected_status: expectedStatus,
          p_new_status: newStatus,
          p_reason: reason?.trim() || null,
        },
      );
      return unwrap(data, error, "Erro ao alterar alerta");
    },

    async escalate(input: {
      executionId: string;
      alertId?: string | null;
      level: number;
      targetRole?: string | null;
      targetUserId?: string | null;
      reason: string;
    }): Promise<CareProtocolEscalation> {
      const level = positiveInteger(input.level, "Nível");
      if (level > 5) throw new Error("Nível de escalonamento deve estar entre 1 e 5");
      if (!input.targetRole?.trim() && !input.targetUserId) {
        throw new Error("Informe o perfil ou usuário de destino do escalonamento");
      }
      const { data, error } = await client.rpc<CareProtocolEscalation>(
        "m21_escalate_protocol_secure",
        {
          p_execution_id: requiredText(input.executionId, "Execução"),
          p_alert_id: input.alertId || null,
          p_level: level,
          p_target_role: input.targetRole?.trim() || null,
          p_target_user_id: input.targetUserId || null,
          p_reason: requiredText(input.reason, "Motivo"),
        },
      );
      return unwrap(data, error, "Erro ao escalar protocolo");
    },

    async addOverride(input: {
      executionId: string;
      stepId?: string | null;
      type: ProtocolOverrideType;
      reason: string;
      previousValue?: unknown;
      newValue?: unknown;
    }): Promise<CareProtocolOverride> {
      const { data, error } = await client.rpc<CareProtocolOverride>(
        "m21_add_protocol_override_secure",
        {
          p_execution_id: requiredText(input.executionId, "Execução"),
          p_step_id: input.stepId || null,
          p_override_type: input.type,
          p_reason: requiredText(input.reason, "Motivo"),
          p_previous_value: input.previousValue ?? null,
          p_new_value: input.newValue ?? null,
        },
      );
      return unwrap(data, error, "Erro ao registrar override");
    },
  };
}

export const careProtocolService = createCareProtocolService();

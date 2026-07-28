import { supabase } from "@/lib/supabase";

export type ScheduleGradeStatus =
  | "draft"
  | "pending_validation"
  | "published"
  | "active"
  | "suspended"
  | "ended"
  | "expired"
  | "cancelled";

export type ScheduleGradeModality =
  | "in_person"
  | "teleconsult"
  | "home_care"
  | "on_call"
  | "procedure"
  | "exam"
  | "surgery"
  | "hybrid";

export type ScheduleExceptionType =
  | "unavailable"
  | "extra_availability"
  | "resource_override"
  | "capacity_override";

export type ScheduleGradeLifecycleAction =
  | "publish"
  | "resume"
  | "suspend"
  | "end"
  | "cancel";

export interface ScheduleGradeRuleInput {
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  breakStartsAt?: string | null;
  breakEndsAt?: string | null;
  serviceId?: number | null;
  appointmentTypeId?: number | null;
  durationMinutes?: number | null;
  capacity?: number | null;
  roomId?: number | null;
  equipmentId?: number | null;
  allowReturn?: boolean;
  allowWalkin?: boolean;
  status?: "active" | "inactive";
}

export interface ScheduleGradeInput {
  id?: number;
  unitId: number;
  professionalId: number;
  sectorId?: number | null;
  specialtyId?: number | null;
  name: string;
  modality: ScheduleGradeModality;
  timezone?: string;
  validFrom: string;
  validUntil?: string | null;
  status?: "draft" | "pending_validation";
  version?: number;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  defaultRoomId?: number | null;
  defaultEquipmentId?: number | null;
  generationWindowDays?: number;
  rules: ScheduleGradeRuleInput[];
}

export interface ScheduleExceptionInput {
  gradeId: number;
  exceptionDate: string;
  exceptionType: ScheduleExceptionType;
  reason: string;
  isAllDay?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  capacity?: number | null;
  roomId?: number | null;
  equipmentId?: number | null;
}

export interface ScheduleGradeRecord {
  id: number;
  company_id: string;
  unit_id: number;
  professional_id: number;
  sector_id: number | null;
  specialty_id: number | null;
  name: string;
  modality: ScheduleGradeModality;
  timezone: string;
  valid_from: string;
  valid_until: string | null;
  status: ScheduleGradeStatus;
  version: number;
  default_duration_minutes: number;
  default_capacity: number;
  default_room_id: number | null;
  default_equipment_id: number | null;
  generation_window_days: number;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleGradeRuleRecord {
  id: number;
  grade_id: number;
  company_id: string;
  unit_id: number;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
  service_id: number | null;
  appointment_type_id: number | null;
  duration_minutes: number | null;
  capacity: number | null;
  room_id: number | null;
  equipment_id: number | null;
  allow_return: boolean;
  allow_walkin: boolean;
  status: "active" | "inactive";
}

export interface ScheduleExceptionRecord {
  id: number;
  grade_id: number;
  company_id: string;
  unit_id: number;
  exception_date: string;
  is_all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  exception_type: ScheduleExceptionType;
  reason: string;
  duration_minutes: number | null;
  capacity: number | null;
  room_id: number | null;
  equipment_id: number | null;
  affected_appointments_count: number;
  requires_reschedule: boolean;
  status: "active" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface SchedulePublicationRecord {
  id: number;
  grade_id: number;
  company_id: string;
  unit_id: number;
  version: number;
  action: "published" | "resumed" | "suspended" | "ended" | "cancelled";
  reason: string | null;
  snapshot: ScheduleGradeBundle;
  actor_user_id: string;
  created_at: string;
}

export interface ScheduleGradeBundle {
  grade: ScheduleGradeRecord;
  rules: ScheduleGradeRuleRecord[];
  exceptions?: ScheduleExceptionRecord[];
}

export interface ScheduleWindow {
  gradeId: number;
  ruleId: number | null;
  companyId: string;
  unitId: number;
  professionalId: number;
  date: string;
  startsAt: string;
  endsAt: string;
  breakStartsAt: string | null;
  breakEndsAt: string | null;
  durationMinutes: number;
  capacity: number;
  roomId: number | null;
  equipmentId: number | null;
  serviceId: number | null;
  appointmentTypeId: number | null;
  allowReturn: boolean;
  allowWalkin: boolean;
  isException: boolean;
}

export interface ScheduleGradeDetails extends ScheduleGradeBundle {
  exceptions: ScheduleExceptionRecord[];
  publications: SchedulePublicationRecord[];
}

export interface ScheduleGradeListFilters {
  unitId?: number;
  professionalId?: number;
  status?: ScheduleGradeStatus | ScheduleGradeStatus[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function requiredPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} inválido.`);
  }
  return value;
}

function optionalPositiveInteger(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  return requiredPositiveInteger(value, field);
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} deve estar entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function requiredIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new Error("Chave de idempotência deve ter entre 8 e 200 caracteres.");
  }
  return key;
}

function requiredDate(value: string, field: string): string {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${field} inválida.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} inválida.`);
  }
  return value;
}

export function normalizeScheduleTime(value: string, field = "Horário"): string {
  const match = TIME_PATTERN.exec(value);
  if (!match) throw new Error(`${field} inválido.`);
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function minutesSinceMidnight(value: string): number {
  const [hours, minutes, seconds] = normalizeScheduleTime(value).split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function validateRule(rule: ScheduleGradeRuleInput, index: number): ScheduleGradeRuleInput {
  const label = `Regra ${index + 1}`;
  boundedInteger(rule.dayOfWeek, 0, 6, `${label}: dia da semana`);
  const startsAt = normalizeScheduleTime(rule.startsAt, `${label}: início`);
  const endsAt = normalizeScheduleTime(rule.endsAt, `${label}: fim`);
  if (minutesSinceMidnight(endsAt) <= minutesSinceMidnight(startsAt)) {
    throw new Error(`${label}: o fim deve ser posterior ao início.`);
  }

  const hasBreakStart = Boolean(rule.breakStartsAt);
  const hasBreakEnd = Boolean(rule.breakEndsAt);
  if (hasBreakStart !== hasBreakEnd) {
    throw new Error(`${label}: informe início e fim do intervalo.`);
  }

  let breakStartsAt: string | null = null;
  let breakEndsAt: string | null = null;
  if (hasBreakStart && hasBreakEnd) {
    breakStartsAt = normalizeScheduleTime(rule.breakStartsAt!, `${label}: início do intervalo`);
    breakEndsAt = normalizeScheduleTime(rule.breakEndsAt!, `${label}: fim do intervalo`);
    if (
      minutesSinceMidnight(breakStartsAt) < minutesSinceMidnight(startsAt) ||
      minutesSinceMidnight(breakEndsAt) > minutesSinceMidnight(endsAt) ||
      minutesSinceMidnight(breakEndsAt) <= minutesSinceMidnight(breakStartsAt)
    ) {
      throw new Error(`${label}: o intervalo deve ficar dentro da janela recorrente.`);
    }
  }

  if (rule.durationMinutes !== null && rule.durationMinutes !== undefined) {
    boundedInteger(rule.durationMinutes, 5, 1440, `${label}: duração`);
  }
  if (rule.capacity !== null && rule.capacity !== undefined) {
    boundedInteger(rule.capacity, 1, 100, `${label}: capacidade`);
  }

  return {
    ...rule,
    startsAt,
    endsAt,
    breakStartsAt,
    breakEndsAt,
    serviceId: optionalPositiveInteger(rule.serviceId, `${label}: serviço`),
    appointmentTypeId: optionalPositiveInteger(
      rule.appointmentTypeId,
      `${label}: tipo de atendimento`,
    ),
    roomId: optionalPositiveInteger(rule.roomId, `${label}: sala`),
    equipmentId: optionalPositiveInteger(rule.equipmentId, `${label}: equipamento`),
    allowReturn: rule.allowReturn ?? true,
    allowWalkin: rule.allowWalkin ?? false,
    status: rule.status ?? "active",
  };
}

function assertNoRuleOverlap(rules: ScheduleGradeRuleInput[]): void {
  const activeRules = rules.filter((rule) => (rule.status ?? "active") === "active");
  for (let leftIndex = 0; leftIndex < activeRules.length; leftIndex += 1) {
    const left = activeRules[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < activeRules.length; rightIndex += 1) {
      const right = activeRules[rightIndex];
      if (left.dayOfWeek !== right.dayOfWeek) continue;
      const overlaps =
        minutesSinceMidnight(left.startsAt) < minutesSinceMidnight(right.endsAt) &&
        minutesSinceMidnight(left.endsAt) > minutesSinceMidnight(right.startsAt);
      if (overlaps) {
        throw new Error(
          `As regras ${leftIndex + 1} e ${rightIndex + 1} se sobrepõem no mesmo dia.`,
        );
      }
    }
  }
}

export function validateScheduleGradeInput(input: ScheduleGradeInput): ScheduleGradeInput {
  if (input.id !== undefined) requiredPositiveInteger(input.id, "Grade");
  requiredPositiveInteger(input.unitId, "Unidade");
  requiredPositiveInteger(input.professionalId, "Profissional");
  optionalPositiveInteger(input.sectorId, "Setor");
  optionalPositiveInteger(input.specialtyId, "Especialidade");
  optionalPositiveInteger(input.defaultRoomId, "Sala padrão");
  optionalPositiveInteger(input.defaultEquipmentId, "Equipamento padrão");

  const name = input.name.trim();
  if (name.length < 3 || name.length > 160) {
    throw new Error("Nome da grade deve ter entre 3 e 160 caracteres.");
  }

  const validFrom = requiredDate(input.validFrom, "Início da vigência");
  const validUntil = input.validUntil
    ? requiredDate(input.validUntil, "Fim da vigência")
    : null;
  if (validUntil && validUntil < validFrom) {
    throw new Error("Fim da vigência não pode ser anterior ao início.");
  }

  boundedInteger(input.defaultDurationMinutes, 5, 1440, "Duração padrão");
  boundedInteger(input.defaultCapacity, 1, 100, "Capacidade padrão");
  const generationWindowDays = boundedInteger(
    input.generationWindowDays ?? 90,
    1,
    365,
    "Horizonte de geração",
  );

  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error("A grade deve possuir ao menos uma regra recorrente.");
  }
  const rules = input.rules.map(validateRule);
  assertNoRuleOverlap(rules);

  return {
    ...input,
    name,
    validFrom,
    validUntil,
    status: input.status ?? "draft",
    timezone: input.timezone?.trim() || "America/Sao_Paulo",
    generationWindowDays,
    rules,
  };
}

export function validateScheduleExceptionInput(
  input: ScheduleExceptionInput,
): ScheduleExceptionInput {
  requiredPositiveInteger(input.gradeId, "Grade");
  const exceptionDate = requiredDate(input.exceptionDate, "Data da exceção");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new Error("Motivo da exceção deve ter entre 3 e 1000 caracteres.");
  }

  const isAllDay = input.isAllDay ?? false;
  if (input.exceptionType === "extra_availability" && isAllDay) {
    throw new Error("Disponibilidade extra exige horário inicial e final.");
  }

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (!isAllDay) {
    if (!input.startsAt || !input.endsAt) {
      throw new Error("Exceção parcial exige horário inicial e final.");
    }
    startsAt = normalizeScheduleTime(input.startsAt, "Início da exceção");
    endsAt = normalizeScheduleTime(input.endsAt, "Fim da exceção");
    if (minutesSinceMidnight(endsAt) <= minutesSinceMidnight(startsAt)) {
      throw new Error("Fim da exceção deve ser posterior ao início.");
    }
  }

  if (input.durationMinutes !== null && input.durationMinutes !== undefined) {
    boundedInteger(input.durationMinutes, 5, 1440, "Duração da exceção");
  }
  if (input.capacity !== null && input.capacity !== undefined) {
    boundedInteger(input.capacity, 1, 100, "Capacidade da exceção");
  }

  return {
    ...input,
    exceptionDate,
    reason,
    isAllDay,
    startsAt,
    endsAt,
    roomId: optionalPositiveInteger(input.roomId, "Sala da exceção"),
    equipmentId: optionalPositiveInteger(input.equipmentId, "Equipamento da exceção"),
  };
}

function rpcError(action: string, error: { message: string } | null): never {
  throw new Error(`${action}: ${error?.message || "falha sem detalhe do banco"}`);
}

export const scheduleGradeService = {
  async list(filters: ScheduleGradeListFilters = {}): Promise<ScheduleGradeRecord[]> {
    let query = supabase
      .from("professional_schedule_grades")
      .select("*")
      .order("valid_from", { ascending: false })
      .order("name", { ascending: true })
      .limit(500);

    if (filters.unitId !== undefined) {
      query = query.eq("unit_id", requiredPositiveInteger(filters.unitId, "Unidade"));
    }
    if (filters.professionalId !== undefined) {
      query = query.eq(
        "professional_id",
        requiredPositiveInteger(filters.professionalId, "Profissional"),
      );
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      query = query.in("status", statuses);
    }

    const { data, error } = await query;
    if (error) rpcError("Erro ao carregar grades", error);
    return (data || []) as ScheduleGradeRecord[];
  },

  async getById(gradeId: number): Promise<ScheduleGradeDetails> {
    const id = requiredPositiveInteger(gradeId, "Grade");
    const [gradeResult, rulesResult, exceptionsResult, publicationsResult] = await Promise.all([
      supabase.from("professional_schedule_grades").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("professional_schedule_rules")
        .select("*")
        .eq("grade_id", id)
        .order("day_of_week")
        .order("starts_at"),
      supabase
        .from("professional_schedule_exceptions")
        .select("*")
        .eq("grade_id", id)
        .order("exception_date")
        .order("starts_at"),
      supabase
        .from("professional_schedule_publications")
        .select("*")
        .eq("grade_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (gradeResult.error) rpcError("Erro ao carregar grade", gradeResult.error);
    if (!gradeResult.data) throw new Error("Grade não encontrada ou não autorizada.");
    if (rulesResult.error) rpcError("Erro ao carregar recorrência", rulesResult.error);
    if (exceptionsResult.error) rpcError("Erro ao carregar exceções", exceptionsResult.error);
    if (publicationsResult.error) {
      rpcError("Erro ao carregar histórico de publicação", publicationsResult.error);
    }

    return {
      grade: gradeResult.data as ScheduleGradeRecord,
      rules: (rulesResult.data || []) as ScheduleGradeRuleRecord[],
      exceptions: (exceptionsResult.data || []) as ScheduleExceptionRecord[],
      publications: (publicationsResult.data || []) as SchedulePublicationRecord[],
    };
  },

  async save(input: ScheduleGradeInput, idempotencyKey: string): Promise<ScheduleGradeBundle> {
    const validated = validateScheduleGradeInput(input);
    const { rules, ...grade } = validated;
    const { data, error } = await supabase.rpc(
      "m9_save_professional_schedule_grade_secure",
      {
        p_grade: grade,
        p_rules: rules,
        p_idempotency_key: requiredIdempotencyKey(idempotencyKey),
      },
    );
    if (error) rpcError("Erro ao salvar grade", error);
    if (!data || typeof data !== "object") {
      throw new Error("Erro ao salvar grade: resposta inválida do banco.");
    }
    return data as unknown as ScheduleGradeBundle;
  },

  async addException(
    input: ScheduleExceptionInput,
    idempotencyKey: string,
  ): Promise<ScheduleExceptionRecord> {
    const validated = validateScheduleExceptionInput(input);
    const { data, error } = await supabase.rpc("m9_add_schedule_exception_secure", {
      p_grade_id: validated.gradeId,
      p_exception_date: validated.exceptionDate,
      p_exception_type: validated.exceptionType,
      p_reason: validated.reason,
      p_is_all_day: validated.isAllDay,
      p_starts_at: validated.startsAt,
      p_ends_at: validated.endsAt,
      p_duration_minutes: validated.durationMinutes ?? null,
      p_capacity: validated.capacity ?? null,
      p_room_id: validated.roomId ?? null,
      p_equipment_id: validated.equipmentId ?? null,
      p_idempotency_key: requiredIdempotencyKey(idempotencyKey),
    });
    if (error) rpcError("Erro ao registrar exceção", error);
    if (!data || typeof data !== "object") {
      throw new Error("Erro ao registrar exceção: resposta inválida do banco.");
    }
    return data as unknown as ScheduleExceptionRecord;
  },

  async transition(
    gradeId: number,
    action: ScheduleGradeLifecycleAction,
    idempotencyKey: string,
    reason?: string,
  ): Promise<ScheduleGradeBundle> {
    const id = requiredPositiveInteger(gradeId, "Grade");
    const normalizedReason = reason?.trim() || null;
    if ((action === "end" || action === "cancel") && !normalizedReason) {
      throw new Error("Motivo é obrigatório para encerrar ou cancelar uma grade.");
    }
    const { data, error } = await supabase.rpc("m9_publish_schedule_grade_secure", {
      p_grade_id: id,
      p_action: action,
      p_reason: normalizedReason,
      p_idempotency_key: requiredIdempotencyKey(idempotencyKey),
    });
    if (error) rpcError("Erro ao alterar publicação da grade", error);
    if (!data || typeof data !== "object") {
      throw new Error("Erro ao alterar publicação da grade: resposta inválida do banco.");
    }
    return data as unknown as ScheduleGradeBundle;
  },

  async getWindows(input: {
    professionalId: number;
    unitId: number;
    date: string;
    serviceId?: number | null;
  }): Promise<ScheduleWindow[]> {
    const { data, error } = await supabase.rpc(
      "m9_get_professional_schedule_windows_secure",
      {
        p_professional_id: requiredPositiveInteger(input.professionalId, "Profissional"),
        p_unit_id: requiredPositiveInteger(input.unitId, "Unidade"),
        p_date: requiredDate(input.date, "Data"),
        p_service_id: optionalPositiveInteger(input.serviceId, "Serviço"),
      },
    );
    if (error) rpcError("Erro ao resolver disponibilidade", error);
    if (!data) return [];
    if (!Array.isArray(data)) {
      throw new Error("Erro ao resolver disponibilidade: resposta inválida do banco.");
    }
    return data as unknown as ScheduleWindow[];
  },
};

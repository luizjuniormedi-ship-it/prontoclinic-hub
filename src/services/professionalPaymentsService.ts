import { z } from "zod";
import { supabase } from "@/lib/supabase";

export const remunerationTypeSchema = z.enum(["FIXED", "PACKAGE", "CH", "PERCENTAGE"]);
export const professionalPaymentStatusSchema = z.enum([
  "apurado",
  "conferido",
  "pago",
  "cancelado",
]);
export const professionalPaymentTargetStatusSchema = z.enum(["conferido", "pago", "cancelado"]);

const positiveIdSchema = z.number().int().positive().safe();
const nonNegativeMoneySchema = z.number().finite().nonnegative();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve usar o formato AAAA-MM-DD").refine(
  (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  },
  "Data invalida",
);
const nullableTextSchema = z.string().trim().min(1).nullable();
const nullableUuidSchema = z.string().uuid().nullable();
const timestampSchema = z.string().datetime({ offset: true });

export const professionalPaymentCreateSchema = z.object({
  professionalId: positiveIdSchema,
  unitId: positiveIdSchema.nullable().default(null),
  referenceDate: dateSchema,
  referenceDescription: nullableTextSchema.default(null),
  totalProcedures: z.number().int().nonnegative().max(2_147_483_647).default(0),
  totalValue: nonNegativeMoneySchema,
  totalReceived: nonNegativeMoneySchema.default(0),
  remunerationType: remunerationTypeSchema.default("PERCENTAGE"),
  percentage: z.number().finite().min(0).max(100).default(0),
  observation: nullableTextSchema.default(null),
}).strict().superRefine((value, context) => {
  if (value.totalReceived > value.totalValue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalReceived"],
      message: "O total recebido nao pode exceder o total do repasse",
    });
  }
});

export const professionalPaymentListFiltersSchema = z.object({
  professionalId: positiveIdSchema.optional(),
  unitId: positiveIdSchema.optional(),
  status: professionalPaymentStatusSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  referenceFrom: dateSchema.optional(),
  referenceTo: dateSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
}).strict().refine(
  ({ referenceFrom, referenceTo }) => !referenceFrom || !referenceTo || referenceFrom <= referenceTo,
  { path: ["referenceTo"], message: "Intervalo de referencia invalido" },
);

const commonRpcRowSchema = z.object({
  id: positiveIdSchema,
  company_id: z.string().uuid(),
  professional_id: positiveIdSchema,
  unit_id: positiveIdSchema.nullable(),
  reference_date: dateSchema,
  reference_description: z.string().nullable(),
  total_procedures: z.number().int().nonnegative(),
  total_value: nonNegativeMoneySchema,
  total_received: nonNegativeMoneySchema,
  remuneration_type: remunerationTypeSchema,
  percentage: z.number().finite().min(0).max(100),
  status: professionalPaymentStatusSchema,
  paid_on: dateSchema.nullable(),
  observation: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  created_by: nullableUuidSchema,
  updated_by: nullableUuidSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict();

const createRpcRowSchema = commonRpcRowSchema.extend({
  idempotent_replay: z.boolean(),
}).strict();

const listRpcRowSchema = commonRpcRowSchema.extend({
  professional_name: z.string().trim().min(1),
  unit_name: z.string().nullable(),
  total_count: z.number().int().nonnegative().safe(),
}).strict();

const transitionRpcRowSchema = z.object({
  id: positiveIdSchema,
  company_id: z.string().uuid(),
  professional_id: positiveIdSchema,
  unit_id: positiveIdSchema.nullable(),
  reference_date: dateSchema,
  status: professionalPaymentStatusSchema,
  paid_on: dateSchema.nullable(),
  cancel_reason: z.string().nullable(),
  updated_by: z.string().uuid(),
  updated_at: timestampSchema,
  idempotent_replay: z.boolean(),
}).strict();

const normalizedCommonPaymentSchema = z.object({
  id: positiveIdSchema,
  companyId: z.string().uuid(),
  professionalId: positiveIdSchema,
  professionalName: z.string().trim().min(1).nullable(),
  unitId: positiveIdSchema.nullable(),
  unitName: z.string().trim().min(1).nullable(),
  referenceDate: dateSchema,
  referenceDescription: z.string().nullable(),
  totalProcedures: z.number().int().nonnegative(),
  totalValue: nonNegativeMoneySchema,
  totalReceived: nonNegativeMoneySchema,
  remunerationType: remunerationTypeSchema,
  percentage: z.number().finite().min(0).max(100),
  status: professionalPaymentStatusSchema,
  paidOn: dateSchema.nullable(),
  observation: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdBy: nullableUuidSchema,
  updatedBy: nullableUuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  totalCount: z.number().int().nonnegative().safe().nullable(),
  idempotentReplay: z.boolean().nullable(),
}).strict();

const normalizedListPaymentSchema = normalizedCommonPaymentSchema.extend({
  professionalName: z.string().trim().min(1),
  totalCount: z.number().int().nonnegative().safe(),
  idempotentReplay: z.null(),
}).strict();

const normalizedCreatePaymentSchema = normalizedCommonPaymentSchema.extend({
  professionalName: z.null(),
  unitName: z.null(),
  totalCount: z.null(),
  idempotentReplay: z.boolean(),
}).strict();

const normalizedTransitionSchema = z.object({
  id: positiveIdSchema,
  status: professionalPaymentStatusSchema,
  paidOn: dateSchema.nullable(),
  cancelReason: z.string().nullable(),
  updatedBy: z.string().uuid(),
  updatedAt: timestampSchema,
  idempotentReplay: z.boolean(),
}).strict();

export type ProfessionalPaymentStatus = z.infer<typeof professionalPaymentStatusSchema>;
export type ProfessionalPaymentTargetStatus = z.infer<typeof professionalPaymentTargetStatusSchema>;
export type ProfessionalPaymentCreateInput = z.input<typeof professionalPaymentCreateSchema>;
export type ProfessionalPaymentListFilters = z.input<typeof professionalPaymentListFiltersSchema>;

export interface ProfessionalPayment {
  id: number;
  companyId: string;
  professionalId: number;
  professionalName: string | null;
  unitId: number | null;
  unitName: string | null;
  referenceDate: string;
  referenceDescription: string | null;
  totalProcedures: number;
  totalValue: number;
  totalReceived: number;
  remunerationType: z.infer<typeof remunerationTypeSchema>;
  percentage: number;
  status: ProfessionalPaymentStatus;
  paidOn: string | null;
  observation: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  totalCount: number | null;
  idempotentReplay: boolean | null;
}

export interface ProfessionalPaymentTransition {
  id: number;
  status: ProfessionalPaymentStatus;
  paidOn: string | null;
  cancelReason: string | null;
  updatedBy: string;
  updatedAt: string;
  idempotentReplay: boolean;
}

export interface ProfessionalPaymentTransitionOptions {
  reason?: string | null;
  paymentDate?: string | null;
  idempotencyKey?: string;
}

const pendingCreateKeys = new Map<string, string>();
const pendingTransitionKeys = new Map<string, string>();

export function createProfessionalPaymentIntentKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Nao foi possivel gerar uma chave de idempotencia segura");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function todayInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function requireRpcRows(data: unknown, operation: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === "object") return [data];
  throw new Error(`${operation}: resposta RPC invalida`);
}

function mapCommonRow(
  row: z.infer<typeof commonRpcRowSchema>,
  details: { professionalName: string | null; unitName: string | null; totalCount: number | null; idempotentReplay: boolean | null },
): ProfessionalPayment {
  return {
    id: row.id,
    companyId: row.company_id,
    professionalId: row.professional_id,
    professionalName: details.professionalName,
    unitId: row.unit_id,
    unitName: details.unitName,
    referenceDate: row.reference_date,
    referenceDescription: row.reference_description,
    totalProcedures: row.total_procedures,
    totalValue: row.total_value,
    totalReceived: row.total_received,
    remunerationType: row.remuneration_type,
    percentage: row.percentage,
    status: row.status,
    paidOn: row.paid_on,
    observation: row.observation,
    cancelReason: row.cancel_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: details.totalCount,
    idempotentReplay: details.idempotentReplay,
  };
}

function parseListRows(data: unknown): ProfessionalPayment[] {
  return requireRpcRows(data, "Erro ao listar repasses").map((candidate) => {
    const raw = listRpcRowSchema.safeParse(candidate);
    if (raw.success) {
      return mapCommonRow(raw.data, {
        professionalName: raw.data.professional_name,
        unitName: raw.data.unit_name,
        totalCount: raw.data.total_count,
        idempotentReplay: null,
      });
    }

    const normalized = normalizedListPaymentSchema.safeParse(candidate);
    if (normalized.success) return normalized.data as ProfessionalPayment;
    throw new Error("Erro ao listar repasses: resposta RPC invalida");
  });
}

function parseCreatedPayment(data: unknown): ProfessionalPayment {
  const rows = requireRpcRows(data, "Erro ao criar repasse");
  if (rows.length !== 1) throw new Error("Erro ao criar repasse: resposta RPC invalida");

  const raw = createRpcRowSchema.safeParse(rows[0]);
  if (raw.success) {
    return mapCommonRow(raw.data, {
      professionalName: null,
      unitName: null,
      totalCount: null,
      idempotentReplay: raw.data.idempotent_replay,
    });
  }

  const normalized = normalizedCreatePaymentSchema.safeParse(rows[0]);
  if (normalized.success) return normalized.data as ProfessionalPayment;
  throw new Error("Erro ao criar repasse: resposta RPC invalida");
}

function parseTransition(data: unknown): ProfessionalPaymentTransition {
  const rows = requireRpcRows(data, "Erro ao atualizar repasse");
  if (rows.length !== 1) throw new Error("Erro ao atualizar repasse: resposta RPC invalida");

  const raw = transitionRpcRowSchema.safeParse(rows[0]);
  if (raw.success) {
    return {
      id: raw.data.id,
      status: raw.data.status,
      paidOn: raw.data.paid_on,
      cancelReason: raw.data.cancel_reason,
      updatedBy: raw.data.updated_by,
      updatedAt: raw.data.updated_at,
      idempotentReplay: raw.data.idempotent_replay,
    };
  }

  const normalized = normalizedTransitionSchema.safeParse(rows[0]);
  if (normalized.success) return normalized.data as ProfessionalPaymentTransition;
  throw new Error("Erro ao atualizar repasse: resposta RPC invalida");
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const normalized = reason.trim();
  return normalized.length > 0 ? normalized : null;
}

export const professionalPaymentsService = {
  async list(filters: ProfessionalPaymentListFilters = {}): Promise<ProfessionalPayment[]> {
    const parsed = professionalPaymentListFiltersSchema.parse(filters);
    const { data, error } = await supabase.rpc("list_professional_payments", {
      p_professional_id: parsed.professionalId ?? null,
      p_unit_id: parsed.unitId ?? null,
      p_status: parsed.status ?? null,
      p_search: parsed.search ?? null,
      p_reference_from: parsed.referenceFrom ?? null,
      p_reference_to: parsed.referenceTo ?? null,
      p_limit: parsed.limit,
      p_offset: parsed.offset,
    });
    if (error) throw new Error(`Erro ao listar repasses: ${error.message}`);

    return parseListRows(data);
  },

  async create(
    input: ProfessionalPaymentCreateInput,
    idempotencyKey?: string,
  ): Promise<ProfessionalPayment> {
    const parsed = professionalPaymentCreateSchema.parse(input);
    const fingerprint = JSON.stringify(parsed);
    const operationKey = idempotencyKey
      ? z.string().uuid().parse(idempotencyKey)
      : (pendingCreateKeys.get(fingerprint) ?? createProfessionalPaymentIntentKey());
    if (!idempotencyKey) pendingCreateKeys.set(fingerprint, operationKey);

    const { data, error } = await supabase.rpc("create_professional_payment", {
      p_idempotency_key: operationKey,
      p_professional_id: parsed.professionalId,
      p_unit_id: parsed.unitId,
      p_reference_date: parsed.referenceDate,
      p_reference_description: parsed.referenceDescription,
      p_total_procedures: parsed.totalProcedures,
      p_total_value: parsed.totalValue,
      p_total_received: parsed.totalReceived,
      p_remuneration_type: parsed.remunerationType,
      p_percentage: parsed.percentage,
      p_observation: parsed.observation,
    });
    if (error) throw new Error(`Erro ao criar repasse: ${error.message}`);

    const payment = parseCreatedPayment(data);
    pendingCreateKeys.delete(fingerprint);
    return payment;
  },

  async transition(
    paymentId: number,
    targetStatus: ProfessionalPaymentTargetStatus,
    options: ProfessionalPaymentTransitionOptions = {},
  ): Promise<ProfessionalPaymentTransition> {
    const parsedPaymentId = positiveIdSchema.parse(paymentId);
    const parsedTarget = professionalPaymentTargetStatusSchema.parse(targetStatus);
    const reason = normalizeReason(options.reason);
    const paymentDate = options.paymentDate == null ? null : dateSchema.parse(options.paymentDate);

    if (parsedTarget === "cancelado" && !reason) {
      throw new Error("Motivo de cancelamento e obrigatorio");
    }
    if (reason && reason.length > 1000) {
      throw new Error("Motivo de cancelamento excede 1000 caracteres");
    }
    if (parsedTarget !== "cancelado" && reason) {
      throw new Error("Motivo somente e aceito para cancelamento");
    }
    if (parsedTarget !== "pago" && paymentDate) {
      throw new Error("Data de pagamento somente e aceita no estado pago");
    }

    const fingerprint = JSON.stringify([parsedPaymentId, parsedTarget, reason, paymentDate]);
    const operationKey = options.idempotencyKey
      ? z.string().uuid().parse(options.idempotencyKey)
      : (pendingTransitionKeys.get(fingerprint) ?? createProfessionalPaymentIntentKey());
    if (!options.idempotencyKey) pendingTransitionKeys.set(fingerprint, operationKey);

    const { data, error } = await supabase.rpc("transition_professional_payment", {
      p_idempotency_key: operationKey,
      p_payment_id: parsedPaymentId,
      p_target_status: parsedTarget,
      p_reason: reason,
      p_payment_date: paymentDate,
    });
    if (error) throw new Error(`Erro ao atualizar repasse: ${error.message}`);

    const transition = parseTransition(data);
    pendingTransitionKeys.delete(fingerprint);
    return transition;
  },
};

export default professionalPaymentsService;


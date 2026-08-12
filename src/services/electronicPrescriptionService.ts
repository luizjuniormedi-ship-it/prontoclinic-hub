import { supabase } from "@/lib/supabase";
import type {
  ElectronicPrescription,
  ElectronicPrescriptionDraftInput,
  ElectronicPrescriptionItem,
  ElectronicPrescriptionItemInput,
  ElectronicPrescriptionStatus,
  ElectronicPrescriptionTransitionStatus,
  PharmaceuticalReview,
  PharmaceuticalReviewInput,
  PrescriptionListFilters,
  SafetyResolutionAction,
} from "@/types/electronicPrescriptions";

type RpcError = { message: string } | null;
type RpcResult<T> = PromiseLike<{ data: T | null; error: RpcError }>;
type QueryResult<T> = PromiseLike<{ data: T | null; error: RpcError }>;

interface ElectronicPrescriptionQuery extends PromiseLike<{
  data: Record<string, unknown>[] | null;
  error: RpcError;
}> {
  eq(column: string, value: unknown): ElectronicPrescriptionQuery;
  in(column: string, values: readonly unknown[]): ElectronicPrescriptionQuery;
  order(column: string, options?: { ascending?: boolean }): ElectronicPrescriptionQuery;
  maybeSingle(): QueryResult<Record<string, unknown>>;
}

export interface ElectronicPrescriptionClient {
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): RpcResult<T>;
  from(table: string): {
    select(columns: string): ElectronicPrescriptionQuery;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function requiredPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} deve ser um inteiro positivo`);
  return value;
}

function optionalPositiveInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  return requiredPositiveInteger(value, field);
}

function optionalUuid(value: string | null | undefined, field: string): string | null {
  if (value == null || value.trim() === "") return null;
  if (!UUID_PATTERN.test(value.trim())) throw new Error(`${field} inválido`);
  return value.trim();
}

function requiredUuid(value: string, field: string): string {
  const normalized = optionalUuid(value, field);
  if (!normalized) throw new Error(`${field} é obrigatório`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizePrescriptionDraft(
  input: ElectronicPrescriptionDraftInput,
): ElectronicPrescriptionDraftInput {
  return {
    unitId: requiredPositiveInteger(input.unitId, "unitId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    patientId: requiredPositiveInteger(input.patientId, "patientId"),
    prescriberId: requiredPositiveInteger(input.prescriberId, "prescriberId"),
    medicalRecordId: optionalPositiveInteger(input.medicalRecordId, "medicalRecordId"),
    clinicalIndication: optionalText(input.clinicalIndication),
    notes: optionalText(input.notes),
  };
}

export function normalizePrescriptionItem(
  input: ElectronicPrescriptionItemInput,
): ElectronicPrescriptionItemInput {
  const medicationName = input.medicationName.trim();
  if (!medicationName) throw new Error("Descrição do item é obrigatória");
  if (!["medication", "diet", "care", "procedure"].includes(input.itemType)) {
    throw new Error("Tipo de item inválido");
  }

  const dose = input.dose == null ? null : Number(input.dose);
  if (input.itemType === "medication") {
    if (!input.medicationId) throw new Error("Medicamento do catálogo é obrigatório");
    if (!Number.isInteger(input.dispensableQuantity) || Number(input.dispensableQuantity) <= 0) {
      throw new Error("Quantidade dispensável deve ser um inteiro positivo");
    }
    if (!Number.isFinite(dose) || Number(dose) <= 0) throw new Error("Dose deve ser maior que zero");
    if (!optionalText(input.doseUnit)) throw new Error("Unidade da dose é obrigatória");
    if (!optionalText(input.route)) throw new Error("Via é obrigatória");
    if (!optionalText(input.frequencyText)) throw new Error("Frequência é obrigatória");
  }
  if (input.durationDays != null && (!Number.isInteger(input.durationDays) || input.durationDays <= 0)) {
    throw new Error("Duração deve ser um inteiro positivo");
  }
  const scheduleTimes = (input.scheduleTimes ?? []).map((time) => {
    const normalized = time.trim();
    if (!TIME_PATTERN.test(normalized)) throw new Error(`Horário inválido: ${time}`);
    return normalized.length === 5 ? `${normalized}:00` : normalized;
  });
  if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) {
    throw new Error("Fim do tratamento não pode ser anterior ao início");
  }

  return {
    itemType: input.itemType,
    medicationId: optionalPositiveInteger(input.medicationId, "medicationId"),
    dispensableQuantity: optionalPositiveInteger(input.dispensableQuantity, "dispensableQuantity"),
    medicationName,
    activeIngredient: optionalText(input.activeIngredient),
    concentration: optionalText(input.concentration),
    pharmaceuticalForm: optionalText(input.pharmaceuticalForm),
    dose,
    doseUnit: optionalText(input.doseUnit),
    route: optionalText(input.route),
    frequencyText: optionalText(input.frequencyText),
    frequencyIntervalMinutes: optionalPositiveInteger(
      input.frequencyIntervalMinutes,
      "frequencyIntervalMinutes",
    ),
    scheduleTimes,
    durationDays: optionalPositiveInteger(input.durationDays, "durationDays"),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    isPrn: Boolean(input.isPrn),
    maxDailyDose: input.maxDailyDose == null ? null : Number(input.maxDailyDose),
    indication: optionalText(input.indication),
    instructions: optionalText(input.instructions),
    renalAdjustmentNotes: optionalText(input.renalAdjustmentNotes),
    hepaticAdjustmentNotes: optionalText(input.hepaticAdjustmentNotes),
    sortOrder: Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0,
  };
}

function serializeItem(input: ElectronicPrescriptionItemInput): Record<string, unknown> {
  const normalized = normalizePrescriptionItem(input);
  return {
    item_type: normalized.itemType,
    medication_id: normalized.medicationId,
    dispensable_quantity: normalized.dispensableQuantity,
    medication_name: normalized.medicationName,
    active_ingredient: normalized.activeIngredient,
    concentration: normalized.concentration,
    pharmaceutical_form: normalized.pharmaceuticalForm,
    dose: normalized.dose,
    dose_unit: normalized.doseUnit,
    route: normalized.route,
    frequency_text: normalized.frequencyText,
    frequency_interval_minutes: normalized.frequencyIntervalMinutes,
    schedule_times: normalized.scheduleTimes,
    duration_days: normalized.durationDays,
    starts_at: normalized.startsAt,
    ends_at: normalized.endsAt,
    is_prn: normalized.isPrn,
    max_daily_dose: normalized.maxDailyDose,
    indication: normalized.indication,
    instructions: normalized.instructions,
    renal_adjustment_notes: normalized.renalAdjustmentNotes,
    hepatic_adjustment_notes: normalized.hepaticAdjustmentNotes,
    sort_order: normalized.sortOrder,
  };
}

function hydratePrescription(row: Record<string, unknown>): ElectronicPrescription {
  return {
    ...(row as unknown as ElectronicPrescription),
    items: (row.electronic_prescription_items ?? row.items ?? []) as ElectronicPrescription["items"],
    safety_events: (row.prescription_safety_events ?? row.safety_events ?? []) as ElectronicPrescription["safety_events"],
    pharmaceutical_reviews: (row.pharmaceutical_reviews ?? []) as ElectronicPrescription["pharmaceutical_reviews"],
    versions: (row.electronic_prescription_versions ?? row.versions ?? []) as ElectronicPrescription["versions"],
  };
}

function unwrapRpc<T>(result: { data: T | null; error: RpcError }, action: string): T {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${action}: resposta vazia`);
  return result.data;
}

export function createElectronicPrescriptionService(
  client: ElectronicPrescriptionClient = supabase as unknown as ElectronicPrescriptionClient,
) {
  return {
    async list(filters: PrescriptionListFilters = {}): Promise<ElectronicPrescription[]> {
      let query = client
        .from("electronic_prescriptions")
        .select(
          "*, electronic_prescription_items(*), prescription_safety_events(*), pharmaceutical_reviews(*), electronic_prescription_versions(*)",
        );
      if (filters.patientId != null) {
        query = query.eq("patient_id", requiredPositiveInteger(filters.patientId, "patientId"));
      }
      if (filters.encounterId) {
        query = query.eq("encounter_id", requiredUuid(filters.encounterId, "encounterId"));
      }
      if (filters.statuses?.length) {
        query = query.in("status", filters.statuses);
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw new Error(`Erro ao listar prescrições: ${error.message}`);
      return (data ?? []).map((row: Record<string, unknown>) => hydratePrescription(row));
    },

    async getById(id: string): Promise<ElectronicPrescription | null> {
      const query = client
        .from("electronic_prescriptions")
        .select(
          "*, electronic_prescription_items(*), prescription_safety_events(*), pharmaceutical_reviews(*), electronic_prescription_versions(*)",
        );
      const { data, error } = await query.eq("id", requiredUuid(id, "prescriptionId")).maybeSingle();
      if (error) throw new Error(`Erro ao carregar prescrição: ${error.message}`);
      return data ? hydratePrescription(data) : null;
    },

    async create(input: ElectronicPrescriptionDraftInput): Promise<ElectronicPrescription> {
      const normalized = normalizePrescriptionDraft(input);
      const result = await client.rpc<ElectronicPrescription>("m20_create_prescription_secure", {
        p_unit_id: normalized.unitId,
        p_encounter_id: normalized.encounterId,
        p_patient_id: normalized.patientId,
        p_prescriber_id: normalized.prescriberId,
        p_medical_record_id: normalized.medicalRecordId,
        p_clinical_indication: normalized.clinicalIndication,
        p_notes: normalized.notes,
      });
      return hydratePrescription(
        unwrapRpc(result, "Erro ao criar prescrição") as unknown as Record<string, unknown>,
      );
    },

    async upsertItem(
      prescriptionId: string,
      input: ElectronicPrescriptionItemInput,
      itemId?: string | null,
    ): Promise<ElectronicPrescriptionItem> {
      const result = await client.rpc<ElectronicPrescriptionItem>(
        "m20_upsert_prescription_item_secure",
        {
          p_prescription_id: requiredUuid(prescriptionId, "prescriptionId"),
          p_item: serializeItem(input),
          p_item_id: optionalUuid(itemId, "itemId"),
        },
      );
      return unwrapRpc(result, "Erro ao salvar item");
    },

    async removeItem(prescriptionId: string, itemId: string): Promise<ElectronicPrescription> {
      const result = await client.rpc<ElectronicPrescription>(
        "m20_remove_prescription_item_secure",
        {
          p_prescription_id: requiredUuid(prescriptionId, "prescriptionId"),
          p_item_id: requiredUuid(itemId, "itemId"),
        },
      );
      return hydratePrescription(
        unwrapRpc(result, "Erro ao remover item") as unknown as Record<string, unknown>,
      );
    },

    async validate(prescriptionId: string): Promise<ElectronicPrescription> {
      const result = await client.rpc<ElectronicPrescription>(
        "m20_validate_prescription_secure",
        { p_prescription_id: requiredUuid(prescriptionId, "prescriptionId") },
      );
      return hydratePrescription(
        unwrapRpc(result, "Erro ao validar prescrição") as unknown as Record<string, unknown>,
      );
    },

    async resolveSafetyEvent(
      eventId: string,
      action: SafetyResolutionAction,
      reason: string,
    ): Promise<ElectronicPrescription> {
      if (!["acknowledged", "overridden", "resolved"].includes(action)) {
        throw new Error("Ação de segurança inválida");
      }
      const normalizedReason = reason.trim();
      if (!normalizedReason) throw new Error("Justificativa é obrigatória");
      const result = await client.rpc<ElectronicPrescription>(
        "m20_resolve_safety_event_secure",
        {
          p_event_id: requiredUuid(eventId, "eventId"),
          p_action: action,
          p_reason: normalizedReason,
        },
      );
      return hydratePrescription(
        unwrapRpc(result, "Erro ao tratar alerta") as unknown as Record<string, unknown>,
      );
    },

    async recordPharmaceuticalReview(input: PharmaceuticalReviewInput): Promise<PharmaceuticalReview> {
      const notes = optionalText(input.notes);
      if (input.reviewStatus !== "approved" && !notes) throw new Error("Parecer é obrigatório");
      const result = await client.rpc<PharmaceuticalReview>(
        "m20_record_pharmaceutical_review_secure",
        {
          p_prescription_id: requiredUuid(input.prescriptionId, "prescriptionId"),
          p_review_status: input.reviewStatus,
          p_notes: notes,
          p_reviewer_professional_id: optionalPositiveInteger(
            input.reviewerProfessionalId,
            "reviewerProfessionalId",
          ),
        },
      );
      return unwrapRpc(result, "Erro ao registrar revisão farmacêutica");
    },

    async transition(
      prescriptionId: string,
      targetStatus: ElectronicPrescriptionTransitionStatus,
      reason?: string | null,
    ): Promise<ElectronicPrescription> {
      if (!["signed", "active", "suspended", "cancelled", "completed", "expired"].includes(targetStatus)) {
        throw new Error("Transição de estado inválida");
      }
      const normalizedReason = optionalText(reason);
      if (["suspended", "cancelled"].includes(targetStatus) && !normalizedReason) {
        throw new Error("Motivo é obrigatório");
      }
      const result = await client.rpc<ElectronicPrescription>(
        "m20_transition_prescription_secure",
        {
          p_prescription_id: requiredUuid(prescriptionId, "prescriptionId"),
          p_target_status: targetStatus,
          p_reason: normalizedReason,
        },
      );
      const prescription = hydratePrescription(
        unwrapRpc(result, "Erro ao alterar estado") as unknown as Record<string, unknown>,
      );
      if (
        targetStatus === "signed"
        && (!prescription.signature_hash || !prescription.signed_at || !prescription.signed_by)
      ) {
        throw new Error("Erro ao assinar prescrição: atestação do servidor ausente");
      }
      return prescription;
    },

    async sign(prescriptionId: string): Promise<ElectronicPrescription> {
      return this.transition(prescriptionId, "signed");
    },
  };
}

export const electronicPrescriptionService = createElectronicPrescriptionService();

export function canEditPrescription(status: ElectronicPrescriptionStatus): boolean {
  return status === "draft" || status === "validated";
}

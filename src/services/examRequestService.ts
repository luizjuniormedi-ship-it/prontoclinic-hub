import { supabase } from "@/lib/supabase";
import {
  EXAM_DOMAINS,
  type CreateExamRequestInput,
  type DispatchExamRequestItemInput,
  type ExamRequest,
  type ExamRequestDispatch,
  type ExamRequestEvent,
  type ExamRequestFilters,
  type ExamRequestItem,
  type TransitionExamRequestItemInput,
} from "@/types/examRequests";

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} deve ser um inteiro positivo`);
  }
}

function optionalText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function validateCreateExamRequest(input: CreateExamRequestInput): void {
  requirePositiveInteger(input.unitId, "unitId");
  requirePositiveInteger(input.patientId, "patientId");
  requirePositiveInteger(input.requesterProfessionalId, "requesterProfessionalId");

  if (!input.clinicalIndication.trim()) {
    throw new Error("Indicação clínica é obrigatória");
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) {
    throw new Error("Informe entre 1 e 50 itens de exame");
  }

  input.items.forEach((item, index) => {
    if (!EXAM_DOMAINS.includes(item.domain)) {
      throw new Error(`Domínio inválido no item ${index + 1}`);
    }
    if (!item.description.trim()) {
      throw new Error(`Descrição é obrigatória no item ${index + 1}`);
    }
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error(`Quantidade inválida no item ${index + 1}`);
    }
    if (item.preparationRequired && !optionalText(item.preparationInstructions)) {
      throw new Error(`Instruções de preparo são obrigatórias no item ${index + 1}`);
    }
  });
}

export function validateDispatchInput(input: DispatchExamRequestItemInput): void {
  if (!input.requestItemId.trim()) {
    throw new Error("requestItemId é obrigatório");
  }
  if (input.executorKind === "LIS") {
    requirePositiveInteger(input.labOrderId ?? 0, "labOrderId");
    requirePositiveInteger(input.labOrderItemId ?? 0, "labOrderItemId");
  }
  if (input.executorKind === "DICOM") {
    if (!optionalText(input.imagingOrderId) || !optionalText(input.imagingOrderItemId)) {
      throw new Error("imagingOrderId e imagingOrderItemId são obrigatórios para DICOM");
    }
  }
}

export const examRequestService = {
  async list(filters: ExamRequestFilters = {}): Promise<ExamRequest[]> {
    let query = supabase
      .from("exam_requests")
      .select("*, exam_request_items(*)")
      .order("created_at", { ascending: false });

    if (filters.unitId) query = query.eq("unit_id", filters.unitId);
    if (filters.patientId) query = query.eq("patient_id", filters.patientId);
    if (filters.status) query = query.eq("status", filters.status);

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao buscar requisições de exames: ${error.message}`);
    return (data ?? []) as ExamRequest[];
  },

  async getById(id: string): Promise<ExamRequest | null> {
    if (!id.trim()) throw new Error("id é obrigatório");
    const { data, error } = await supabase
      .from("exam_requests")
      .select("*, exam_request_items(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro ao buscar requisição de exames: ${error.message}`);
    return data as ExamRequest | null;
  },

  async listEvents(requestId: string): Promise<ExamRequestEvent[]> {
    if (!requestId.trim()) throw new Error("requestId é obrigatório");
    const { data, error } = await supabase
      .from("exam_request_events")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Erro ao buscar histórico da requisição: ${error.message}`);
    return (data ?? []) as ExamRequestEvent[];
  },

  async listDispatches(requestId: string): Promise<ExamRequestDispatch[]> {
    if (!requestId.trim()) throw new Error("requestId é obrigatório");
    const { data, error } = await supabase
      .from("exam_request_dispatches")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Erro ao buscar despachos da requisição: ${error.message}`);
    return (data ?? []) as ExamRequestDispatch[];
  },

  async create(input: CreateExamRequestInput): Promise<ExamRequest> {
    validateCreateExamRequest(input);
    const { data, error } = await supabase.rpc("m22_create_exam_request_secure", {
      p_unit_id: input.unitId,
      p_patient_id: input.patientId,
      p_encounter_id: optionalText(input.encounterId),
      p_appointment_id: input.appointmentId ?? null,
      p_requester_professional_id: input.requesterProfessionalId,
      p_clinical_indication: input.clinicalIndication.trim(),
      p_diagnosis_code: optionalText(input.diagnosisCode),
      p_priority: input.priority ?? "ROUTINE",
      p_items: input.items.map((item) => ({
        domain: item.domain,
        code_system: item.codeSystem ?? "LOCAL",
        catalog_code: optionalText(item.catalogCode),
        description: item.description.trim(),
        quantity: item.quantity ?? 1,
        preparation_required: item.preparationRequired ?? false,
        preparation_instructions: optionalText(item.preparationInstructions),
        authorization_required: item.authorizationRequired ?? false,
        authorization_id: optionalText(item.authorizationId),
        tiss_guide_id: optionalText(item.tissGuideId),
        details: item.details ?? {},
      })),
      p_idempotency_key: optionalText(input.idempotencyKey),
    });
    if (error) throw new Error(`Erro ao criar requisição de exames: ${error.message}`);
    return data as ExamRequest;
  },

  async sign(requestId: string): Promise<ExamRequest> {
    if (!requestId.trim()) throw new Error("requestId é obrigatório");
    const { data, error } = await supabase.rpc("m22_sign_exam_request_secure", {
      p_request_id: requestId,
    });
    if (error) throw new Error(`Erro ao assinar requisição de exames: ${error.message}`);
    return data as ExamRequest;
  },

  async dispatch(input: DispatchExamRequestItemInput): Promise<ExamRequestDispatch> {
    validateDispatchInput(input);
    const { data, error } = await supabase.rpc("m22_dispatch_exam_request_item_secure", {
      p_request_item_id: input.requestItemId,
      p_executor_kind: input.executorKind,
      p_lab_order_id: input.labOrderId ?? null,
      p_lab_order_item_id: input.labOrderItemId ?? null,
      p_imaging_order_id: optionalText(input.imagingOrderId),
      p_imaging_order_item_id: optionalText(input.imagingOrderItemId),
      p_metadata: input.metadata ?? {},
    });
    if (error) throw new Error(`Erro ao despachar item de exame: ${error.message}`);
    return data as ExamRequestDispatch;
  },

  async transition(input: TransitionExamRequestItemInput): Promise<ExamRequestItem> {
    if (!input.requestItemId.trim()) throw new Error("requestItemId é obrigatório");
    if (
      (input.toStatus === "FAILED" || input.toStatus === "CANCELLED")
      && !optionalText(input.reason)
    ) {
      throw new Error("Motivo é obrigatório para falha ou cancelamento");
    }
    const { data, error } = await supabase.rpc("m22_transition_exam_request_item_secure", {
      p_request_item_id: input.requestItemId,
      p_to_status: input.toStatus,
      p_reason: optionalText(input.reason),
    });
    if (error) throw new Error(`Erro ao transicionar item de exame: ${error.message}`);
    return data as ExamRequestItem;
  },

  async cancel(requestId: string, reason: string): Promise<ExamRequest> {
    if (!requestId.trim()) throw new Error("requestId é obrigatório");
    if (!reason.trim()) throw new Error("Motivo do cancelamento é obrigatório");
    const { data, error } = await supabase.rpc("m22_cancel_exam_request_secure", {
      p_request_id: requestId,
      p_reason: reason.trim(),
    });
    if (error) throw new Error(`Erro ao cancelar requisição de exames: ${error.message}`);
    return data as ExamRequest;
  },
};

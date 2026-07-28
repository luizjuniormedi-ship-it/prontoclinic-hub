import { supabase } from "@/lib/supabase";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export interface ExamCatalogPayload extends JsonObject {
  ds_exame: string;
  ds_sigla: string;
  cd_tuss?: string | null;
  cd_loinc?: string | null;
  ds_categoria?: string | null;
  ds_metodo?: string | null;
  ds_material?: string | null;
  tp_tubo?: string | null;
  nr_prazo_dias?: number | null;
  vl_particular?: number | null;
  vl_convenio?: number | null;
  vl_critico_minimo?: number | null;
  vl_critico_maximo?: number | null;
  preparo_instrucoes?: string | null;
  lg_ativo?: boolean;
}

export interface EquipmentPayload extends JsonObject {
  code: string;
  name: string;
  integration_kind?: "MANUAL" | "HL7" | "ASTM" | "API";
  status?: "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "ERROR";
  metadata?: JsonObject;
  active?: boolean;
}

export interface ReferenceRangePayload extends JsonObject {
  parameter: string;
  minimumValue?: number | null;
  maximumValue?: number | null;
  unit?: string | null;
  sex: "M" | "F" | "A";
  minimumAge: number;
  maximumAge: number;
  active: boolean;
}

export interface LabOrderItemPayload extends JsonObject {
  exam_id: number;
  notes?: string | null;
  source_exam_request_item_id?: string | null;
}

export interface LabResultPayload extends JsonObject {
  parameter: string;
  numeric_value?: number | null;
  text_value?: string | null;
  unit?: string | null;
  reference_min?: number | null;
  reference_max?: number | null;
  reagent_lot?: string | null;
  note?: string | null;
}

export interface UpsertExamCatalogInput {
  examId?: number | null;
  payload: ExamCatalogPayload;
}

export interface UpsertEquipmentInput {
  equipmentId?: string | null;
  unitId: number;
  payload: EquipmentPayload;
}

export interface UpsertReferenceRangeInput {
  referenceId?: number | null;
  examId: number;
  payload: ReferenceRangePayload;
}

export interface CreateLabOrderInput {
  unitId: number;
  patientId: number;
  professionalId: number;
  appointmentId?: number | null;
  priority: string;
  clinicalHypothesis?: string | null;
  notes?: string | null;
  items: LabOrderItemPayload[];
}

export interface CollectSpecimenInput {
  orderId: number;
  specimenType: string;
  containerType: string;
  orderItemIds: number[];
  accessionNumber?: string | null;
}

export interface TransitionSpecimenInput {
  specimenId: string;
  status: string;
  reason?: string | null;
}

export interface RecordQcRunInput {
  equipmentId: string;
  controlName: string;
  controlLot: string;
  controlLevel: string;
  measuredValue: number;
  targetValue: number;
  minimumValue: number;
  maximumValue: number;
  notes?: string | null;
}

export interface RecordResultsInput {
  orderItemId: number;
  results: LabResultPayload[];
  equipmentId?: string | null;
}

export interface ValidateResultInput {
  orderItemId: number;
  action: string;
  note?: string | null;
}

export interface AcknowledgeCriticalAlertInput {
  alertId: number;
  communicationMethod: string;
  note?: string | null;
}

export interface DeliverOrderInput {
  orderId: number;
  deliveryMethod: string;
  recipient?: string | null;
  metadata?: JsonObject;
}

export interface UpsertExamCatalogResult {
  exam_id: number;
}

export interface UpsertEquipmentResult {
  equipment_id: string;
}

export interface UpsertReferenceRangeResult {
  reference_id: number;
  exam_id: number;
}

export interface CreateLabOrderResult {
  order_id: number;
  item_ids: number[];
}

export interface CollectSpecimenResult {
  specimen_id: string;
  accession_number: string;
  barcode: string;
}

export interface TransitionSpecimenResult {
  specimen_id: string;
  status: string;
}

export interface RecordQcRunResult {
  qc_run_id: string;
  status: string;
}

export interface RecordResultsResult {
  result_ids: number[];
  order_item_id: number;
}

export interface ValidateResultResult {
  order_item_id: number;
  validation_type: string;
  signature_hash: string;
}

export interface AcknowledgeCriticalAlertResult {
  alert_id: number;
  communicated: boolean;
  note: string | null;
}

export interface DeliverOrderResult {
  delivery_id: number;
  order_id: number;
}

interface RpcErrorShape {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

export class LisGatewayError extends Error {
  readonly rpcName: string;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(rpcName: string, error: RpcErrorShape) {
    super(`Falha na operacao LIS ${rpcName}: ${error.message || "erro desconhecido"}`);
    this.name = "LisGatewayError";
    this.rpcName = rpcName;
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

async function invokeRpc<TResult>(
  rpcName: string,
  params: Record<string, unknown>,
): Promise<TResult> {
  try {
    const { data, error } = await supabase.rpc(rpcName, params);

    if (error) {
      throw new LisGatewayError(rpcName, error);
    }

    return data as TResult;
  } catch (error) {
    if (error instanceof LisGatewayError) {
      throw error;
    }

    throw new LisGatewayError(rpcName, {
      message: error instanceof Error ? error.message : "erro inesperado",
    });
  }
}

export function upsertExamCatalog(
  input: UpsertExamCatalogInput,
): Promise<UpsertExamCatalogResult> {
  return invokeRpc("m23_upsert_exam_catalog_secure", {
    p_exam_id: input.examId ?? null,
    p_payload: input.payload,
  });
}

export function upsertEquipment(
  input: UpsertEquipmentInput,
): Promise<UpsertEquipmentResult> {
  return invokeRpc("m23_upsert_equipment_secure", {
    p_equipment_id: input.equipmentId ?? null,
    p_unit_id: input.unitId,
    p_payload: input.payload,
  });
}

export function upsertReferenceRange(
  input: UpsertReferenceRangeInput,
): Promise<UpsertReferenceRangeResult> {
  return invokeRpc("m23_upsert_reference_range_secure", {
    p_reference_id: input.referenceId ?? null,
    p_exam_id: input.examId,
    p_payload: input.payload,
  });
}

export function createLabOrder(
  input: CreateLabOrderInput,
): Promise<CreateLabOrderResult> {
  return invokeRpc("m23_create_lab_order_secure", {
    p_unit_id: input.unitId,
    p_patient_id: input.patientId,
    p_professional_id: input.professionalId,
    p_appointment_id: input.appointmentId ?? null,
    p_priority: input.priority,
    p_clinical_hypothesis: input.clinicalHypothesis ?? null,
    p_notes: input.notes ?? null,
    p_items: input.items,
  });
}

export function collectSpecimen(
  input: CollectSpecimenInput,
): Promise<CollectSpecimenResult> {
  return invokeRpc("m23_collect_specimen_secure", {
    p_order_id: input.orderId,
    p_specimen_type: input.specimenType,
    p_container_type: input.containerType,
    p_order_item_ids: input.orderItemIds,
    p_accession_number: input.accessionNumber ?? null,
  });
}

export function transitionSpecimen(
  input: TransitionSpecimenInput,
): Promise<TransitionSpecimenResult> {
  return invokeRpc("m23_transition_specimen_secure", {
    p_specimen_id: input.specimenId,
    p_status: input.status,
    p_reason: input.reason ?? null,
  });
}

export function recordQcRun(
  input: RecordQcRunInput,
): Promise<RecordQcRunResult> {
  return invokeRpc("m23_record_qc_run_secure", {
    p_equipment_id: input.equipmentId,
    p_control_name: input.controlName,
    p_control_lot: input.controlLot,
    p_control_level: input.controlLevel,
    p_measured_value: input.measuredValue,
    p_target_value: input.targetValue,
    p_minimum_value: input.minimumValue,
    p_maximum_value: input.maximumValue,
    p_notes: input.notes ?? null,
  });
}

export function recordResults(
  input: RecordResultsInput,
): Promise<RecordResultsResult> {
  return invokeRpc("m23_record_results_secure", {
    p_order_item_id: input.orderItemId,
    p_results: input.results,
    p_equipment_id: input.equipmentId ?? null,
  });
}

export function validateResult(
  input: ValidateResultInput,
): Promise<ValidateResultResult> {
  return invokeRpc("m23_validate_result_secure", {
    p_order_item_id: input.orderItemId,
    p_action: input.action,
    p_note: input.note ?? null,
  });
}

export function acknowledgeCriticalAlert(
  input: AcknowledgeCriticalAlertInput,
): Promise<AcknowledgeCriticalAlertResult> {
  return invokeRpc("m23_acknowledge_critical_alert_secure", {
    p_alert_id: input.alertId,
    p_communication_method: input.communicationMethod,
    p_note: input.note ?? null,
  });
}

export function deliverOrder(
  input: DeliverOrderInput,
): Promise<DeliverOrderResult> {
  return invokeRpc("m23_deliver_order_secure", {
    p_order_id: input.orderId,
    p_delivery_method: input.deliveryMethod,
    p_recipient: input.recipient ?? null,
    p_metadata: input.metadata ?? {},
  });
}

export const lisGateway = {
  upsertExamCatalog,
  upsertEquipment,
  upsertReferenceRange,
  createLabOrder,
  collectSpecimen,
  transitionSpecimen,
  recordQcRun,
  recordResults,
  validateResult,
  acknowledgeCriticalAlert,
  deliverOrder,
};

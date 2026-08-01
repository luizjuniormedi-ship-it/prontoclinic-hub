export const EXAM_DOMAINS = [
  "LABORATORY",
  "IMAGING",
  "CARDIOLOGY",
  "ENDOSCOPY",
  "PATHOLOGY",
] as const;

export type ExamDomain = (typeof EXAM_DOMAINS)[number];

export type ExamRequestPriority = "ROUTINE" | "URGENT" | "EMERGENCY";
export type ExamRequestStatus =
  | "DRAFT"
  | "SIGNED"
  | "PARTIALLY_DISPATCHED"
  | "DISPATCHED"
  | "COMPLETED"
  | "CANCELLED";

export type ExamRequestItemStatus =
  | "PENDING"
  | "AUTHORIZATION_PENDING"
  | "READY"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ExamCodeSystem = "LOCAL" | "TUSS" | "LOINC";
export type ExamExecutorKind = "LIS" | "DICOM" | "SPECIALTY";
export type ExamDispatchStatus = "QUEUED" | "ACCEPTED" | "FAILED";

export interface ExamRequestItem {
  id: string;
  company_id: string;
  request_id: string;
  domain: ExamDomain;
  code_system: ExamCodeSystem;
  catalog_code: string | null;
  description: string;
  quantity: number;
  preparation_required: boolean;
  preparation_instructions: string | null;
  authorization_required: boolean;
  authorization_id: string | null;
  tiss_guide_id: string | null;
  details: Record<string, unknown>;
  status: ExamRequestItemStatus;
  failure_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamRequest {
  id: string;
  company_id: string;
  unit_id: number;
  patient_id: number;
  encounter_id: string | null;
  appointment_id: number | null;
  requester_professional_id: number;
  clinical_indication: string;
  diagnosis_code: string | null;
  priority: ExamRequestPriority;
  status: ExamRequestStatus;
  idempotency_key: string | null;
  signed_by: string | null;
  signed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  exam_request_items?: ExamRequestItem[];
}

export interface ExamRequestDispatch {
  id: string;
  company_id: string;
  request_id: string;
  request_item_id: string;
  executor_kind: ExamExecutorKind;
  status: ExamDispatchStatus;
  attempt_number: number;
  lab_order_id: number | null;
  lab_order_item_id: number | null;
  imaging_order_id: string | null;
  imaging_order_item_id: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}

export interface ExamRequestEvent {
  id: string;
  company_id: string;
  request_id: string;
  request_item_id: string | null;
  event_type:
    | "CREATED"
    | "SIGNED"
    | "DISPATCHED"
    | "ITEM_TRANSITIONED"
    | "REQUEST_STATUS_CHANGED"
    | "CANCELLED";
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}

export interface CreateExamRequestItemInput {
  domain: ExamDomain;
  codeSystem?: ExamCodeSystem;
  catalogCode?: string | null;
  description: string;
  quantity?: number;
  preparationRequired?: boolean;
  preparationInstructions?: string | null;
  authorizationRequired?: boolean;
  authorizationId?: string | null;
  tissGuideId?: string | null;
  details?: Record<string, unknown>;
}

export interface CreateExamRequestInput {
  unitId: number;
  patientId: number;
  encounterId?: string | null;
  appointmentId?: number | null;
  requesterProfessionalId: number;
  clinicalIndication: string;
  diagnosisCode?: string | null;
  priority?: ExamRequestPriority;
  items: CreateExamRequestItemInput[];
  idempotencyKey?: string | null;
}

export interface ExamRequestFilters {
  unitId?: number;
  patientId?: number;
  status?: ExamRequestStatus;
}

export interface DispatchExamRequestItemInput {
  requestItemId: string;
  executorKind: ExamExecutorKind;
  labOrderId?: number | null;
  labOrderItemId?: number | null;
  imagingOrderId?: string | null;
  imagingOrderItemId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TransitionExamRequestItemInput {
  requestItemId: string;
  toStatus: ExamRequestItemStatus;
  reason?: string | null;
}

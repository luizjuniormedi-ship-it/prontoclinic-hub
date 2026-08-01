export const ELECTRONIC_PRESCRIPTION_STATUSES = [
  "draft",
  "validated",
  "signed",
  "active",
  "suspended",
  "cancelled",
  "completed",
  "expired",
] as const;

export type ElectronicPrescriptionStatus = (typeof ELECTRONIC_PRESCRIPTION_STATUSES)[number];
export type ElectronicPrescriptionTransitionStatus = Exclude<
  ElectronicPrescriptionStatus,
  "draft" | "validated"
>;
export type PrescriptionItemType = "medication" | "diet" | "care" | "procedure";
export type SafetyEventType = "detected" | "acknowledged" | "overridden" | "resolved";
export type SafetySeverity = "info" | "warning" | "critical";
export type SafetyResolutionAction = "acknowledged" | "overridden" | "resolved";
export type PharmaceuticalReviewStatus = "approved" | "changes_requested" | "rejected";

export interface ElectronicPrescriptionItem {
  id: string;
  company_id: string;
  prescription_id: string;
  item_type: PrescriptionItemType;
  medication_id: number | null;
  medication_name: string;
  active_ingredient: string | null;
  concentration: string | null;
  pharmaceutical_form: string | null;
  dose: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency_text: string | null;
  frequency_interval_minutes: number | null;
  schedule_times: string[];
  duration_days: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_prn: boolean;
  max_daily_dose: number | null;
  indication: string | null;
  instructions: string | null;
  renal_adjustment_notes: string | null;
  hepatic_adjustment_notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionSafetyEvent {
  id: string;
  company_id: string;
  prescription_id: string;
  prescription_item_id: string | null;
  validation_run_id: string;
  related_event_id: string | null;
  event_type: SafetyEventType;
  rule_code: string;
  rule_version: string;
  severity: SafetySeverity;
  title: string;
  details: Record<string, unknown>;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface PharmaceuticalReview {
  id: string;
  company_id: string;
  prescription_id: string;
  review_status: PharmaceuticalReviewStatus;
  notes: string | null;
  reviewer_id: string;
  reviewer_professional_id: number | null;
  created_at: string;
}

export interface ElectronicPrescriptionVersion {
  id: string;
  company_id: string;
  prescription_id: string;
  version_number: number;
  action: string;
  reason: string | null;
  header_snapshot: Record<string, unknown>;
  items_snapshot: ElectronicPrescriptionItem[];
  snapshot_hash: string;
  actor_id: string | null;
  created_at: string;
}

export interface ElectronicPrescription {
  id: string;
  company_id: string;
  unit_id: number;
  encounter_id: string | null;
  patient_id: number;
  prescriber_id: number;
  medical_record_id: number | null;
  root_prescription_id: string | null;
  supersedes_id: string | null;
  current_version: number;
  status: ElectronicPrescriptionStatus;
  clinical_indication: string | null;
  notes: string | null;
  last_validation_run_id: string | null;
  validated_at: string | null;
  signed_at: string | null;
  signed_by: string | null;
  signature_hash: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  expired_at: string | null;
  terminal_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  items: ElectronicPrescriptionItem[];
  safety_events: PrescriptionSafetyEvent[];
  pharmaceutical_reviews: PharmaceuticalReview[];
  versions: ElectronicPrescriptionVersion[];
}

export interface ElectronicPrescriptionDraftInput {
  unitId: number;
  encounterId?: string | null;
  patientId: number;
  prescriberId: number;
  medicalRecordId?: number | null;
  clinicalIndication?: string | null;
  notes?: string | null;
}

export interface ElectronicPrescriptionItemInput {
  itemType: PrescriptionItemType;
  medicationId?: number | null;
  medicationName: string;
  activeIngredient?: string | null;
  concentration?: string | null;
  pharmaceuticalForm?: string | null;
  dose?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  frequencyText?: string | null;
  frequencyIntervalMinutes?: number | null;
  scheduleTimes?: string[];
  durationDays?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isPrn?: boolean;
  maxDailyDose?: number | null;
  indication?: string | null;
  instructions?: string | null;
  renalAdjustmentNotes?: string | null;
  hepaticAdjustmentNotes?: string | null;
  sortOrder?: number;
}

export interface PrescriptionListFilters {
  patientId?: number;
  encounterId?: string;
  statuses?: ElectronicPrescriptionStatus[];
}

export interface PharmaceuticalReviewInput {
  prescriptionId: string;
  reviewStatus: PharmaceuticalReviewStatus;
  notes?: string | null;
  reviewerProfessionalId?: number | null;
}

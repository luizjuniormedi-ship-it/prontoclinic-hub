export type ProtocolDefinitionStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "RETIRED";
export type ProtocolExecutionStatus = "PENDING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type ProtocolStepStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "BLOCKED";
export type ProtocolStepType = "TASK" | "OBSERVATION" | "CHECKLIST" | "ALERT_REVIEW" | "ESCALATION";
export type ProtocolAlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type ProtocolAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type ProtocolEscalationStatus = "REQUESTED" | "ACKNOWLEDGED" | "CLOSED";
export type ProtocolOverrideType = "SKIP_REQUIRED_STEP" | "DEADLINE" | "RESPONSIBILITY" | "OTHER";

export interface CareProtocolStepTemplate {
  key: string;
  sequence: number;
  title: string;
  instructions?: string | null;
  type: ProtocolStepType;
  required: boolean;
  assignedRole?: string | null;
  dueMinutes?: number | null;
}

export interface CareProtocolContent {
  priority: "ROUTINE" | "URGENT" | "IMMEDIATE";
  steps: CareProtocolStepTemplate[];
}

export interface CareProtocolDefinition {
  id: string;
  company_id: string;
  unit_id: number | null;
  code: string;
  name: string;
  category: string;
  description: string | null;
  status: ProtocolDefinitionStatus;
  active_version_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface CareProtocolVersion {
  id: string;
  company_id: string;
  protocol_definition_id: string;
  version_number: number;
  content: CareProtocolContent;
  change_summary: string;
  publication_status: "PUBLISHED";
  created_by: string;
  published_by: string;
  created_at: string;
  published_at: string;
}

export interface CareProtocolExecution {
  id: string;
  company_id: string;
  unit_id: number;
  patient_id: number;
  encounter_id: string | null;
  protocol_definition_id: string;
  protocol_version_id: string;
  status: ProtocolExecutionStatus;
  source_signal_type: string | null;
  source_signal_id: string | null;
  source_signal_payload: Record<string, unknown>;
  assigned_to: string | null;
  started_by: string;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareProtocolExecutionStep {
  id: string;
  company_id: string;
  unit_id: number;
  execution_id: string;
  step_key: string;
  sequence_number: number;
  title: string;
  instructions: string | null;
  step_type: ProtocolStepType;
  required: boolean;
  status: ProtocolStepStatus;
  assigned_role: string | null;
  assigned_to: string | null;
  due_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareProtocolObservation {
  id: string;
  execution_id: string;
  step_id: string | null;
  observation_type: string;
  value: Record<string, unknown>;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface CareProtocolAlert {
  id: string;
  execution_id: string;
  step_id: string | null;
  code: string;
  severity: ProtocolAlertSeverity;
  message: string;
  status: ProtocolAlertStatus;
  raised_by: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareProtocolEscalation {
  id: string;
  execution_id: string;
  alert_id: string | null;
  escalation_level: number;
  target_role: string | null;
  target_user_id: string | null;
  reason: string;
  status: ProtocolEscalationStatus;
  escalated_by: string;
  created_at: string;
  updated_at: string;
}

export interface CareProtocolOverride {
  id: string;
  execution_id: string;
  step_id: string | null;
  override_type: ProtocolOverrideType;
  reason: string;
  previous_value: unknown;
  new_value: unknown;
  authorized_by: string;
  created_at: string;
}

export interface CareProtocolTask {
  id: string;
  execution_id: string;
  step_id: string;
  title: string;
  description: string | null;
  priority: "ROUTINE" | "URGENT" | "IMMEDIATE";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  assigned_role: string | null;
  assigned_to: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareProtocolExecutionBundle {
  execution: CareProtocolExecution;
  steps: CareProtocolExecutionStep[];
  observations: CareProtocolObservation[];
  alerts: CareProtocolAlert[];
  escalations: CareProtocolEscalation[];
  overrides: CareProtocolOverride[];
  tasks: CareProtocolTask[];
}

export interface StartCareProtocolExecutionInput {
  protocolVersionId: string;
  unitId: number;
  patientId: number;
  encounterId?: string | null;
  sourceSignalType?: string | null;
  sourceSignalId?: string | null;
  sourceSignalPayload?: Record<string, unknown>;
  assignedTo?: string | null;
}

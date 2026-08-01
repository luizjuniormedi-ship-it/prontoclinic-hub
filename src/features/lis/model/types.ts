export type IsoDateTime = string;

export type LabOrderStatus =
  | 'requested'
  | 'awaiting_collection'
  | 'partially_collected'
  | 'collected'
  | 'in_processing'
  | 'awaiting_validation'
  | 'validated'
  | 'critical_hold'
  | 'released'
  | 'delivered'
  | 'cancelled';

export type LabOrderPriority = 'routine' | 'urgent' | 'emergency';

export interface LabOrder {
  readonly id: string;
  readonly companyId: string;
  readonly unitId: string;
  readonly patientId: string;
  readonly sourceRequestId?: string;
  readonly status: LabOrderStatus;
  readonly priority: LabOrderPriority;
  readonly requestedAt: IsoDateTime;
  readonly requestedBy: string;
  readonly itemIds: readonly string[];
  readonly specimenIds: readonly string[];
  readonly cancellationReason?: string;
}

export type SpecimenStatus =
  | 'planned'
  | 'collected'
  | 'received'
  | 'accepted'
  | 'rejected'
  | 'processing'
  | 'processed'
  | 'recollection_required'
  | 'disposed';

export interface LabSpecimen {
  readonly id: string;
  readonly orderId: string;
  readonly unitId: string;
  readonly accessionNumber: string;
  readonly containerType: string;
  readonly status: SpecimenStatus;
  readonly collectedAt?: IsoDateTime;
  readonly collectedBy?: string;
  readonly receivedAt?: IsoDateTime;
  readonly receivedBy?: string;
  readonly identificationVerified?: boolean;
  readonly integrityVerified?: boolean;
  readonly rejectionReason?: string;
  readonly processedAt?: IsoDateTime;
  readonly disposedAt?: IsoDateTime;
}

export type QualityControlStatus = 'pending' | 'passed' | 'failed' | 'waived';

export interface QualityControlRecord {
  readonly id: string;
  readonly orderId: string;
  readonly specimenId?: string;
  readonly status: QualityControlStatus;
  readonly checkedAt?: IsoDateTime;
  readonly checkedBy?: string;
  readonly failureReason?: string;
  readonly waiverReason?: string;
  readonly waivedBy?: string;
}

export type ResultEntryStatus = 'draft' | 'entered' | 'corrected';

export interface LabResult {
  readonly id: string;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly analyteCode: string;
  readonly value: string;
  readonly unit?: string;
  readonly entryStatus: ResultEntryStatus;
  readonly enteredAt?: IsoDateTime;
  readonly enteredBy?: string;
  readonly correctedAt?: IsoDateTime;
  readonly correctedBy?: string;
  readonly isCritical: boolean;
}

export type ResultValidationStatus = 'pending' | 'validated' | 'rejected';

export interface ResultValidation {
  readonly id: string;
  readonly orderId: string;
  readonly status: ResultValidationStatus;
  readonly validatorId?: string;
  readonly validatedAt?: IsoDateTime;
  readonly rejectionReason?: string;
}

export type CriticalResultStatus =
  | 'detected'
  | 'acknowledged'
  | 'communicated'
  | 'resolved';

export interface CriticalResultEvent {
  readonly id: string;
  readonly orderId: string;
  readonly resultId: string;
  readonly status: CriticalResultStatus;
  readonly detectedAt: IsoDateTime;
  readonly acknowledgedAt?: IsoDateTime;
  readonly acknowledgedBy?: string;
  readonly communicatedAt?: IsoDateTime;
  readonly communicatedBy?: string;
  readonly communicatedTo?: string;
  readonly resolvedAt?: IsoDateTime;
  readonly resolvedBy?: string;
}

export type ResultDeliveryStatus =
  | 'pending'
  | 'available'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface ResultDelivery {
  readonly id: string;
  readonly orderId: string;
  readonly status: ResultDeliveryStatus;
  readonly channel: 'portal' | 'print' | 'email' | 'integration';
  readonly deliveredAt?: IsoDateTime;
  readonly deliveredBy?: string;
  readonly recipientId?: string;
  readonly failureReason?: string;
}

export interface LabOrderWorkflowSnapshot {
  readonly order: LabOrder;
  readonly specimens: readonly LabSpecimen[];
  readonly qualityControls: readonly QualityControlRecord[];
  readonly results: readonly LabResult[];
  readonly validation?: ResultValidation;
  readonly criticalEvents: readonly CriticalResultEvent[];
  readonly delivery?: ResultDelivery;
}

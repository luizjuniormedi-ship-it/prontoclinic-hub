import type {
  LabOrderStatus,
  LabOrderWorkflowSnapshot,
  LabSpecimen,
  SpecimenStatus,
} from './types';

export type TransitionCode =
  | 'allowed'
  | 'same_status'
  | 'invalid_transition'
  | 'missing_specimen'
  | 'collection_incomplete'
  | 'specimen_not_accepted'
  | 'specimen_not_processed'
  | 'recollection_not_required'
  | 'missing_result'
  | 'result_incomplete'
  | 'quality_control_not_approved'
  | 'validation_not_rejected'
  | 'validation_incomplete'
  | 'segregation_violation'
  | 'critical_result_missing'
  | 'critical_result_unresolved'
  | 'delivery_incomplete'
  | 'cancellation_reason_required'
  | 'collection_metadata_required'
  | 'receipt_metadata_required'
  | 'verification_required'
  | 'rejection_reason_required'
  | 'processing_metadata_required'
  | 'disposal_metadata_required';

export interface TransitionDecision {
  readonly allowed: boolean;
  readonly code: TransitionCode;
}

export const ORDER_TRANSITIONS = {
  requested: ['awaiting_collection', 'cancelled'],
  awaiting_collection: ['partially_collected', 'collected', 'cancelled'],
  partially_collected: ['collected', 'cancelled'],
  collected: ['awaiting_collection', 'in_processing', 'cancelled'],
  in_processing: ['awaiting_collection', 'awaiting_validation', 'cancelled'],
  awaiting_validation: ['in_processing', 'validated', 'cancelled'],
  validated: ['critical_hold', 'released'],
  critical_hold: ['released'],
  released: ['delivered'],
  delivered: [],
  cancelled: [],
} as const satisfies Record<LabOrderStatus, readonly LabOrderStatus[]>;

export const SPECIMEN_TRANSITIONS = {
  planned: ['collected'],
  collected: ['received'],
  received: ['accepted', 'rejected'],
  accepted: ['processing', 'rejected'],
  rejected: ['recollection_required'],
  processing: ['processed', 'rejected'],
  processed: ['disposed'],
  recollection_required: [],
  disposed: [],
} as const satisfies Record<SpecimenStatus, readonly SpecimenStatus[]>;

const collectedSpecimenStatuses = new Set<SpecimenStatus>([
  'collected',
  'received',
  'accepted',
  'processing',
  'processed',
  'disposed',
]);

const acceptedSpecimenStatuses = new Set<SpecimenStatus>([
  'accepted',
  'processing',
  'processed',
  'disposed',
]);

const processedSpecimenStatuses = new Set<SpecimenStatus>(['processed', 'disposed']);

function allow(): TransitionDecision {
  return { allowed: true, code: 'allowed' };
}

function deny(code: Exclude<TransitionCode, 'allowed'>): TransitionDecision {
  return { allowed: false, code };
}

function isOrderTransitionAllowed(from: LabOrderStatus, to: LabOrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] as readonly LabOrderStatus[]).includes(to);
}

function isSpecimenTransitionAllowed(from: SpecimenStatus, to: SpecimenStatus): boolean {
  return (SPECIMEN_TRANSITIONS[from] as readonly SpecimenStatus[]).includes(to);
}

function hasUnresolvedCriticalResult(snapshot: LabOrderWorkflowSnapshot): boolean {
  return snapshot.criticalEvents.some((event) => event.status !== 'resolved');
}

function hasCriticalResult(snapshot: LabOrderWorkflowSnapshot): boolean {
  return (
    snapshot.results.some((result) => result.isCritical) ||
    snapshot.criticalEvents.length > 0
  );
}

function hasApprovedQualityControl(snapshot: LabOrderWorkflowSnapshot): boolean {
  return (
    snapshot.qualityControls.length > 0 &&
    snapshot.qualityControls.every(
      (record) => record.status === 'passed' || record.status === 'waived',
    )
  );
}

function hasSegregatedValidation(snapshot: LabOrderWorkflowSnapshot): boolean {
  const validatorId = snapshot.validation?.validatorId;
  if (!validatorId) {
    return false;
  }

  return snapshot.results.every(
    (result) => result.enteredBy !== validatorId && result.correctedBy !== validatorId,
  );
}

export function canTransitionOrder(
  snapshot: LabOrderWorkflowSnapshot,
  nextStatus: LabOrderStatus,
): TransitionDecision {
  const currentStatus = snapshot.order.status;

  if (currentStatus === nextStatus) {
    return deny('same_status');
  }

  if (!isOrderTransitionAllowed(currentStatus, nextStatus)) {
    return deny('invalid_transition');
  }

  if (nextStatus === 'cancelled' && !snapshot.order.cancellationReason?.trim()) {
    return deny('cancellation_reason_required');
  }

  if (nextStatus === 'awaiting_collection' && currentStatus !== 'requested') {
    const requiresRecollection = snapshot.specimens.some(
      (specimen) => specimen.status === 'recollection_required',
    );
    if (!requiresRecollection) {
      return deny('recollection_not_required');
    }
  }

  if (nextStatus === 'partially_collected') {
    if (snapshot.specimens.length === 0) {
      return deny('missing_specimen');
    }
    const collectedCount = snapshot.specimens.filter((specimen) =>
      collectedSpecimenStatuses.has(specimen.status),
    ).length;
    if (collectedCount === 0 || collectedCount === snapshot.specimens.length) {
      return deny('collection_incomplete');
    }
  }

  if (nextStatus === 'collected') {
    if (snapshot.specimens.length === 0) {
      return deny('missing_specimen');
    }
    if (
      !snapshot.specimens.every((specimen) =>
        collectedSpecimenStatuses.has(specimen.status),
      )
    ) {
      return deny('collection_incomplete');
    }
  }

  if (nextStatus === 'in_processing') {
    if (
      currentStatus === 'awaiting_validation' &&
      snapshot.validation?.status !== 'rejected'
    ) {
      return deny('validation_not_rejected');
    }
    if (
      currentStatus !== 'awaiting_validation' &&
      !snapshot.specimens.every((specimen) =>
        acceptedSpecimenStatuses.has(specimen.status),
      )
    ) {
      return deny('specimen_not_accepted');
    }
  }

  if (nextStatus === 'awaiting_validation') {
    if (
      snapshot.specimens.length === 0 ||
      !snapshot.specimens.every((specimen) =>
        processedSpecimenStatuses.has(specimen.status),
      )
    ) {
      return deny('specimen_not_processed');
    }
    if (snapshot.results.length === 0) {
      return deny('missing_result');
    }
    if (
      snapshot.results.some(
        (result) =>
          result.entryStatus === 'draft' ||
          !result.enteredBy ||
          !result.enteredAt ||
          !result.value.trim(),
      )
    ) {
      return deny('result_incomplete');
    }
    if (!hasApprovedQualityControl(snapshot)) {
      return deny('quality_control_not_approved');
    }
  }

  if (nextStatus === 'validated') {
    if (
      snapshot.validation?.status !== 'validated' ||
      !snapshot.validation.validatorId ||
      !snapshot.validation.validatedAt
    ) {
      return deny('validation_incomplete');
    }
    if (!hasSegregatedValidation(snapshot)) {
      return deny('segregation_violation');
    }
  }

  if (nextStatus === 'critical_hold') {
    if (!hasCriticalResult(snapshot) || !hasUnresolvedCriticalResult(snapshot)) {
      return deny('critical_result_missing');
    }
  }

  if (nextStatus === 'released' && hasCriticalResult(snapshot)) {
    if (snapshot.criticalEvents.length === 0) {
      return deny('critical_result_missing');
    }
    if (hasUnresolvedCriticalResult(snapshot)) {
      return deny('critical_result_unresolved');
    }
  }

  if (nextStatus === 'delivered') {
    if (
      snapshot.delivery?.status !== 'delivered' ||
      !snapshot.delivery.deliveredAt ||
      !snapshot.delivery.recipientId
    ) {
      return deny('delivery_incomplete');
    }
  }

  return allow();
}

export function canTransitionSpecimen(
  specimen: LabSpecimen,
  nextStatus: SpecimenStatus,
  qualityControlStatus?: 'pending' | 'passed' | 'failed' | 'waived',
): TransitionDecision {
  if (specimen.status === nextStatus) {
    return deny('same_status');
  }

  if (!isSpecimenTransitionAllowed(specimen.status, nextStatus)) {
    return deny('invalid_transition');
  }

  if (
    nextStatus === 'collected' &&
    (!specimen.collectedAt || !specimen.collectedBy)
  ) {
    return deny('collection_metadata_required');
  }

  if (nextStatus === 'received' && (!specimen.receivedAt || !specimen.receivedBy)) {
    return deny('receipt_metadata_required');
  }

  if (
    nextStatus === 'accepted' &&
    (!specimen.identificationVerified || !specimen.integrityVerified)
  ) {
    return deny('verification_required');
  }

  if (
    (nextStatus === 'rejected' || nextStatus === 'recollection_required') &&
    !specimen.rejectionReason?.trim()
  ) {
    return deny('rejection_reason_required');
  }

  if (nextStatus === 'processed') {
    if (!specimen.processedAt) {
      return deny('processing_metadata_required');
    }
    if (qualityControlStatus !== 'passed' && qualityControlStatus !== 'waived') {
      return deny('quality_control_not_approved');
    }
  }

  if (nextStatus === 'disposed' && !specimen.disposedAt) {
    return deny('disposal_metadata_required');
  }

  return allow();
}

export function availableOrderTransitions(
  snapshot: LabOrderWorkflowSnapshot,
): readonly LabOrderStatus[] {
  return ORDER_TRANSITIONS[snapshot.order.status].filter(
    (status) => canTransitionOrder(snapshot, status).allowed,
  );
}

export function availableSpecimenTransitions(
  specimen: LabSpecimen,
  qualityControlStatus?: 'pending' | 'passed' | 'failed' | 'waived',
): readonly SpecimenStatus[] {
  return SPECIMEN_TRANSITIONS[specimen.status].filter(
    (status) => canTransitionSpecimen(specimen, status, qualityControlStatus).allowed,
  );
}

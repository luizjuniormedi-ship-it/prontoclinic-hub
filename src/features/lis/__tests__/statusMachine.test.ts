import { describe, expect, it } from 'vitest';

import {
  ORDER_TRANSITIONS,
  SPECIMEN_TRANSITIONS,
  availableOrderTransitions,
  availableSpecimenTransitions,
  canTransitionOrder,
  canTransitionSpecimen,
} from '../model/statusMachine';
import type {
  LabOrderWorkflowSnapshot,
  LabSpecimen,
  SpecimenStatus,
} from '../model/types';

const now = '2026-07-24T12:00:00.000Z';

function specimen(
  overrides: Partial<LabSpecimen> = {},
): LabSpecimen {
  return {
    id: 'specimen-1',
    orderId: 'order-1',
    unitId: 'unit-1',
    accessionNumber: 'ACC-1',
    containerType: 'serum',
    status: 'planned',
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<LabOrderWorkflowSnapshot> = {},
): LabOrderWorkflowSnapshot {
  return {
    order: {
      id: 'order-1',
      companyId: 'company-1',
      unitId: 'unit-1',
      patientId: 'patient-1',
      status: 'requested',
      priority: 'routine',
      requestedAt: now,
      requestedBy: 'requester-1',
      itemIds: ['item-1'],
      specimenIds: ['specimen-1'],
    },
    specimens: [],
    qualityControls: [],
    results: [],
    criticalEvents: [],
    ...overrides,
  };
}

describe('M23 order status machine', () => {
  it('declares every terminal state without outgoing transitions', () => {
    expect(ORDER_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
  });

  it('rejects same-state changes and invalid jumps', () => {
    expect(canTransitionOrder(snapshot(), 'requested')).toEqual({
      allowed: false,
      code: 'same_status',
    });
    expect(canTransitionOrder(snapshot(), 'released')).toEqual({
      allowed: false,
      code: 'invalid_transition',
    });
  });

  it('requires a reason before cancelling an order', () => {
    expect(canTransitionOrder(snapshot(), 'cancelled').code).toBe(
      'cancellation_reason_required',
    );

    const decision = canTransitionOrder(
      snapshot({
        order: {
          ...snapshot().order,
          cancellationReason: 'Duplicate request',
        },
      }),
      'cancelled',
    );
    expect(decision.allowed).toBe(true);
  });

  it('distinguishes partial collection from complete collection', () => {
    const specimens = [
      specimen({ id: 'specimen-1', status: 'collected' }),
      specimen({ id: 'specimen-2', status: 'planned' }),
    ];
    const awaitingCollection = snapshot({
      order: { ...snapshot().order, status: 'awaiting_collection' },
      specimens,
    });

    expect(
      canTransitionOrder(awaitingCollection, 'partially_collected').allowed,
    ).toBe(true);
    expect(canTransitionOrder(awaitingCollection, 'collected').code).toBe(
      'collection_incomplete',
    );

    const complete = {
      ...awaitingCollection,
      specimens: specimens.map((item) => ({ ...item, status: 'received' as const })),
    };
    expect(canTransitionOrder(complete, 'partially_collected').code).toBe(
      'collection_incomplete',
    );
    expect(canTransitionOrder(complete, 'collected').allowed).toBe(true);
  });

  it('only reopens collection when a specimen needs recollection', () => {
    const collected = snapshot({
      order: { ...snapshot().order, status: 'collected' },
      specimens: [specimen({ status: 'accepted' })],
    });
    expect(canTransitionOrder(collected, 'awaiting_collection').code).toBe(
      'recollection_not_required',
    );

    const recollection = {
      ...collected,
      specimens: [specimen({ status: 'recollection_required' })],
    };
    expect(canTransitionOrder(recollection, 'awaiting_collection').allowed).toBe(
      true,
    );
  });

  it('requires accepted specimens before processing', () => {
    const collected = snapshot({
      order: { ...snapshot().order, status: 'collected' },
      specimens: [specimen({ status: 'received' })],
    });
    expect(canTransitionOrder(collected, 'in_processing').code).toBe(
      'specimen_not_accepted',
    );

    const accepted = {
      ...collected,
      specimens: [specimen({ status: 'accepted' })],
    };
    expect(canTransitionOrder(accepted, 'in_processing').allowed).toBe(true);
  });

  it('requires processed specimens, complete results and approved QC', () => {
    const processing = snapshot({
      order: { ...snapshot().order, status: 'in_processing' },
      specimens: [specimen({ status: 'processing' })],
    });
    expect(canTransitionOrder(processing, 'awaiting_validation').code).toBe(
      'specimen_not_processed',
    );

    const processed = {
      ...processing,
      specimens: [specimen({ status: 'processed' })],
    };
    expect(canTransitionOrder(processed, 'awaiting_validation').code).toBe(
      'missing_result',
    );

    const withDraft = {
      ...processed,
      results: [
        {
          id: 'result-1',
          orderId: 'order-1',
          orderItemId: 'item-1',
          analyteCode: 'HB',
          value: '',
          entryStatus: 'draft' as const,
          isCritical: false,
        },
      ],
    };
    expect(canTransitionOrder(withDraft, 'awaiting_validation').code).toBe(
      'result_incomplete',
    );

    const completeResult = {
      ...withDraft,
      results: [
        {
          ...withDraft.results[0],
          value: '13.2',
          entryStatus: 'entered' as const,
          enteredBy: 'operator-1',
          enteredAt: now,
        },
      ],
    };
    expect(canTransitionOrder(completeResult, 'awaiting_validation').code).toBe(
      'quality_control_not_approved',
    );

    const approved = {
      ...completeResult,
      qualityControls: [
        {
          id: 'qc-1',
          orderId: 'order-1',
          status: 'passed' as const,
          checkedAt: now,
          checkedBy: 'qc-1',
        },
      ],
    };
    expect(canTransitionOrder(approved, 'awaiting_validation').allowed).toBe(true);
  });

  it('requires rejected validation before returning to processing', () => {
    const awaitingValidation = snapshot({
      order: { ...snapshot().order, status: 'awaiting_validation' },
    });
    expect(canTransitionOrder(awaitingValidation, 'in_processing').code).toBe(
      'validation_not_rejected',
    );

    const rejected = {
      ...awaitingValidation,
      validation: {
        id: 'validation-1',
        orderId: 'order-1',
        status: 'rejected' as const,
        rejectionReason: 'Repeat analysis',
      },
    };
    expect(canTransitionOrder(rejected, 'in_processing').allowed).toBe(true);
  });

  it('enforces digitizer and validator segregation', () => {
    const base = snapshot({
      order: { ...snapshot().order, status: 'awaiting_validation' },
      results: [
        {
          id: 'result-1',
          orderId: 'order-1',
          orderItemId: 'item-1',
          analyteCode: 'HB',
          value: '13.2',
          entryStatus: 'entered',
          enteredBy: 'operator-1',
          enteredAt: now,
          isCritical: false,
        },
      ],
      validation: {
        id: 'validation-1',
        orderId: 'order-1',
        status: 'validated',
        validatorId: 'operator-1',
        validatedAt: now,
      },
    });
    expect(canTransitionOrder(base, 'validated').code).toBe(
      'segregation_violation',
    );

    const segregated = {
      ...base,
      validation: { ...base.validation!, validatorId: 'validator-1' },
    };
    expect(canTransitionOrder(segregated, 'validated').allowed).toBe(true);
  });

  it('holds critical results until every event is resolved', () => {
    const validated = snapshot({
      order: { ...snapshot().order, status: 'validated' },
      results: [
        {
          id: 'result-1',
          orderId: 'order-1',
          orderItemId: 'item-1',
          analyteCode: 'K',
          value: '7.1',
          entryStatus: 'entered',
          enteredBy: 'operator-1',
          enteredAt: now,
          isCritical: true,
        },
      ],
      criticalEvents: [
        {
          id: 'critical-1',
          orderId: 'order-1',
          resultId: 'result-1',
          status: 'detected',
          detectedAt: now,
        },
      ],
    });

    expect(canTransitionOrder(validated, 'critical_hold').allowed).toBe(true);
    expect(canTransitionOrder(validated, 'released').code).toBe(
      'critical_result_unresolved',
    );

    const resolved = {
      ...validated,
      criticalEvents: [
        {
          ...validated.criticalEvents[0],
          status: 'resolved' as const,
          resolvedAt: now,
          resolvedBy: 'doctor-1',
        },
      ],
    };
    expect(canTransitionOrder(resolved, 'released').allowed).toBe(true);
  });

  it('does not release a critical result without a tracked critical event', () => {
    const validated = snapshot({
      order: { ...snapshot().order, status: 'validated' },
      results: [
        {
          id: 'result-1',
          orderId: 'order-1',
          orderItemId: 'item-1',
          analyteCode: 'K',
          value: '7.1',
          entryStatus: 'entered',
          enteredBy: 'operator-1',
          enteredAt: now,
          isCritical: true,
        },
      ],
    });

    expect(canTransitionOrder(validated, 'released')).toEqual({
      allowed: false,
      code: 'critical_result_missing',
    });
  });

  it('requires proof of delivery before closing the workflow', () => {
    const released = snapshot({
      order: { ...snapshot().order, status: 'released' },
      delivery: {
        id: 'delivery-1',
        orderId: 'order-1',
        status: 'available',
        channel: 'portal',
      },
    });
    expect(canTransitionOrder(released, 'delivered').code).toBe(
      'delivery_incomplete',
    );

    const delivered = {
      ...released,
      delivery: {
        ...released.delivery!,
        status: 'delivered' as const,
        deliveredAt: now,
        recipientId: 'patient-1',
      },
    };
    expect(canTransitionOrder(delivered, 'delivered').allowed).toBe(true);
  });

  it('returns only transitions whose guards currently pass', () => {
    const requested = snapshot({
      order: {
        ...snapshot().order,
        cancellationReason: 'Duplicate request',
      },
    });
    expect(availableOrderTransitions(requested)).toEqual([
      'awaiting_collection',
      'cancelled',
    ]);
  });
});

describe('M23 specimen status machine', () => {
  it('covers every specimen state and keeps terminal states closed', () => {
    const states = Object.keys(SPECIMEN_TRANSITIONS) as SpecimenStatus[];
    expect(states).toHaveLength(9);
    expect(SPECIMEN_TRANSITIONS.recollection_required).toEqual([]);
    expect(SPECIMEN_TRANSITIONS.disposed).toEqual([]);
  });

  it('requires collection and receipt metadata', () => {
    expect(canTransitionSpecimen(specimen(), 'collected').code).toBe(
      'collection_metadata_required',
    );
    expect(
      canTransitionSpecimen(
        specimen({ collectedAt: now, collectedBy: 'collector-1' }),
        'collected',
      ).allowed,
    ).toBe(true);

    expect(
      canTransitionSpecimen(specimen({ status: 'collected' }), 'received').code,
    ).toBe('receipt_metadata_required');
    expect(
      canTransitionSpecimen(
        specimen({ status: 'collected', receivedAt: now, receivedBy: 'receiver-1' }),
        'received',
      ).allowed,
    ).toBe(true);
  });

  it('requires identity and integrity checks before accepting', () => {
    expect(
      canTransitionSpecimen(specimen({ status: 'received' }), 'accepted').code,
    ).toBe('verification_required');
    expect(
      canTransitionSpecimen(
        specimen({
          status: 'received',
          identificationVerified: true,
          integrityVerified: true,
        }),
        'accepted',
      ).allowed,
    ).toBe(true);
  });

  it('requires a rejection reason and approved QC before processing completes', () => {
    expect(
      canTransitionSpecimen(specimen({ status: 'received' }), 'rejected').code,
    ).toBe('rejection_reason_required');
    expect(
      canTransitionSpecimen(
        specimen({ status: 'received', rejectionReason: 'Hemolysis' }),
        'rejected',
      ).allowed,
    ).toBe(true);

    const processing = specimen({ status: 'processing', processedAt: now });
    expect(canTransitionSpecimen(processing, 'processed', 'failed').code).toBe(
      'quality_control_not_approved',
    );
    expect(canTransitionSpecimen(processing, 'processed', 'passed').allowed).toBe(
      true,
    );
  });

  it('requires disposal metadata and filters unavailable transitions', () => {
    const processed = specimen({ status: 'processed' });
    expect(canTransitionSpecimen(processed, 'disposed').code).toBe(
      'disposal_metadata_required',
    );
    expect(availableSpecimenTransitions(processed)).toEqual([]);

    const disposable = { ...processed, disposedAt: now };
    expect(availableSpecimenTransitions(disposable)).toEqual(['disposed']);
  });

  it('rejects same-state changes and invalid jumps', () => {
    expect(canTransitionSpecimen(specimen(), 'planned').code).toBe('same_status');
    expect(canTransitionSpecimen(specimen(), 'processed').code).toBe(
      'invalid_transition',
    );
  });
});

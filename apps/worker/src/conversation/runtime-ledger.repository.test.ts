import { describe, expect, it, vi } from 'vitest';
import { RuntimeLedgerRepository } from './runtime-ledger.repository';
import { runtimeAttemptNumberFromJob } from './conversation.processor';

const startedAttempt = {
  id: 'attempt-1',
  tenantId: 'tenant-1',
  requestId: 'request-1',
  eventId: 'event-1',
  messageId: 'message-1',
  runtimeAttempt: 1,
  traceId: 'trace-1',
  runtimeMode: 'maf_shadow',
  phase: 'started',
};

function createDbMock() {
  const returning = vi.fn().mockResolvedValue([startedAttempt]);
  const limit = vi.fn().mockResolvedValue([startedAttempt]);
  const where = vi.fn(() => ({ limit, returning }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing, onConflictDoUpdate, returning }));
  const insert = vi.fn(() => ({ values }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ insert, update, select }),
  );

  return {
    client: {
      insert,
      update,
      select,
      transaction,
    },
    calls: {
      insert,
      update,
      select,
      from,
      where,
      limit,
      values,
      onConflictDoNothing,
      onConflictDoUpdate,
      returning,
      set,
      transaction,
    },
  };
}

describe('RuntimeLedgerRepository', () => {
  it('inserts a started runtime attempt idempotently without conflict rewrites', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await expect(
      repository.recordStartedAttempt({
        tenantId: 'tenant-1',
        requestId: 'request-1',
        eventId: 'event-1',
        messageId: 'message-1',
        runtimeAttempt: 1,
        traceId: 'trace-1',
        runtimeMode: 'maf_shadow',
      }),
    ).resolves.toEqual(startedAttempt);

    expect(db.calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        requestId: 'request-1',
        eventId: 'event-1',
        messageId: 'message-1',
        runtimeAttempt: 1,
        traceId: 'trace-1',
        runtimeMode: 'maf_shadow',
        phase: 'started',
      }),
    );
    expect(db.calls.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.calls.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('returns an existing attempt without rewinding phase on duplicate durable key', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.returning.mockResolvedValueOnce([]);
    db.calls.limit.mockResolvedValueOnce([{ ...startedAttempt, phase: 'actions_committed' }]);

    await expect(
      repository.recordStartedAttempt({
        tenantId: 'tenant-1',
        requestId: 'request-1',
        eventId: 'event-1',
        messageId: 'message-1',
        runtimeAttempt: 1,
        traceId: 'trace-1',
        runtimeMode: 'maf_shadow',
      }),
    ).resolves.toMatchObject({ phase: 'actions_committed' });

    expect(db.calls.update).not.toHaveBeenCalled();
  });

  it('finds an attempt by tenant-scoped durable fallback key without mutating phase', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit.mockResolvedValueOnce([{ ...startedAttempt, phase: 'actions_committed' }]);

    await expect(
      repository.findAttemptByDurableKey({
        tenantId: 'tenant-1',
        requestId: 'request-1',
        eventId: 'event-1',
        messageId: 'message-1',
        runtimeAttempt: 1,
      }),
    ).resolves.toMatchObject({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'actions_committed',
    });

    expect(db.calls.select).toHaveBeenCalledWith({
      id: expect.anything(),
      traceId: expect.anything(),
      runtimeMode: expect.anything(),
      runtimeAttempt: expect.anything(),
      phase: expect.anything(),
      failureReason: expect.anything(),
    });
    expect(db.calls.update).not.toHaveBeenCalled();
  });

  it('returns null for a missing durable fallback key', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit.mockResolvedValueOnce([]);

    await expect(
      repository.findAttemptByDurableKey({
        tenantId: 'tenant-1',
        requestId: 'request-1',
        eventId: 'event-1',
        messageId: 'message-1',
        runtimeAttempt: 1,
      }),
    ).resolves.toBeNull();
  });

  it('includes tenant scope in durable fallback key lookup', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await repository.findAttemptByDurableKey({
      tenantId: 'tenant-2',
      requestId: 'request-1',
      eventId: 'event-1',
      messageId: 'message-1',
      runtimeAttempt: 1,
    });

    expect(db.calls.where).toHaveBeenCalled();
    expect(db.calls.update).not.toHaveBeenCalled();
  });

  it('records action envelopes atomically with canonical side-effect state only', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit.mockResolvedValueOnce([startedAttempt]).mockResolvedValueOnce([]);

    await repository.recordActionEnvelopes({
      tenantId: 'tenant-1',
      runtimeAttemptId: 'attempt-1',
      actions: [
        {
          actionId: 'action-1',
          aggregateType: 'memory',
          actionType: 'save_memory',
          idempotencyKey: 'action:save-memory',
          payload: {
            memoryCandidateId: 'memory-candidate-1',
          },
          validationResult: { status: 'valid', reasonCodes: [] },
          executionStatus: 'not_started',
          commitMarker: null,
        },
      ],
    });

    expect(db.calls.transaction).toHaveBeenCalledTimes(1);
    expect(db.calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        runtimeAttemptId: 'attempt-1',
        actionId: 'action-1',
        aggregateType: 'memory',
        actionType: 'save_memory',
        idempotencyKey: 'action:save-memory',
        payload: {
          memoryCandidateId: 'memory-candidate-1',
        },
        validationResult: { status: 'valid', reasonCodes: [] },
        executionStatus: 'not_started',
        commitMarker: null,
      }),
    );
    expect(db.calls.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects contradictory committed action lifecycle state before persistence', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await expect(
      repository.recordActionEnvelopes({
        tenantId: 'tenant-1',
        runtimeAttemptId: 'attempt-1',
        actions: [
          ({
            actionId: 'action-1',
            aggregateType: 'memory',
            actionType: 'save_memory',
            idempotencyKey: 'action:save-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: { status: 'valid', reasonCodes: [] },
            executionStatus: 'not_started',
            commitMarker: {
              committedAt: '2026-08-05T13:00:00.000Z',
              referenceId: 'memory-1',
            },
          } as never),
        ],
      }),
    ).rejects.toThrow('runtime_action_lifecycle_invalid');

    expect(db.calls.transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed action payloads before persistence', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await expect(
      repository.recordActionEnvelopes({
        tenantId: 'tenant-1',
        runtimeAttemptId: 'attempt-1',
        actions: [
          ({
            actionId: 'action-1',
            aggregateType: 'memory',
            actionType: 'save_memory',
            idempotencyKey: 'action:save-memory',
            payload: {
              memoryText: 'not canonical',
            },
            validationResult: { status: 'valid', reasonCodes: [] },
            executionStatus: 'not_started',
            commitMarker: null,
          } as never),
        ],
      }),
    ).rejects.toThrow('runtime_action_canonical_invalid');

    expect(db.calls.transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed validation result fields before persistence', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await expect(
      repository.recordActionEnvelopes({
        tenantId: 'tenant-1',
        runtimeAttemptId: 'attempt-1',
        actions: [
          ({
            actionId: 'action-1',
            aggregateType: 'memory',
            actionType: 'save_memory',
            idempotencyKey: 'action:save-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: { status: 'valid' },
            executionStatus: 'not_started',
            commitMarker: null,
          } as never),
        ],
      }),
    ).rejects.toThrow('runtime_action_canonical_invalid');

    expect(db.calls.transaction).not.toHaveBeenCalled();
  });

  it('updates an existing action matched by actionId even when idempotencyKey changed', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit
      .mockResolvedValueOnce([startedAttempt])
      .mockResolvedValueOnce([{ id: 'action-row-1' }]);

    await repository.recordActionEnvelopes({
      tenantId: 'tenant-1',
      runtimeAttemptId: 'attempt-1',
      actions: [
        {
          actionId: 'action-1',
          aggregateType: 'memory',
          actionType: 'save_memory',
          idempotencyKey: 'action:save-memory-new-key',
          payload: {
            memoryCandidateId: 'memory-candidate-1',
          },
          validationResult: { status: 'valid', reasonCodes: [] },
          executionStatus: 'not_started',
          commitMarker: null,
        },
      ],
    });

    expect(db.calls.update).toHaveBeenCalledTimes(1);
    expect(db.calls.insert).not.toHaveBeenCalled();
  });

  it('rejects action rows when the attempt belongs to another tenant', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit.mockResolvedValueOnce([]);

    await expect(
      repository.recordActionEnvelopes({
        tenantId: 'tenant-2',
        runtimeAttemptId: 'attempt-1',
        actions: [
          {
            actionId: 'action-1',
            aggregateType: 'memory',
            actionType: 'save_memory',
            idempotencyKey: 'action:save-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: { status: 'valid', reasonCodes: [] },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      }),
    ).rejects.toThrow('runtime_attempt_not_found');
  });

  it.each([
    ['candidate_received'],
    ['actions_validated'],
    ['actions_committed'],
    ['reply_committed'],
    ['failed'],
  ] as const)('transitions attempt phase to %s', async (phase) => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

    await repository.transitionAttemptPhase({
      runtimeAttemptId: 'attempt-1',
      phase,
      ...(phase === 'failed' ? { failureReason: 'runtime_unavailable' } : {}),
    });

    expect(db.calls.update).toHaveBeenCalledTimes(1);
    expect(db.calls.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase,
        failureReason: phase === 'failed' ? 'runtime_unavailable' : null,
      }),
    );
  });

  it('does not regress a terminal phase', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);
    db.calls.limit.mockResolvedValueOnce([{ ...startedAttempt, phase: 'reply_committed' }]);

    await repository.transitionAttemptPhase({
      runtimeAttemptId: 'attempt-1',
      phase: 'failed',
      failureReason: 'late_failure',
    });

    expect(db.calls.update).not.toHaveBeenCalled();
  });
});

describe('runtimeAttemptNumberFromJob', () => {
  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])('maps BullMQ attemptsMade=%i to runtime attempt %i', (attemptsMade, expected) => {
    expect(runtimeAttemptNumberFromJob({ attemptsMade } as never)).toBe(expected);
  });
});

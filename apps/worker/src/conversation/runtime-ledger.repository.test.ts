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
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate, returning }));
  const insert = vi.fn(() => ({ values }));
  const set = vi.fn(() => ({
    where: vi.fn(() => ({
      returning,
    })),
  }));
  const update = vi.fn(() => ({ set }));

  return {
    client: {
      insert,
      update,
    },
    calls: {
      insert,
      update,
      values,
      onConflictDoUpdate,
      returning,
      set,
    },
  };
}

describe('RuntimeLedgerRepository', () => {
  it('upserts a started runtime attempt idempotently', async () => {
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
    expect(db.calls.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('records action envelopes with canonical side-effect state only', async () => {
    const db = createDbMock();
    const repository = new RuntimeLedgerRepository(db as never);

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

    expect(db.calls.insert).not.toHaveBeenCalled();
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

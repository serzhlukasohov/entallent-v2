import { describe, expect, it, vi } from 'vitest';
import type { ProcessMessageRequest } from '@entalent/application';
import { RuntimeFallbackBarrierService } from './runtime-fallback-barrier.service';
import type { RuntimeFallbackAttemptState, RuntimeLedgerRepository } from './runtime-ledger.repository';

const REQUEST: ProcessMessageRequest = {
  requestId: 'request-1',
  eventId: 'event-1',
  runtimeAttempt: 1,
  messageId: 'message-1',
  conversationId: 'conversation-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
};

function createLedger(attempt: RuntimeFallbackAttemptState | null) {
  return {
    findAttemptByDurableKey: vi.fn().mockResolvedValue(attempt),
  } as Pick<RuntimeLedgerRepository, 'findAttemptByDurableKey'>;
}

describe('RuntimeFallbackBarrierService', () => {
  it('allows fallback for an open durable ledger phase', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'actions_validated',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toEqual({
      allowed: true,
      barrierStatus: 'open',
      reasonCode: 'fallback_open_before_side_effect',
      phase: 'actions_validated',
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
    expect(ledger.findAttemptByDurableKey).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      requestId: 'request-1',
      eventId: 'event-1',
      messageId: 'message-1',
      runtimeAttempt: 1,
    });
  });

  it('forbids fallback for a closed durable ledger phase', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'reply_committed',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toMatchObject({
      allowed: false,
      barrierStatus: 'closed',
      reasonCode: 'fallback_closed_after_reply_committed',
      phase: 'reply_committed',
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
  });

  it('returns unknown without silently opening fallback when the attempt is missing', async () => {
    const ledger = createLedger(null);
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toEqual({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: undefined,
      runtimeAttempt: undefined,
    });
  });

  it('returns unknown for malformed durable phase values', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'bad_phase',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toEqual({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
  });

  it.each([
    [{ requestId: undefined }, 'requestId'],
    [{ eventId: undefined }, 'eventId'],
    [{ runtimeAttempt: undefined }, 'runtimeAttempt'],
    [{ runtimeAttempt: 0 }, 'runtimeAttempt'],
  ] as const)('returns unknown without lookup when durable request metadata is missing: %s', async (override, _field) => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'started',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest({ ...REQUEST, ...override })).resolves.toMatchObject({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
    });
    expect(ledger.findAttemptByDurableKey).not.toHaveBeenCalled();
  });

  it('returns unknown for non-MAF runtime modes even when the phase is open', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'typescript',
      runtimeAttempt: 1,
      phase: 'started',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toEqual({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
  });

  it('returns unknown when durable lookup fails', async () => {
    const ledger = {
      findAttemptByDurableKey: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as Pick<RuntimeLedgerRepository, 'findAttemptByDurableKey'>;
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(service.classifyForRequest(REQUEST)).resolves.toEqual({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
  });

  it('does not invoke a future TypeScript fallback callback when the barrier is closed', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'actions_committed',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);
    const fallback = vi.fn().mockResolvedValue('typescript-result');

    await expect(service.executeFallbackIfAllowed(REQUEST, fallback)).rejects.toMatchObject({
      name: 'RuntimeFallbackBlockedError',
      decision: {
        allowed: false,
        barrierStatus: 'closed',
        reasonCode: 'fallback_closed_after_actions_committed',
      },
    });

    expect(fallback).not.toHaveBeenCalled();
  });

  it('invokes a future TypeScript fallback callback when the barrier is open', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'started',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);
    const fallback = vi.fn().mockResolvedValue('typescript-result');

    await expect(service.executeFallbackIfAllowed(REQUEST, fallback)).resolves.toBe('typescript-result');

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('classifies a future runtime HTTP failure with the open durable barrier decision', async () => {
    const ledger = createLedger({
      id: 'attempt-1',
      traceId: 'trace-1',
      runtimeMode: 'maf_shadow',
      runtimeAttempt: 1,
      phase: 'started',
      failureReason: null,
    });
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(
      service.classifyRuntimeErrorForRequest(REQUEST, {
        errorCode: 'runtime_timeout',
        httpStatus: 504,
        idempotent: true,
        retryDiagnostics: {
          traceId: 'trace-1',
          runtimeAttempt: 1,
          httpRetryCount: 1,
        },
      }),
    ).resolves.toMatchObject({
      errorCode: 'runtime_timeout',
      httpStatus: 504,
      errorCategory: 'timeout',
      retryable: true,
      fallbackAllowed: true,
      barrierStatus: 'open',
      barrierReasonCode: 'fallback_open_before_side_effect',
      runtimeAttempt: 1,
      diagnostics: {
        traceId: 'trace-1',
        runtimeAttempt: 1,
        retryCount: 1,
        httpRetryCount: 1,
      },
    });
  });

  it.each([
    ['closed', 'actions_committed', 'fallback_closed_after_actions_committed'],
    ['unknown', 'bad_phase', 'fallback_barrier_unknown'],
  ] as const)(
    'classifies a future runtime HTTP failure with fallbackAllowed false when the barrier is %s',
    async (_status, phase, reasonCode) => {
      const ledger = createLedger({
        id: 'attempt-1',
        traceId: 'trace-1',
        runtimeMode: 'maf_shadow',
        runtimeAttempt: 1,
        phase,
        failureReason: null,
      });
      const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

      await expect(
        service.classifyRuntimeErrorForRequest(REQUEST, {
          errorCode: 'runtime_timeout',
          httpStatus: 504,
          idempotent: true,
        }),
      ).resolves.toMatchObject({
        errorCategory: 'timeout',
        retryable: true,
        fallbackAllowed: false,
        barrierReasonCode: reasonCode,
      });
    },
  );

  it('does not fabricate a runtime attempt when classifying a future runtime HTTP failure', async () => {
    const ledger = createLedger(null);
    const service = new RuntimeFallbackBarrierService(ledger as RuntimeLedgerRepository);

    await expect(
      service.classifyRuntimeErrorForRequest(
        {
          ...REQUEST,
          runtimeAttempt: undefined,
        },
        {
          errorCode: 'runtime_timeout',
          httpStatus: 504,
        },
      ),
    ).rejects.toThrow('runtime_error_classification_missing_runtime_attempt');
    expect(ledger.findAttemptByDurableKey).not.toHaveBeenCalled();
  });
});

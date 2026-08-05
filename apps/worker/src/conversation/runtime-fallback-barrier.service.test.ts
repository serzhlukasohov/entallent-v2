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
});

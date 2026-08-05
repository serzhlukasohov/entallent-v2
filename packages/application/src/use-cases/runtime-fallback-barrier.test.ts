import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeFallbackBlockedError,
  classifyRuntimeFallbackBarrier,
  executeRuntimeFallbackIfAllowed,
} from './runtime-fallback-barrier';

describe('classifyRuntimeFallbackBarrier', () => {
  it.each(['started', 'candidate_received', 'actions_validated', 'failed'] as const)(
    'allows fallback before committed side effects for %s',
    (phase) => {
      expect(
        classifyRuntimeFallbackBarrier({
          id: 'attempt-1',
          traceId: 'trace-1',
          runtimeAttempt: 1,
          runtimeMode: 'maf_shadow',
          phase,
          failureReason: null,
        }),
      ).toEqual({
        allowed: true,
        barrierStatus: 'open',
        reasonCode: 'fallback_open_before_side_effect',
        phase,
        traceId: 'trace-1',
        runtimeAttempt: 1,
      });
    },
  );

  it.each([
    ['actions_committed', 'fallback_closed_after_actions_committed'],
    ['reply_committed', 'fallback_closed_after_reply_committed'],
  ] as const)('forbids fallback after side-effect phase %s', (phase, reasonCode) => {
    expect(
      classifyRuntimeFallbackBarrier({
        id: 'attempt-1',
        traceId: 'trace-1',
        runtimeAttempt: 1,
        runtimeMode: 'maf_shadow',
        phase,
        failureReason: null,
      }),
    ).toEqual({
      allowed: false,
      barrierStatus: 'closed',
      reasonCode,
      phase,
      traceId: 'trace-1',
      runtimeAttempt: 1,
    });
  });

  it.each([null, undefined, 'unknown_phase', 123, {}])(
    'returns an explicit unknown decision for malformed phase state: %j',
    (phase) => {
      expect(
        classifyRuntimeFallbackBarrier({
          id: 'attempt-1',
          traceId: 'trace-1',
          runtimeAttempt: 1,
          runtimeMode: 'maf_shadow',
          phase,
          failureReason: null,
        }),
      ).toEqual({
        allowed: false,
        barrierStatus: 'unknown',
        reasonCode: 'fallback_barrier_unknown',
        phase: undefined,
        traceId: 'trace-1',
        runtimeAttempt: 1,
      });
    },
  );

  it.each(['typescript', 'maf_disabled', 'unknown_mode'] as const)(
    'returns unknown instead of opening fallback for non-MAF runtime mode %s',
    (runtimeMode) => {
      expect(
        classifyRuntimeFallbackBarrier({
          id: 'attempt-1',
          traceId: 'trace-1',
          runtimeAttempt: 1,
          runtimeMode,
          phase: 'started',
          failureReason: null,
        }),
      ).toEqual({
        allowed: false,
        barrierStatus: 'unknown',
        reasonCode: 'fallback_barrier_unknown',
        phase: undefined,
        traceId: 'trace-1',
        runtimeAttempt: 1,
      });
    },
  );

  it('returns an explicit unknown decision when the attempt is missing', () => {
    expect(classifyRuntimeFallbackBarrier(null)).toEqual({
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: undefined,
      runtimeAttempt: undefined,
    });
  });
});

describe('executeRuntimeFallbackIfAllowed', () => {
  it('invokes the fallback runtime when the barrier is open', async () => {
    const fallback = vi.fn().mockResolvedValue('typescript-result');

    await expect(
      executeRuntimeFallbackIfAllowed({
        decision: {
          allowed: true,
          barrierStatus: 'open',
          reasonCode: 'fallback_open_before_side_effect',
          phase: 'started',
          traceId: 'trace-1',
          runtimeAttempt: 1,
        },
        fallback,
      }),
    ).resolves.toBe('typescript-result');

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the fallback runtime when the barrier is closed', async () => {
    const fallback = vi.fn().mockResolvedValue('typescript-result');

    await expect(
      executeRuntimeFallbackIfAllowed({
        decision: {
          allowed: false,
          barrierStatus: 'closed',
          reasonCode: 'fallback_closed_after_actions_committed',
          phase: 'actions_committed',
          traceId: 'trace-1',
          runtimeAttempt: 1,
        },
        fallback,
      }),
    ).rejects.toMatchObject({
      name: 'RuntimeFallbackBlockedError',
      decision: {
        allowed: false,
        barrierStatus: 'closed',
        reasonCode: 'fallback_closed_after_actions_committed',
      },
    });

    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not invoke the fallback runtime when the barrier is unknown', async () => {
    const fallback = vi.fn().mockResolvedValue('typescript-result');

    await expect(
      executeRuntimeFallbackIfAllowed({
        decision: {
          allowed: false,
          barrierStatus: 'unknown',
          reasonCode: 'fallback_barrier_unknown',
        },
        fallback,
      }),
    ).rejects.toBeInstanceOf(RuntimeFallbackBlockedError);

    expect(fallback).not.toHaveBeenCalled();
  });
});

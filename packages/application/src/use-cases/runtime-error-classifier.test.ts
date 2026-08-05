import { describe, expect, it } from 'vitest';
import type { RuntimeFallbackBarrierDecision } from './runtime-fallback-barrier';
import {
  classifyRuntimeError,
  normalizeRuntimeRetryDiagnostics,
  type RuntimeErrorInput,
} from './runtime-error-classifier';

const OPEN_BARRIER: RuntimeFallbackBarrierDecision = {
  allowed: true,
  barrierStatus: 'open',
  reasonCode: 'fallback_open_before_side_effect',
  phase: 'started',
  traceId: 'trace-1',
  runtimeAttempt: 1,
};

const CLOSED_BARRIER: RuntimeFallbackBarrierDecision = {
  allowed: false,
  barrierStatus: 'closed',
  reasonCode: 'fallback_closed_after_actions_committed',
  phase: 'actions_committed',
  traceId: 'trace-1',
  runtimeAttempt: 1,
};

const UNKNOWN_BARRIER: RuntimeFallbackBarrierDecision = {
  allowed: false,
  barrierStatus: 'unknown',
  reasonCode: 'fallback_barrier_unknown',
  traceId: 'trace-1',
  runtimeAttempt: 1,
};

describe('classifyRuntimeError', () => {
  it.each([
    [
      { errorCode: 'runtime_unavailable', httpStatus: 503 },
      {
        errorCategory: 'unavailable',
        retryable: true,
        fallbackAllowed: true,
        reasonCode: 'runtime_unavailable',
      },
    ],
    [
      { errorCode: 'runtime_timeout', httpStatus: 504 },
      {
        errorCategory: 'timeout',
        retryable: true,
        fallbackAllowed: true,
        reasonCode: 'runtime_timeout',
      },
    ],
    [
      { errorCode: 'runtime_validation_error', httpStatus: 422 },
      {
        errorCategory: 'validation_error',
        retryable: false,
        fallbackAllowed: false,
        reasonCode: 'runtime_validation_error',
      },
    ],
    [
      { errorCode: 'runtime_duplicate_request', httpStatus: 409 },
      {
        errorCategory: 'duplicate_request',
        retryable: false,
        fallbackAllowed: false,
        reasonCode: 'runtime_duplicate_request',
      },
    ],
    [
      { errorCode: 'runtime_dependency_failed', httpStatus: 502, idempotent: true },
      {
        errorCategory: 'dependency_failed',
        retryable: true,
        fallbackAllowed: true,
        reasonCode: 'runtime_dependency_failed',
      },
    ],
    [
      { errorCode: 'runtime_dependency_failed', httpStatus: 502, idempotent: false },
      {
        errorCategory: 'dependency_failed',
        retryable: false,
        fallbackAllowed: false,
        reasonCode: 'runtime_dependency_failed',
      },
    ],
    [
      { errorCode: 'runtime_unsafe_partial_result', httpStatus: 500 },
      {
        errorCategory: 'unsafe_partial_result',
        retryable: false,
        fallbackAllowed: false,
        reasonCode: 'runtime_unsafe_partial_result',
      },
    ],
  ] as const)('classifies $errorCode/$httpStatus with an open fallback barrier', (input, expected) => {
    expect(
      classifyRuntimeError({
        ...baseErrorInput(),
        ...input,
        barrierDecision: OPEN_BARRIER,
      }),
    ).toMatchObject({
      ...expected,
      httpStatus: input.httpStatus,
      barrierStatus: 'open',
      barrierReasonCode: 'fallback_open_before_side_effect',
      runtimeAttempt: 1,
      traceId: 'trace-1',
      diagnostics: {
        traceId: 'trace-1',
        runtimeAttempt: 1,
        retryCount: 3,
        modelRetryCount: 1,
        toolRetryCount: 2,
        httpRetryCount: 0,
      },
    });
  });

  it.each([
    ['closed', CLOSED_BARRIER],
    ['unknown', UNKNOWN_BARRIER],
  ] as const)('forces fallbackAllowed false when the barrier is %s', (_status, barrierDecision) => {
    expect(
      classifyRuntimeError({
        ...baseErrorInput(),
        errorCode: 'runtime_timeout',
        httpStatus: 504,
        barrierDecision,
      }),
    ).toMatchObject({
      errorCategory: 'timeout',
      retryable: true,
      fallbackAllowed: false,
      barrierStatus: barrierDecision.barrierStatus,
      barrierReasonCode: barrierDecision.reasonCode,
    });
  });

  it('uses the request runtime attempt when the barrier decision omits it', () => {
    expect(
      classifyRuntimeError({
        ...baseErrorInput(),
        runtimeAttempt: 2,
        errorCode: 'runtime_timeout',
        httpStatus: 504,
        barrierDecision: {
          allowed: true,
          barrierStatus: 'open',
          reasonCode: 'fallback_open_before_side_effect',
        },
      }),
    ).toMatchObject({
      runtimeAttempt: 2,
      diagnostics: {
        runtimeAttempt: 2,
      },
    });
  });

  it('uses the request trace ID when retry diagnostics carry a stale trace ID', () => {
    expect(
      classifyRuntimeError({
        ...baseErrorInput(),
        traceId: 'trace-current',
        errorCode: 'runtime_timeout',
        httpStatus: 504,
        retryDiagnostics: {
          traceId: 'trace-stale',
          runtimeAttempt: 1,
        },
        barrierDecision: {
          allowed: true,
          barrierStatus: 'open',
          reasonCode: 'fallback_open_before_side_effect',
        },
      }),
    ).toMatchObject({
      traceId: 'trace-current',
      diagnostics: {
        traceId: 'trace-current',
      },
    });
  });

  it('keeps diagnostics redacted to stable non-content fields', () => {
    const classification = classifyRuntimeError({
      ...baseErrorInput(),
      errorCode: 'runtime_timeout',
      httpStatus: 504,
      barrierDecision: OPEN_BARRIER,
    });

    expect(Object.keys(classification.diagnostics).sort()).toEqual([
      'httpRetryCount',
      'modelRetryCount',
      'retryCount',
      'runtimeAttempt',
      'toolRetryCount',
      'traceId',
    ]);
    expect(classification.diagnostics).not.toHaveProperty('message');
    expect(classification.diagnostics).not.toHaveProperty('responseText');
    expect(classification.diagnostics).not.toHaveProperty('payload');
    expect(classification.diagnostics).not.toHaveProperty('rawError');
  });
});

describe('normalizeRuntimeRetryDiagnostics', () => {
  it.each([
    [{ runtimeAttempt: 1, modelRetryCount: 1, toolRetryCount: 2, httpRetryCount: 0 }, 3],
    [{ runtimeAttempt: 1, retryCount: 9, modelRetryCount: 1, toolRetryCount: 2, httpRetryCount: 0 }, 9],
  ] as const)('normalizes retry diagnostics %#', (input, retryCount) => {
    expect(
      normalizeRuntimeRetryDiagnostics({
        traceId: 'trace-1',
        ...input,
      }),
    ).toEqual({
      traceId: 'trace-1',
      runtimeAttempt: 1,
      retryCount,
      modelRetryCount: 1,
      toolRetryCount: 2,
      httpRetryCount: 0,
    });
  });

  it.each([
    { runtimeAttempt: 0 },
    { runtimeAttempt: 1, retryCount: -1 },
    { runtimeAttempt: 1, modelRetryCount: 1.5 },
    { runtimeAttempt: 1, toolRetryCount: -1 },
    { runtimeAttempt: 1, httpRetryCount: Number.NaN },
  ])('rejects invalid retry diagnostics %j', (input) => {
    expect(() =>
      normalizeRuntimeRetryDiagnostics({
        traceId: 'trace-1',
        ...input,
      }),
    ).toThrow('invalid_runtime_retry_diagnostics');
  });
});

function baseErrorInput(): RuntimeErrorInput {
  return {
    traceId: 'trace-1',
    runtimeAttempt: 1,
    retryDiagnostics: {
      traceId: 'trace-1',
      runtimeAttempt: 1,
      modelRetryCount: 1,
      toolRetryCount: 2,
      httpRetryCount: 0,
    },
  };
}

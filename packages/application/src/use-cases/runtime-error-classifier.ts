import type { RuntimeErrorCategory } from '@entalent/contracts';
import type {
  RuntimeFallbackBarrierDecision,
  RuntimeFallbackBarrierReasonCode,
  RuntimeFallbackBarrierStatus,
} from './runtime-fallback-barrier';

export type RuntimeErrorCode =
  | 'runtime_unavailable'
  | 'runtime_timeout'
  | 'runtime_validation_error'
  | 'runtime_duplicate_request'
  | 'runtime_dependency_failed'
  | 'runtime_unsafe_partial_result';

export type RuntimeErrorReasonCode = RuntimeErrorCode;

export interface RuntimeRetryDiagnosticsInput {
  traceId: string;
  runtimeAttempt: number;
  retryCount?: number;
  modelRetryCount?: number;
  toolRetryCount?: number;
  httpRetryCount?: number;
}

export interface RuntimeRetryDiagnostics {
  traceId: string;
  runtimeAttempt: number;
  retryCount: number;
  modelRetryCount: number;
  toolRetryCount: number;
  httpRetryCount: number;
}

export interface RuntimeErrorInput {
  traceId: string;
  runtimeAttempt: number;
  errorCode?: RuntimeErrorCode;
  httpStatus?: number;
  idempotent?: boolean;
  barrierDecision: RuntimeFallbackBarrierDecision;
  retryDiagnostics?: RuntimeRetryDiagnosticsInput;
}

export interface RuntimeErrorClassification {
  traceId: string;
  runtimeAttempt: number;
  errorCode: RuntimeErrorCode;
  httpStatus: number;
  errorCategory: RuntimeErrorCategory;
  retryable: boolean;
  fallbackAllowed: boolean;
  barrierStatus: RuntimeFallbackBarrierStatus;
  barrierReasonCode: RuntimeFallbackBarrierReasonCode;
  reasonCode: RuntimeErrorReasonCode;
  diagnostics: RuntimeRetryDiagnostics;
}

export function classifyRuntimeError(input: RuntimeErrorInput): RuntimeErrorClassification {
  const errorCode = resolveRuntimeErrorCode(input);
  const mapped = runtimeErrorMappings[errorCode];
  const httpStatus = input.httpStatus ?? mapped.httpStatus;
  if (input.httpStatus !== undefined && !isHttpStatusAllowedForErrorCode(errorCode, input.httpStatus)) {
    throw new Error('runtime_error_mapping_mismatch');
  }

  if (
    input.barrierDecision.runtimeAttempt !== undefined &&
    input.barrierDecision.runtimeAttempt !== input.runtimeAttempt
  ) {
    throw new Error('runtime_error_barrier_attempt_mismatch');
  }

  assertRetryDiagnosticsIdentifiers(input);

  const runtimeAttempt = input.runtimeAttempt;
  const retryable = isRuntimeErrorRetryable(errorCode, input.idempotent);
  const fallbackAllowed = retryable && isFallbackBarrierOpen(input.barrierDecision);

  return {
    traceId: input.traceId,
    runtimeAttempt,
    errorCode,
    httpStatus,
    errorCategory: mapped.errorCategory,
    retryable,
    fallbackAllowed,
    barrierStatus: input.barrierDecision.barrierStatus,
    barrierReasonCode: input.barrierDecision.reasonCode,
    reasonCode: errorCode,
    diagnostics: normalizeRuntimeRetryDiagnostics({
      ...input.retryDiagnostics,
      traceId: input.traceId,
      runtimeAttempt,
    }),
  };
}

export function normalizeRuntimeRetryDiagnostics(
  input: RuntimeRetryDiagnosticsInput,
): RuntimeRetryDiagnostics {
  assertNonNegativeInteger(input.runtimeAttempt);

  if (input.runtimeAttempt < 1) {
    throw new Error(INVALID_RUNTIME_RETRY_DIAGNOSTICS);
  }

  const modelRetryCount = input.modelRetryCount ?? 0;
  const toolRetryCount = input.toolRetryCount ?? 0;
  const httpRetryCount = input.httpRetryCount ?? 0;
  const retryCount = input.retryCount ?? modelRetryCount + toolRetryCount + httpRetryCount;

  for (const count of [retryCount, modelRetryCount, toolRetryCount, httpRetryCount]) {
    assertNonNegativeInteger(count);
  }

  if (retryCount !== modelRetryCount + toolRetryCount + httpRetryCount) {
    throw new Error(INVALID_RUNTIME_RETRY_DIAGNOSTICS);
  }

  return {
    traceId: input.traceId,
    runtimeAttempt: input.runtimeAttempt,
    retryCount,
    modelRetryCount,
    toolRetryCount,
    httpRetryCount,
  };
}

function isRuntimeErrorRetryable(errorCode: RuntimeErrorCode, idempotent: boolean | undefined): boolean {
  if (
    errorCode === 'runtime_unavailable' ||
    errorCode === 'runtime_timeout' ||
    errorCode === 'runtime_dependency_failed'
  ) {
    return idempotent === true;
  }

  return false;
}

function isFallbackBarrierOpen(decision: RuntimeFallbackBarrierDecision): boolean {
  return (
    decision.allowed &&
    decision.barrierStatus === 'open' &&
    decision.reasonCode === 'fallback_open_before_side_effect'
  );
}

function resolveRuntimeErrorCode(input: RuntimeErrorInput): RuntimeErrorCode {
  if (input.errorCode) {
    return input.errorCode;
  }

  if (input.httpStatus === undefined) {
    throw new Error('runtime_error_source_missing');
  }

  return errorCodeFromHttpStatus(input.httpStatus);
}

function assertRetryDiagnosticsIdentifiers(input: RuntimeErrorInput): void {
  if (!input.retryDiagnostics) {
    return;
  }

  if (input.retryDiagnostics.traceId !== input.traceId) {
    throw new Error('runtime_error_diagnostics_trace_mismatch');
  }

  if (input.retryDiagnostics.runtimeAttempt !== input.runtimeAttempt) {
    throw new Error('runtime_error_diagnostics_attempt_mismatch');
  }
}

function errorCodeFromHttpStatus(httpStatus: number | undefined): RuntimeErrorCode {
  if (httpStatus === undefined) {
    throw new Error('runtime_error_source_missing');
  }

  if (httpStatus === 400 || httpStatus === 422) {
    return 'runtime_validation_error';
  }

  if (httpStatus === 408) {
    return 'runtime_timeout';
  }

  if (httpStatus === 409) {
    return 'runtime_duplicate_request';
  }

  if (httpStatus === 429 || httpStatus === 503) {
    return 'runtime_unavailable';
  }

  if (httpStatus === 502) {
    return 'runtime_dependency_failed';
  }

  if (httpStatus === 504) {
    return 'runtime_timeout';
  }

  if (httpStatus >= 500 && httpStatus <= 599) {
    return 'runtime_dependency_failed';
  }

  return 'runtime_validation_error';
}

function isHttpStatusAllowedForErrorCode(errorCode: RuntimeErrorCode, httpStatus: number): boolean {
  return runtimeErrorStatusCodes[errorCode].has(httpStatus) || (
    errorCode === 'runtime_dependency_failed' &&
    httpStatus >= 500 &&
    httpStatus <= 599 &&
    httpStatus !== 503 &&
    httpStatus !== 504
  );
}

function assertNonNegativeInteger(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(INVALID_RUNTIME_RETRY_DIAGNOSTICS);
  }
}

const runtimeErrorMappings: Record<RuntimeErrorCode, {
  errorCategory: RuntimeErrorCategory;
  httpStatus: number;
}> = {
  runtime_unavailable: {
    errorCategory: 'unavailable',
    httpStatus: 503,
  },
  runtime_timeout: {
    errorCategory: 'timeout',
    httpStatus: 504,
  },
  runtime_validation_error: {
    errorCategory: 'validation_error',
    httpStatus: 422,
  },
  runtime_duplicate_request: {
    errorCategory: 'duplicate_request',
    httpStatus: 409,
  },
  runtime_dependency_failed: {
    errorCategory: 'dependency_failed',
    httpStatus: 502,
  },
  runtime_unsafe_partial_result: {
    errorCategory: 'unsafe_partial_result',
    httpStatus: 500,
  },
};

const runtimeErrorStatusCodes: Record<RuntimeErrorCode, Set<number>> = {
  runtime_unavailable: new Set([429, 503]),
  runtime_timeout: new Set([408, 504]),
  runtime_validation_error: new Set([400, 422]),
  runtime_duplicate_request: new Set([409]),
  runtime_dependency_failed: new Set([500, 502]),
  runtime_unsafe_partial_result: new Set([500]),
};

const INVALID_RUNTIME_RETRY_DIAGNOSTICS = 'invalid_runtime_retry_diagnostics';

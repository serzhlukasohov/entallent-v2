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
  const errorCode = input.errorCode ?? errorCodeFromHttpStatus(input.httpStatus);
  const mapped = runtimeErrorMappings[errorCode];
  const httpStatus = input.httpStatus ?? mapped.httpStatus;
  const runtimeAttempt = input.barrierDecision.runtimeAttempt ?? input.runtimeAttempt;
  const retryable = isRuntimeErrorRetryable(errorCode, input.idempotent);
  const fallbackAllowed = retryable && input.barrierDecision.allowed;

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
  if (errorCode === 'runtime_unavailable' || errorCode === 'runtime_timeout') {
    return true;
  }

  if (errorCode === 'runtime_dependency_failed') {
    return idempotent === true;
  }

  return false;
}

function errorCodeFromHttpStatus(httpStatus: number | undefined): RuntimeErrorCode {
  if (httpStatus === 400 || httpStatus === 422) {
    return 'runtime_validation_error';
  }

  if (httpStatus === 409) {
    return 'runtime_duplicate_request';
  }

  if (httpStatus === 502) {
    return 'runtime_dependency_failed';
  }

  if (httpStatus === 503) {
    return 'runtime_unavailable';
  }

  if (httpStatus === 504) {
    return 'runtime_timeout';
  }

  return 'runtime_unsafe_partial_result';
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

const INVALID_RUNTIME_RETRY_DIAGNOSTICS = 'invalid_runtime_retry_diagnostics';

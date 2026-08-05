export type RuntimeFallbackBarrierPhase =
  | 'started'
  | 'candidate_received'
  | 'actions_validated'
  | 'actions_committed'
  | 'reply_committed'
  | 'failed';

export type RuntimeFallbackBarrierStatus = 'open' | 'closed' | 'unknown';

export type RuntimeFallbackBarrierReasonCode =
  | 'fallback_open_before_side_effect'
  | 'fallback_closed_after_actions_committed'
  | 'fallback_closed_after_reply_committed'
  | 'fallback_barrier_unknown';

export interface RuntimeFallbackBarrierAttemptState {
  id: string;
  traceId: string;
  runtimeAttempt: number;
  runtimeMode: string;
  phase: unknown;
  failureReason: string | null;
}

export interface RuntimeFallbackBarrierDecision {
  allowed: boolean;
  barrierStatus: RuntimeFallbackBarrierStatus;
  reasonCode: RuntimeFallbackBarrierReasonCode;
  phase?: RuntimeFallbackBarrierPhase;
  traceId?: string;
  runtimeAttempt?: number;
}

export interface ExecuteRuntimeFallbackIfAllowedParams<T> {
  decision: RuntimeFallbackBarrierDecision;
  fallback: () => Promise<T> | T;
}

export class RuntimeFallbackBlockedError extends Error {
  readonly decision: RuntimeFallbackBarrierDecision;

  constructor(decision: RuntimeFallbackBarrierDecision) {
    super(decision.reasonCode);
    this.name = 'RuntimeFallbackBlockedError';
    this.decision = decision;
  }
}

export function classifyRuntimeFallbackBarrier(
  attempt: RuntimeFallbackBarrierAttemptState | null | undefined,
): RuntimeFallbackBarrierDecision {
  if (!attempt || !isRuntimeFallbackBarrierPhase(attempt.phase)) {
    return {
      allowed: false,
      barrierStatus: 'unknown',
      reasonCode: 'fallback_barrier_unknown',
      phase: undefined,
      traceId: attempt?.traceId,
      runtimeAttempt: attempt?.runtimeAttempt,
    };
  }

  const phase = attempt.phase;

  if (phase === 'actions_committed') {
    return closedDecision(attempt, phase, 'fallback_closed_after_actions_committed');
  }

  if (phase === 'reply_committed') {
    return closedDecision(attempt, phase, 'fallback_closed_after_reply_committed');
  }

  return {
    allowed: true,
    barrierStatus: 'open',
    reasonCode: 'fallback_open_before_side_effect',
    phase,
    traceId: attempt.traceId,
    runtimeAttempt: attempt.runtimeAttempt,
  };
}

export async function executeRuntimeFallbackIfAllowed<T>({
  decision,
  fallback,
}: ExecuteRuntimeFallbackIfAllowedParams<T>): Promise<T> {
  if (!decision.allowed) {
    throw new RuntimeFallbackBlockedError(decision);
  }

  return fallback();
}

function closedDecision(
  attempt: RuntimeFallbackBarrierAttemptState,
  phase: RuntimeFallbackBarrierPhase,
  reasonCode: Extract<
    RuntimeFallbackBarrierReasonCode,
    'fallback_closed_after_actions_committed' | 'fallback_closed_after_reply_committed'
  >,
): RuntimeFallbackBarrierDecision {
  return {
    allowed: false,
    barrierStatus: 'closed',
    reasonCode,
    phase,
    traceId: attempt.traceId,
    runtimeAttempt: attempt.runtimeAttempt,
  };
}

function isRuntimeFallbackBarrierPhase(value: unknown): value is RuntimeFallbackBarrierPhase {
  return runtimeFallbackBarrierPhases.has(value);
}

const runtimeFallbackBarrierPhases = new Set<unknown>([
  'started',
  'candidate_received',
  'actions_validated',
  'actions_committed',
  'reply_committed',
  'failed',
]);

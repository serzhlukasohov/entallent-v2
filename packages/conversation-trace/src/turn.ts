import type { OrchestrateResult, ResponseContext } from '@entalent/application';
import type { TraceEvent } from './events';
import type { TracedStateBefore } from './state-before';

/** Structured results of one turn that the event list keeps only as text. */
export interface TurnEffects {
  /** Metadata the orchestrator stored on the outbound message (decisions, fallbacks, probes). */
  outboundMetadata: Record<string, unknown> | null;
  memoryAdded: Array<{ category: string; content: string; importance: number }>;
  escalations: Array<{ type: string; severity: string; riskType: string | null }>;
  /** Generation calls for this turn; more than one means a corrective regeneration. */
  generationAttempts: number;
}

/** One turn as the run report shows it: the same shape for a sim run and a production trace. */
export interface ReportTurn {
  index: number;
  /** The classifier's full output for this turn, after provider normalization. */
  classification?: Record<string, unknown>;
  /** Pulse-cycle, memory and reply inputs the orchestrator gave the generator this turn. */
  responseInputs?: Record<string, unknown> | null;
  effects?: TurnEffects | null;
  mode: string;
  primaryIntent: string;
  requiresSafetyCheck: boolean;
  risk: { severity: string; type: string | null };
  responseLength: number;
  responseText: string;
  replyPlan: ResponseContext['replyPlan'] | null;
  replyBrief: ResponseContext['replyBrief'] | null;
}

/**
 * Builds the report entry of a completed turn. `context` is the final generation request of the
 * turn, or null when the reply bypassed generation. Outcome turns (filtered input, failed-turn
 * fallback) carry no classification or risk; they show as `none` instead of failing.
 */
export function buildReportTurn(
  index: number,
  result: OrchestrateResult,
  context: ResponseContext | null | undefined,
  effects: TurnEffects | null,
): ReportTurn {
  const classification = result.classification as OrchestrateResult['classification'] | undefined;
  const risk = result.risk as OrchestrateResult['risk'] | undefined;
  return {
    index,
    classification: { ...(classification ?? {}) },
    responseInputs: responseInputs(context ?? undefined),
    effects,
    mode: result.mode ?? result.outcome ?? 'none',
    primaryIntent: classification?.primaryIntent ?? 'none',
    requiresSafetyCheck: classification?.requiresSafetyCheck ?? false,
    risk: { severity: risk?.severity ?? 'none', type: risk?.riskType ?? null },
    responseLength: result.responseText.length,
    responseText: result.responseText,
    replyPlan: context?.replyPlan ?? null,
    replyBrief: context?.replyBrief ?? null,
  };
}

/** The generator's inputs worth reading in a report; prompt-only material such as style phrases is left out. */
export function responseInputs(context: ResponseContext | undefined): Record<string, unknown> | null {
  if (!context) return null;
  const picked: Record<string, unknown> = {
    topicQuestion: context.topicQuestion,
    surveyProbeQuestion: context.surveyProbeQuestion,
    cycleProgress: context.cycleProgress,
    confirmationRequest: context.confirmationRequest,
    topicConfirmed: context.topicConfirmed,
    questionNotCollected: context.questionNotCollected,
    captureFacts: context.captureFacts,
    reminderConfirmation: context.reminderConfirmation,
    reminderIntent: context.reminderIntent,
    followUpIntent: context.followUpIntent,
    proactiveCheckIn: context.proactiveCheckIn,
    reportingDisclosure: context.reportingDisclosure ? true : undefined,
    trailingBundle: context.trailingBundle ? { kind: context.trailingBundle.kind, text: context.trailingBundle.text } : undefined,
    memoryContext: context.memoryContext
      ? {
          items: context.memoryContext.items.map((item) => `${item.category}: ${item.content}`),
          goals: context.memoryContext.goals.map((goal) => `${goal.title} (${goal.status})`),
        }
      : undefined,
    styleAdaptationWeight: context.styleAdaptation?.weight,
    localTime: context.localTime,
    isSessionStart: context.isSessionStart,
  };
  return Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined));
}

export const TRACED_TURN_SCHEMA_VERSION = 1 as const;

/**
 * What production stores for one traced turn (encrypted as a whole). `turn` is null when the turn
 * threw; `error` then names the failure. The sim run report holds the same sections per turn.
 */
export interface TracedTurnPayload {
  schemaVersion: typeof TRACED_TURN_SCHEMA_VERSION;
  /** The employee message that started the turn, as the orchestrator read it. */
  userMessage: string | null;
  trace: TraceEvent[];
  turn: ReportTurn | null;
  error: string | null;
  /** Set when events or text were cut to keep the payload bounded. */
  truncated: boolean;
  /**
   * The state the orchestrator read before and during the turn (SPEC CAP-8), for building a
   * precondition. Absent on rows stored before it was captured, and dropped when the payload had
   * to be cut to its last resort.
   */
  stateBefore?: TracedStateBefore;
}

export interface TracedTurnLimits {
  maxEvents: number;
  maxBytes: number;
}

export const DEFAULT_TRACED_TURN_LIMITS: TracedTurnLimits = { maxEvents: 400, maxBytes: 512 * 1024 };

/**
 * Serializes a traced turn, keeping it under `maxBytes`: events beyond `maxEvents` are dropped,
 * then the largest sections are reduced until it fits. Returns the JSON text to encrypt.
 */
export function serializeTracedTurn(
  payload: Omit<TracedTurnPayload, 'schemaVersion' | 'truncated'>,
  limits: TracedTurnLimits = DEFAULT_TRACED_TURN_LIMITS,
): string {
  let truncated = payload.trace.length > limits.maxEvents;
  const bounded: TracedTurnPayload = {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    ...payload,
    trace: payload.trace.slice(0, limits.maxEvents),
    truncated,
  };
  let json = JSON.stringify(bounded);
  if (Buffer.byteLength(json, 'utf8') <= limits.maxBytes) return json;
  truncated = true;
  // Too large even with bounded events: keep the decisions, drop the bulky structured parts.
  const reduced: TracedTurnPayload = {
    ...bounded,
    userMessage: clipText(bounded.userMessage, 4_000),
    turn: bounded.turn
      ? { ...bounded.turn, responseText: clipText(bounded.turn.responseText, 4_000) ?? '', responseInputs: null, effects: null }
      : null,
    error: clipText(bounded.error, 1_000),
    truncated,
  };
  json = JSON.stringify(reduced);
  if (Buffer.byteLength(json, 'utf8') <= limits.maxBytes) return json;
  const { stateBefore: _dropped, ...withoutState } = reduced;
  void _dropped;
  if (reduced.stateBefore) {
    // A bulky state section goes before the structured turn and the events do.
    json = JSON.stringify(withoutState);
    if (Buffer.byteLength(json, 'utf8') <= limits.maxBytes) return json;
  }
  // Last resort: keep the first events and the final one (the turn outcome or error), halving
  // until it fits; text fields stay clipped and the structured turn is dropped.
  const minimal = { ...withoutState, userMessage: clipText(reduced.userMessage, 500), turn: null };
  const last = reduced.trace.at(-1);
  let head = reduced.trace.slice(0, -1);
  while (Buffer.byteLength(json, 'utf8') > limits.maxBytes) {
    if (head.length === 0) {
      json = JSON.stringify({ ...minimal, trace: [] });
      break;
    }
    head = head.slice(0, Math.floor(head.length / 2));
    json = JSON.stringify({ ...minimal, trace: last ? [...head, last] : head });
  }
  return json;
}

function clipText(text: string | null, max: number): string | null {
  return text !== null && text.length > max ? `${text.slice(0, max)}...` : text;
}

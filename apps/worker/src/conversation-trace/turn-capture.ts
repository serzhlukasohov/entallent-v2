import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrchestrateInput, ResponseContext } from '@entalent/application';
import {
  StateBeforeCollector,
  type GenerateResponseCall,
  type StateReadObserver,
  type TraceEvent,
  type TraceEventKind,
  type TraceSink,
  type TurnEffects,
} from '@entalent/conversation-trace';

/**
 * Events kept per turn; later ones are counted, not stored, so a runaway turn stays bounded. Two
 * slots stay free for the final outcome or error and the truncation note, so the stored list
 * (at most 400, the serializer's limit) always ends with how the turn ended.
 */
const MAX_EVENTS = 398;

/**
 * Everything one traced turn produced, collected while it runs. It lives only in the job's
 * AsyncLocalStorage context and is closed when `orchestrate` settles, so a write that arrives
 * later (an unawaited promise) cannot leak into this or another turn.
 */
export class TurnCapture implements TraceSink, StateReadObserver {
  readonly events: TraceEvent[] = [];
  readonly startedAt = new Date();
  userMessage: string | null = null;
  droppedEvents = 0;
  generationAttempts = 0;
  lastGeneration: ResponseContext | null = null;
  readonly effects: Omit<TurnEffects, 'generationAttempts'> = { outboundMetadata: null, memoryAdded: [], escalations: [] };
  /** What the orchestrator read before and during the turn, for building a precondition (SPEC CAP-8). */
  readonly stateBefore: StateBeforeCollector;
  private closed = false;

  constructor(readonly input: Readonly<Pick<OrchestrateInput,
    'tenantId' | 'userId' | 'conversationId' | 'messageId' | 'traceId'>>) {
    this.stateBefore = new StateBeforeCollector(input.messageId);
  }

  get recording(): boolean {
    return !this.closed;
  }

  close(): void {
    this.closed = true;
  }

  /** The turn's last event (outcome or error); it bypasses the event limit. */
  recordFinal(kind: TraceEventKind, name: string, summary: string): void {
    if (this.closed) return;
    this.events.push({ turn: 1, kind, name, summary });
  }

  record(kind: TraceEventKind, name: string, summary: string): void {
    if (this.closed) return;
    if (this.events.length >= MAX_EVENTS) {
      this.droppedEvents += 1;
      return;
    }
    this.events.push({ turn: 1, kind, name, summary });
  }

  observeWrite(store: string, method: string, args: readonly unknown[]): void {
    if (this.closed) return;
    this.stateBefore.noteWrite(store);
    const [first] = args;
    if (!isRecord(first)) return;
    if (store === 'conversation' && method === 'saveMessage' && first['direction'] === 'outbound') {
      this.effects.outboundMetadata = isRecord(first['metadata']) ? jsonCopy(first['metadata']) : null;
    } else if (store === 'memory' && method === 'save'
      && typeof first['category'] === 'string' && typeof first['content'] === 'string') {
      this.effects.memoryAdded.push({
        category: first['category'],
        content: first['content'],
        importance: typeof first['importance'] === 'number' ? first['importance'] : 0,
      });
    } else if (store === 'escalation' && method === 'raise') {
      this.effects.escalations.push({
        type: String(first['type']),
        severity: String(first['severity']),
        riskType: typeof first['riskType'] === 'string' ? first['riskType'] : null,
      });
    }
  }

  observeGeneration(call: GenerateResponseCall): void {
    if (this.closed) return;
    this.generationAttempts += 1;
    this.lastGeneration = call.context;
  }

  /** A state read's result (see `observeStateReads`); the history read also yields the inbound text. */
  observeRead(store: string, method: string, args: readonly unknown[], result: unknown): void {
    if (this.closed) return;
    if (store === 'conversation' && (method === 'findMessagesThrough' || method === 'findRecentMessages')) {
      this.observeMessages(result);
    }
    this.stateBefore.observeRead(store, method, args, result);
  }

  /** The inbound message as the orchestrator read it; the first matching read wins. */
  observeMessages(messages: unknown): void {
    if (this.closed || this.userMessage !== null || !Array.isArray(messages)) return;
    const inbound = messages.find((message) => isRecord(message) && message['id'] === this.input.messageId);
    if (isRecord(inbound) && typeof inbound['text'] === 'string') {
      this.userMessage = inbound['text'];
      this.record('inbound', 'message accepted', `inbound, ${inbound['text'].length} chars`);
    }
  }
}

/** Per-job holder of the current turn's capture; concurrent jobs each see only their own. */
export class TurnTraceContext {
  private readonly storage = new AsyncLocalStorage<TurnCapture>();

  run<T>(capture: TurnCapture, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(capture, callback);
  }

  current(): TurnCapture | undefined {
    return this.storage.getStore();
  }
}

/**
 * The sink the composition root hands to port decorators: it forwards to the capture of the
 * turn running in the current async context, and is silent everywhere else (untraced tenants,
 * proactive check-ins, other workers).
 */
export class AmbientTraceSink implements TraceSink {
  constructor(private readonly context: TurnTraceContext) {}

  get recording(): boolean {
    return this.context.current()?.recording ?? false;
  }

  record(kind: TraceEventKind, name: string, summary: string): void {
    this.context.current()?.record(kind, name, summary);
  }

  observeWrite(store: string, method: string, args: readonly unknown[]): void {
    this.context.current()?.observeWrite(store, method, args);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A detached copy, so later mutation of the original cannot change what the turn wrote. */
function jsonCopy(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

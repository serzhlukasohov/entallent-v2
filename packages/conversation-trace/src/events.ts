/**
 * The ordered events of each conversation turn: what came in, which model calls ran and what they
 * returned, and which writes reached storage or the outbox. The sim report and the production trace
 * both render this as the turn's chain of decisions, so a reader sees why a reply came out as it did.
 */
export type TraceEventKind = 'inbound' | 'llm' | 'write' | 'queue' | 'warning' | 'error' | 'decision';

export interface TraceEvent {
  /** 1-based conversation turn; 0 for events before the first message (seeding). */
  turn: number;
  kind: TraceEventKind;
  /** `classifySituation`, `conversation.saveMessage`, `outbox.enqueueMessageSend`, ... */
  name: string;
  summary: string;
}

/**
 * Where trace events go. `recording` lets callers skip building a summary nobody keeps; the
 * production sink is off outside a traced turn. `observeWrite` receives the raw arguments of a
 * state-changing call, for sinks that collect structured turn effects.
 */
export interface TraceSink {
  readonly recording: boolean;
  record(kind: TraceEventKind, name: string, summary: string): void;
  observeWrite?(store: string, method: string, args: readonly unknown[]): void;
}

/** In-memory sink of the sim harness: records every event, tagged with the current turn. */
export class TurnTrace implements TraceSink {
  readonly events: TraceEvent[] = [];
  readonly recording = true;
  turn = 0;

  record(kind: TraceEventKind, name: string, summary: string): void {
    this.events.push({ turn: this.turn, kind, name, summary });
  }
}

/** `Name: message` of an error, or its string form; the trace keeps no stacks. */
export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

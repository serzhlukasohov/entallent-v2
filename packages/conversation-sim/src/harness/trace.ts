/**
 * The trace model is shared with the production worker (`@entalent/conversation-trace`), so the
 * same report renderer serves sim runs and traced production turns. Re-exported for sim imports.
 */
export { summarizeArgs, summarizeValue, traceWrites, TurnTrace } from '@entalent/conversation-trace';
export type { TraceEvent, TraceEventKind, TraceSink } from '@entalent/conversation-trace';

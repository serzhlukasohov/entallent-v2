import type {
  AiProviderPort,
  ConversationOrchestrator,
  ConversationRepositoryPort,
  OrchestratorLogger,
} from '@entalent/application';
import { observeStateReads, summarizeValue, traceWrites, TracingAiProvider } from '@entalent/conversation-trace';
import type { ConversationTraceRecorder } from './conversation-trace.recorder';

/**
 * Decorators the composition root puts around the orchestrator's ports. With no traced turn in
 * the current async context they only forward calls; nothing is summarized or kept.
 */
export function traceConversationPorts(recorder: ConversationTraceRecorder) {
  const { sink, context } = recorder;
  // State reads (history, memory, goals, cycle, ...) reach the current turn's capture (SPEC CAP-8).
  const current = () => context.current();
  return {
    writes: <T extends object>(port: T, store: string): T => observeStateReads(traceWrites(port, store, sink), store, current),
    /** Write tracing plus capture of the inbound message and history from the orchestrator's own reads. */
    conversation: <T extends ConversationRepositoryPort>(repo: T): T =>
      observeStateReads(traceWrites(repo, 'conversation', sink), 'conversation', current),
    ai: (ai: AiProviderPort): AiProviderPort =>
      new TracingAiProvider(ai, sink, (call) => context.current()?.observeGeneration(call)),
    logger: (logger: OrchestratorLogger): OrchestratorLogger => ({
      warn: (message, details) => {
        logger.warn(message, details);
        try {
          if (sink.recording) sink.record('warning', message, details ? summarizeValue(details, 0) : '');
        } catch {
          // Diagnostic only.
        }
      },
    }),
  };
}

/** Wraps `orchestrate` so each call runs inside its own trace context; other methods pass through. */
export function traceOrchestrator(
  orchestrator: ConversationOrchestrator,
  recorder: ConversationTraceRecorder,
): ConversationOrchestrator {
  return new Proxy(orchestrator, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'orchestrate') {
        return (input: Parameters<ConversationOrchestrator['orchestrate']>[0]) =>
          recorder.traceTurn(input, () => target.orchestrate(input));
      }
      // Methods run on the real orchestrator; `constructor` stays the class for framework introspection.
      return typeof value === 'function' && property !== 'constructor' ? value.bind(target) : value;
    },
  });
}

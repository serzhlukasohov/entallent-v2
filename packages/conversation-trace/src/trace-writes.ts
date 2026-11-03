import { describeError, type TraceSink } from './events';
import { summarizeArgs } from './summarize';

/** Method names that change state; reads are left out of the trace. */
const WRITE_METHOD = /^(save|update|upsert|insert|create|delete|softDelete|supersede|stage|apply|record|mark|cancel|postpone|transition|confirm|withdraw|complete|enqueue|raise|append|capture|reopen|prioritize|deprioritize|unlock|initialize|schedule)/;

/**
 * Wraps a repository or port so every state-changing call is traced before it runs. Calls are
 * forwarded to the original object, so it keeps owning its state. Tracing is diagnostic: if
 * building or recording the event throws, the event is dropped and the call still runs unchanged.
 */
export function traceWrites<T extends object>(target: T, store: string, sink: TraceSink): T {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof property !== 'string' || typeof value !== 'function' || !WRITE_METHOD.test(property)) {
        return typeof value === 'function' && property !== 'constructor' ? value.bind(object) : value;
      }
      return (...args: unknown[]) => {
        recordWrite(sink, store, property, args);
        const outcome: unknown = value.apply(object, args);
        // Only inside a traced turn, so untraced calls keep their exact rejection handling.
        if (outcome instanceof Promise && isRecording(sink)) recordRejection(sink, `${store}.${property}`, outcome);
        return outcome;
      };
    },
  });
}

function recordWrite(sink: TraceSink, store: string, method: string, args: unknown[]): void {
  try {
    if (!sink.recording) return;
    sink.record(store === 'outbox' ? 'queue' : 'write', `${store}.${method}`, summarizeArgs(args));
  } catch {
    // A trace that cannot be built must never change the call it describes.
  }
  try {
    sink.observeWrite?.(store, method, args);
  } catch {
    // A trace that cannot be built must never change the call it describes.
  }
}

/** A write that rejects shows as an `error` event; the caller still gets the original promise. */
function recordRejection(sink: TraceSink, name: string, outcome: Promise<unknown>): void {
  outcome.then(undefined, (error: unknown) => {
    try {
      if (sink.recording) sink.record('error', name, describeError(error));
    } catch {
      // Diagnostic only.
    }
  });
}

function isRecording(sink: TraceSink): boolean {
  try {
    return sink.recording;
  } catch {
    return false;
  }
}

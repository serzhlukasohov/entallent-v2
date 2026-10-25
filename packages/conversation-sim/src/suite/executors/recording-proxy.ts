import type { RunEvent } from '../schema';

/** Where recording proxies append events; the executor moves `stepIndex` between steps. */
export interface EventSink {
  readonly events: RunEvent[];
  /** 0 while fixtures and seed run, then the 1-based step being sent. */
  stepIndex: number;
}

const SUMMARY_LIMIT = 160;

/** Creates a sink whose `durationMs` comes from `peek` (the controlled clock, never the wall clock). */
export function createEventSink(peek: () => Date): EventSink & { readonly peek: () => Date } {
  return { events: [], stepIndex: 0, peek };
}

/**
 * Wraps every method of `port` (own and prototype) so each call appends one `RunEvent`
 * to `sink`, in call order: the event is appended when the call starts (so a nested
 * call made by the port itself comes after it) and completed when it settles.
 * `durationMs` is measured on the controlled clock, so it is 0 unless the clock moves
 * during the call, which keeps events deterministic. Methods run against the
 * unwrapped target, so the port's own internal calls are not recorded twice.
 */
export function record<T extends object>(port: T, label: string, sink: EventSink & { readonly peek: () => Date }): T {
  return new Proxy(port, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function' || typeof property === 'symbol' || property === 'constructor') return value;
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => invoke(sink, label, property, args, () => method.apply(target, args));
    },
  });
}

function invoke(
  sink: EventSink & { readonly peek: () => Date },
  port: string,
  method: string,
  args: unknown[],
  call: () => unknown,
): unknown {
  const event: RunEvent = {
    stepIndex: sink.stepIndex,
    seq: sink.events.length,
    port,
    method,
    argsSummary: summarize(args),
    outcome: 'ok',
    resultSummary: '',
    durationMs: 0,
  };
  sink.events.push(event);
  const started = sink.peek().getTime();
  const settle = (outcome: RunEvent['outcome'], summary: string): void => {
    event.outcome = outcome;
    event.resultSummary = summary;
    event.durationMs = Math.max(0, sink.peek().getTime() - started);
  };

  let result: unknown;
  try {
    result = call();
  } catch (error) {
    settle('error', errorSummary(error));
    throw error;
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      (value) => {
        settle('ok', summarize(value));
        return value;
      },
      (error: unknown) => {
        settle('error', errorSummary(error));
        throw error;
      },
    );
  }
  settle('ok', summarize(result));
  return result;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function errorSummary(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return truncate(text);
}

/** A short, deterministic rendering of call arguments or results (Dates as ISO). */
export function summarize(value: unknown): string {
  if (value === undefined) return '';
  let text: string;
  try {
    text =
      JSON.stringify(value, function replacer(this: Record<string, unknown>, key: string, item: unknown) {
        const raw = this[key];
        return raw instanceof Date ? raw.toISOString() : item;
      }) ?? String(value);
  } catch {
    text = String(value);
  }
  return truncate(text);
}

function truncate(text: string): string {
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 3)}...` : text;
}

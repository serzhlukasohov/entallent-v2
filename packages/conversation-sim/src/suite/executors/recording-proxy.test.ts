import { describe, expect, it } from 'vitest';
import { RunEventSchema } from '../schema';
import { AdvancingClock, FixedClock } from './clock';
import { createEventSink, record, summarize } from './recording-proxy';

class Port {
  readonly calls: string[] = [];
  constructor(private readonly inner?: Port) {}

  async save(value: { at: Date; text: string }): Promise<string> {
    this.calls.push('save');
    // A nested call through another recorded port lands after the outer call.
    if (this.inner) await this.inner.save(value);
    return `saved:${value.text}`;
  }

  count(): number {
    return this.calls.length;
  }

  async fail(): Promise<void> {
    throw new Error('boom');
  }

  throwSync(): void {
    throw new TypeError('sync boom');
  }
}

describe('recording proxy', () => {
  it('records one event per call in call order, with the sink step index', async () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const inner = record(new Port(), 'innerPort', sink);
    const outer = record(new Port(inner), 'outerPort', sink);

    await outer.save({ at: clock.now(), text: 'a' });
    sink.stepIndex = 1;
    expect(outer.count()).toBe(1);

    expect(sink.events.map((event) => [event.stepIndex, event.seq, event.port, event.method])).toEqual([
      [0, 0, 'outerPort', 'save'],
      [0, 1, 'innerPort', 'save'],
      [1, 2, 'outerPort', 'count'],
    ]);
    expect(sink.events[0]).toMatchObject({
      outcome: 'ok',
      argsSummary: '[{"at":"2026-01-05T08:00:00.000Z","text":"a"}]',
      resultSummary: '"saved:a"',
      durationMs: 0,
    });
    expect(sink.events[2]?.resultSummary).toBe('1');
    for (const event of sink.events) RunEventSchema.parse(event);
  });

  it('records rejected and thrown calls as errors and rethrows them', async () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const port = record(new Port(), 'port', sink);

    await expect(port.fail()).rejects.toThrow('boom');
    expect(() => port.throwSync()).toThrow('sync boom');
    expect(sink.events.map((event) => [event.method, event.outcome, event.resultSummary])).toEqual([
      ['fail', 'error', 'Error: boom'],
      ['throwSync', 'error', 'TypeError: sync boom'],
    ]);
  });

  it('measures durationMs on the controlled clock only', async () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const slow = record(
      {
        async work(): Promise<void> {
          clock.advance(250);
        },
      },
      'slow',
      sink,
    );
    await slow.work();
    expect(sink.events[0]?.durationMs).toBe(250);
  });

  it('passes non-function properties through and keeps absent methods absent', () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const port = record(new Port(), 'port', sink) as Port & { missing?: () => void };
    expect(port.calls).toEqual([]);
    expect(port.missing).toBeUndefined();
    expect(sink.events).toEqual([]);
  });

  it('summarizes deterministically and truncates long values', () => {
    expect(summarize(undefined)).toBe('');
    expect(summarize({ at: new Date('2026-01-05T08:00:00.000Z') })).toBe('{"at":"2026-01-05T08:00:00.000Z"}');
    expect(summarize('x'.repeat(500))).toHaveLength(160);
  });
});

describe('controlled clocks', () => {
  it('FixedClock stands still until advanced', () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-01-05T08:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-05T08:00:00.000Z');
    clock.advance(60_000);
    expect(clock.peek().toISOString()).toBe('2026-01-05T08:01:00.000Z');
    expect(() => clock.advance(-1)).toThrow();
  });

  it('AdvancingClock ticks after each read but not on peek', () => {
    const clock = new AdvancingClock(new Date('2026-01-05T08:00:00.000Z'), 5);
    expect(clock.peek().getTime()).toBe(clock.peek().getTime());
    const first = clock.now().getTime();
    expect(clock.now().getTime()).toBe(first + 5);
    clock.advance(1000);
    expect(clock.peek().getTime()).toBe(first + 1010);
  });

  it('attaches untruncated model records when given model info, and none without it', async () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const long = 'x'.repeat(500);
    const modelPort = record(new Port(), 'aiProvider', sink, { name: 'openai:gpt-4o' });
    const plainPort = record(new Port(), 'conversationRepo', sink);

    const arg = { at: clock.now(), text: long };
    await modelPort.save(arg);
    arg.text = 'mutated later';
    await plainPort.save({ at: clock.now(), text: 'b' });
    await expect(modelPort.fail()).rejects.toThrow('boom');

    const [ok, unrecorded, failed] = sink.events;
    expect(ok?.argsSummary.length).toBeLessThanOrEqual(160);
    expect(ok?.model).toEqual({
      name: 'openai:gpt-4o',
      settings: {},
      request: [{ at: '2026-01-05T08:00:00.000Z', text: long }],
      response: `saved:${long}`,
    });
    expect(unrecorded).not.toHaveProperty('model');
    expect(failed?.model).toEqual({ name: 'openai:gpt-4o', settings: {}, request: [], response: { error: 'Error: boom' } });
    for (const event of sink.events) RunEventSchema.parse(event);
  });

  it('marks a non-serializable model request or response explicitly', async () => {
    const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
    const sink = createEventSink(() => clock.peek());
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const port = record({ echo: async (value: unknown) => value }, 'aiProvider', sink, { name: 'm' });
    await port.echo(circular);
    const [event] = sink.events;
    expect(event?.model?.request).toEqual({ unserializable: expect.any(String) });
    expect(event?.model?.response).toEqual({ unserializable: expect.any(String) });
    RunEventSchema.parse(event);
  });
});

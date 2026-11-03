import { describe, expect, it, vi } from 'vitest';
import type { AiProviderPort, OrchestrateResult, ResponseContext } from '@entalent/application';
import {
  buildReportTurn,
  serializeTracedTurn,
  traceWrites,
  TracingAiProvider,
  TurnTrace,
  type TraceSink,
} from './index';

describe('traceWrites', () => {
  it('records state-changing calls before forwarding them, and passes reads through', async () => {
    const trace = new TurnTrace();
    trace.turn = 2;
    const store = {
      saved: [] as string[],
      async saveMessage(input: { text: string; tenantId: string }) { this.saved.push(input.text); return 'ok'; },
      async findById() { return 'found'; },
    };
    const traced = traceWrites(store, 'conversation', trace);
    await expect(traced.saveMessage({ text: 'hello', tenantId: 't' })).resolves.toBe('ok');
    await expect(traced.findById()).resolves.toBe('found');
    expect(store.saved).toEqual(['hello']);
    expect(trace.events).toEqual([{ turn: 2, kind: 'write', name: 'conversation.saveMessage', summary: '{text: "hello"}' }]);
  });

  it('labels outbox calls as queue events and hands raw arguments to observeWrite', async () => {
    const observed: unknown[] = [];
    const trace = new TurnTrace();
    const sink: TraceSink = {
      recording: true,
      record: (...args) => trace.record(...args),
      observeWrite: (store, method, args) => observed.push([store, method, args]),
    };
    const outbox = { enqueueMessageSend: vi.fn(async (_payload: unknown) => undefined) };
    await traceWrites(outbox, 'outbox', sink).enqueueMessageSend({ messageId: 'm' });
    expect(trace.events[0]).toMatchObject({ kind: 'queue', name: 'outbox.enqueueMessageSend' });
    expect(observed).toEqual([['outbox', 'enqueueMessageSend', [{ messageId: 'm' }]]]);
  });

  it('still runs the call unchanged when the sink or the summary throws', async () => {
    const sink: TraceSink = {
      recording: true,
      record: () => { throw new Error('sink down'); },
      observeWrite: () => { throw new Error('observer down'); },
    };
    const hostile = { get boom(): string { throw new Error('getter'); } };
    const repo = { save: vi.fn(async (value: unknown) => value) };
    await expect(traceWrites(repo, 'memory', sink).save(hostile)).resolves.toBe(hostile);
    expect(repo.save.mock.calls[0]?.[0]).toBe(hostile);
  });

  it('builds no summary when the sink is not recording', async () => {
    const record = vi.fn();
    const sink: TraceSink = { recording: false, record };
    const hostile = { get boom(): string { throw new Error('should not be read'); } };
    const repo = { save: vi.fn(async (_value: unknown) => 1) };
    await traceWrites(repo, 'memory', sink).save(hostile);
    expect(record).not.toHaveBeenCalled();
  });

  it('records a rejected write as an error and hands back the same rejection', async () => {
    const trace = new TurnTrace();
    const failure = new Error('unique violation');
    const repo = { save: async () => { throw failure; } };
    await expect(traceWrites(repo, 'memory', trace).save()).rejects.toBe(failure);
    await Promise.resolve();
    expect(trace.events.map((event) => `${event.kind}:${event.name}`)).toEqual(['write:memory.save', 'error:memory.save']);
  });

  it('keeps optional methods optional', () => {
    const repo: { save(): void; findMessagesThrough?: () => void } = { save: () => undefined };
    expect(traceWrites(repo, 'conversation', new TurnTrace()).findMessagesThrough).toBeUndefined();
  });
});

describe('TracingAiProvider', () => {
  const delegate = (overrides: Partial<AiProviderPort>) => overrides as AiProviderPort;

  it('returns the delegate result and records it as an llm event', async () => {
    const trace = new TurnTrace();
    const provider = new TracingAiProvider(delegate({ scoreSentiment: async () => 0.4 }), trace);
    await expect(provider.scoreSentiment('x')).resolves.toBe(0.4);
    expect(trace.events).toEqual([{ turn: 0, kind: 'llm', name: 'scoreSentiment', summary: '0.4' }]);
  });

  it('rethrows the same error and records it', async () => {
    const trace = new TurnTrace();
    const failure = new TypeError('provider down');
    const provider = new TracingAiProvider(delegate({ scoreSentiment: async () => { throw failure; } }), trace);
    await expect(provider.scoreSentiment('x')).rejects.toBe(failure);
    expect(trace.events).toEqual([{ turn: 0, kind: 'error', name: 'scoreSentiment', summary: 'TypeError: provider down' }]);
  });

  it('returns the result even when describing it throws', async () => {
    const sink: TraceSink = { recording: true, record: () => { throw new Error('sink down'); } };
    const provider = new TracingAiProvider(delegate({ scoreSentiment: async () => 1 }), sink, () => { throw new Error('x'); });
    await expect(provider.scoreSentiment('x')).resolves.toBe(1);
  });

  it('hands every generation request to onGenerate before it runs', async () => {
    const calls: unknown[] = [];
    const context = { languagePolicy: { responseLanguage: 'en' } } as unknown as ResponseContext;
    const strategy = { mode: 'coach', tone: 'warm', maxResponseLength: 'short' } as never;
    const provider = new TracingAiProvider(
      delegate({ generateResponse: async () => ({ text: 'Hi there' }) as never }),
      new TurnTrace(),
      (call) => calls.push(call.context),
    );
    await provider.generateResponse([], strategy, context);
    expect(calls).toEqual([context]);
  });
});

describe('buildReportTurn', () => {
  it('copes with an outcome turn that has no classification or risk', () => {
    const result = { outcome: 'processing_failed', responseText: 'Sorry', outboundMessageId: 'o' } as unknown as OrchestrateResult;
    expect(buildReportTurn(1, result, null, null)).toMatchObject({
      mode: 'processing_failed', primaryIntent: 'none', risk: { severity: 'none', type: null }, responseInputs: null,
    });
  });
});

describe('serializeTracedTurn', () => {
  const event = (index: number) => ({ turn: 1, kind: 'write' as const, name: `s.save${index}`, summary: 'x'.repeat(100) });

  it('keeps a small payload whole', () => {
    const json = JSON.parse(serializeTracedTurn({ userMessage: 'hi', trace: [event(1)], turn: null, error: null }));
    expect(json).toMatchObject({ schemaVersion: 1, userMessage: 'hi', truncated: false });
  });

  it('bounds the event count and the byte size', () => {
    const many = Array.from({ length: 50 }, (_, index) => event(index));
    const byCount = JSON.parse(serializeTracedTurn(
      { userMessage: 'hi', trace: many, turn: null, error: null }, { maxEvents: 10, maxBytes: 1_000_000 }));
    expect(byCount.trace).toHaveLength(10);
    expect(byCount.truncated).toBe(true);

    const text = serializeTracedTurn(
      { userMessage: 'y'.repeat(20_000), trace: many, turn: null, error: null }, { maxEvents: 400, maxBytes: 8_000 });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8_000);
    expect(JSON.parse(text).truncated).toBe(true);
  });

  it('first drops bulky inputs and effects but keeps the decisions', () => {
    const turn = {
      index: 1, classification: { primaryIntent: 'venting' }, responseInputs: { memoryContext: { items: ['z'.repeat(9_000)] } },
      effects: { outboundMetadata: null, memoryAdded: [], escalations: [], generationAttempts: 1 }, mode: 'coach',
      primaryIntent: 'venting', requiresSafetyCheck: false, risk: { severity: 'none', type: null }, responseLength: 2,
      responseText: 'ok', replyPlan: { responseMove: 'acknowledge' } as never, replyBrief: null,
    };
    const json = JSON.parse(serializeTracedTurn(
      { userMessage: 'hi', trace: [event(1)], turn, error: null }, { maxEvents: 400, maxBytes: 4_000 }));
    expect(json.truncated).toBe(true);
    expect(json.turn).toMatchObject({ classification: { primaryIntent: 'venting' }, replyPlan: { responseMove: 'acknowledge' }, responseInputs: null, effects: null });
  });

  it('keeps the state section through the first reduction and drops it only as a last resort', () => {
    const stateBefore = { readAfterWrite: [], memory: [{ category: 'work', content: 'm', importance: 0.5 }] };
    const turn = {
      index: 1, classification: {}, responseInputs: { x: 'z'.repeat(6_000) }, effects: null, mode: 'coach',
      primaryIntent: 'venting', requiresSafetyCheck: false, risk: { severity: 'none', type: null }, responseLength: 2,
      responseText: 'ok', replyPlan: null, replyBrief: null,
    };
    const reduced = JSON.parse(serializeTracedTurn(
      { userMessage: 'hi', trace: [event(1)], turn, error: null, stateBefore }, { maxEvents: 400, maxBytes: 4_000 }));
    expect(reduced.truncated).toBe(true);
    expect(reduced.stateBefore).toEqual(stateBefore);

    // A bulky state section goes first: the structured turn and the events stay.
    const huge = { readAfterWrite: [], memory: [{ category: 'work', content: 'q'.repeat(9_000), importance: 0.5 }] };
    const withoutState = JSON.parse(serializeTracedTurn(
      { userMessage: 'hi', trace: [event(1)], turn: { ...turn, responseInputs: null }, error: null, stateBefore: huge },
      { maxEvents: 400, maxBytes: 4_000 }));
    expect(withoutState.stateBefore).toBeUndefined();
    expect(withoutState.turn).toMatchObject({ primaryIntent: 'venting' });
    expect(withoutState.trace).toHaveLength(1);
    expect(withoutState.truncated).toBe(true);
  });

  it('keeps the last event when only a few events fit', () => {
    const many = [...Array.from({ length: 50 }, (_, index) => event(index)), { turn: 1, kind: 'decision' as const, name: 'turn outcome', summary: 'mode=coach' }];
    const json = JSON.parse(serializeTracedTurn({ userMessage: 'hi', trace: many, turn: null, error: null }, { maxEvents: 400, maxBytes: 2_000 }));
    expect(json.trace.at(-1)).toMatchObject({ name: 'turn outcome' });
    expect(json.trace.length).toBeLessThan(51);
  });
});

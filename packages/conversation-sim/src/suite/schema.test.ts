import { describe, expect, it } from 'vitest';
import { syntheticRun } from './rules/synthetic-run';
import {
  CaseRunSchema,
  CriterionResultSchema,
  ObservationFieldSchema,
  SeedSchema,
  STATE_QUERY_VALUE_SCHEMAS,
  StateQueryNameSchema,
  StateSnapshotSchema,
  StepObservationSchema,
  fieldObserved,
  parseEvaluatedAt,
  type CaseRun,
} from './schema';

function richRun(): CaseRun {
  const base = syntheticRun('X-01.J', ['First reply.', null], ['reply.text', 'reply.messages', 'events', 'state.stagedBundleCount']);
  const first = base.steps[0]!;
  return {
    ...base,
    subject: { externalUserId: 'suite-run-X-01.J', userId: 'u1', conversationId: 'c1', tenantId: 't1' },
    preconditions: [{ source: 'fixture', name: 'freshPersona', satisfied: true }],
    steps: [
      {
        ...first,
        reply: {
          messages: [
            { id: 'm1', text: 'First reply.', occurredAt: '2026-01-05T10:01:00.000Z', metadata: { bundleKind: 'pulse' } },
            { id: 'm2', text: 'Second part.', occurredAt: '2026-01-05T10:01:01.000Z', metadata: {} },
          ],
          text: 'First reply.\n\nSecond part.',
        },
        turn: { mode: 'coaching', intent: 'share', bundleReply: 'answer_then_bundle', replyPlan: { kind: 'answer' } },
      },
      { ...base.steps[1]!, turn: { outcome: 'input_filtered' } },
    ],
    window: { from: '2026-01-05T00:00:00.000Z', to: '2026-01-12T00:00:00.000Z', outbound: [] },
    state: {
      before: { stagedBundleCount: 0, questionProgress: { answered: 0, total: 5 } },
      after: { stagedBundleCount: 1 },
      afterStep: { '1': { stagedBundleCount: 1 } },
    },
    stoppedAtStep: 2,
    errors: [{ kind: 'infrastructure', step: 2, reason: 'transport', message: 'socket hang up' }],
    events: [
      {
        stepIndex: 0,
        seq: 0,
        port: 'conversationRepo',
        method: 'saveMessage',
        argsSummary: 'seed coach turn',
        outcome: 'ok',
        resultSummary: 'saved',
        durationMs: 0,
      },
      {
        stepIndex: 1,
        seq: 1,
        port: 'aiProvider',
        method: 'generateResponse',
        argsSummary: 'strategy=coaching',
        outcome: 'ok',
        resultSummary: '1 message',
        durationMs: 3.5,
        model: { name: 'scripted', settings: {}, request: { turns: 1 }, response: { text: 'First reply.' } },
      },
    ],
  };
}

describe('CaseRun', () => {
  it('round-trips through JSON unchanged', () => {
    const run = richRun();
    const parsed = CaseRunSchema.parse(JSON.parse(JSON.stringify(run)));
    expect(parsed).toEqual(run);
  });

  it('requires events and 1-based step indices', () => {
    const withoutEvents: Partial<CaseRun> = richRun();
    delete withoutEvents.events;
    expect(CaseRunSchema.safeParse(withoutEvents).success).toBe(false);

    const run = richRun();
    run.steps[1] = { ...run.steps[1]!, index: 3 };
    const result = CaseRunSchema.safeParse(run);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['steps', 1, 'index']);
  });

  it('accepts an optional clock range and rejects an inverted one', () => {
    const run = richRun();
    expect(CaseRunSchema.safeParse(run).success).toBe(true);
    const clock = { from: '2026-01-05T10:00:00.000Z', to: '2026-01-05T12:00:00+02:00' };
    expect(CaseRunSchema.parse({ ...run, clock }).clock).toEqual(clock);
    const inverted = CaseRunSchema.safeParse({ ...run, clock: { from: '2026-01-05T10:00:01Z', to: '2026-01-05T10:00:00Z' } });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(['clock', 'to']);
    expect(CaseRunSchema.safeParse({ ...run, clock: { from: '2026-01-05T10:00:00Z' } }).success).toBe(false);
    expect(CaseRunSchema.safeParse({ ...run, clock: { ...clock, extra: 1 } }).success).toBe(false);
  });

  it('enforces the reply.text join invariant', () => {
    const step = richRun().steps[0]!;
    const broken = { ...step, reply: { ...step.reply!, text: 'First reply. Second part.' } };
    const result = StepObservationSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['reply', 'text']);
  });

  it('accepts observed silence as a null reply', () => {
    expect(StepObservationSchema.parse(richRun().steps[1]).reply).toBeNull();
  });
});

describe('state snapshots', () => {
  it('has one value schema per state query', () => {
    expect(Object.keys(STATE_QUERY_VALUE_SCHEMAS).sort()).toEqual([...StateQueryNameSchema.options].sort());
  });

  it('validates per-query values and allows partial snapshots', () => {
    expect(StateSnapshotSchema.parse({})).toEqual({});
    expect(StateSnapshotSchema.safeParse({ outboundCount: -1 }).success).toBe(false);
    expect(StateSnapshotSchema.safeParse({ outboundCount: 1.5 }).success).toBe(false);
    expect(StateSnapshotSchema.safeParse({ questionProgress: { answered: 2 } }).success).toBe(false);
    expect(StateSnapshotSchema.safeParse({ questionProgress: { answered: 3, total: 2 } }).success).toBe(false);
    expect(StateSnapshotSchema.safeParse({ unknownQuery: 1 }).success).toBe(false);
  });
});

describe('ObservationField', () => {
  it('accepts declared fields and metadata keys, and rejects anything else', () => {
    for (const field of ['reply.text', 'turn.replyPlan', 'state.outboundCount', 'events', 'reply.messages[].metadata.bundleKind']) {
      expect(ObservationFieldSchema.safeParse(field).success).toBe(true);
    }
    for (const field of ['reply', 'state.unknown', 'turn.foo', 'reply.messages[].metadata.', 'reply.messages[].metadata.a.b', 7]) {
      expect(ObservationFieldSchema.safeParse(field).success).toBe(false);
    }
  });

  it('has a state.<query> field for every state query', () => {
    for (const name of StateQueryNameSchema.options) {
      expect(ObservationFieldSchema.safeParse(`state.${name}`).success).toBe(true);
    }
  });

  it('matches observed fields exactly or by a declared parent path', () => {
    expect(fieldObserved('reply.text', ['reply.text'])).toBe(true);
    expect(fieldObserved('reply.messages[].metadata.bundleKind', ['reply.messages'])).toBe(true);
    expect(fieldObserved('reply.messages[].metadata.bundleKind', ['reply.messages[].metadata.bundleKind'])).toBe(true);
    expect(fieldObserved('reply.messages[].metadata.bundleKind', ['reply.messages[].metadata.other'])).toBe(false);
    expect(fieldObserved('reply.text', ['reply.messages'])).toBe(false);
    expect(fieldObserved('reply.messages', ['reply.messages[].metadata.bundleKind'])).toBe(false);
    expect(fieldObserved('events', [])).toBe(false);
  });
});

describe('parseEvaluatedAt', () => {
  it('parses every evaluation point', () => {
    expect(parseEvaluatedAt('reply:3')).toEqual({ kind: 'reply', step: 3 });
    expect(parseEvaluatedAt('after-step:12')).toEqual({ kind: 'after-step', step: 12 });
    expect(parseEvaluatedAt('conversation')).toEqual({ kind: 'conversation' });
    expect(parseEvaluatedAt('observation-window')).toEqual({ kind: 'observation-window' });
    expect(parseEvaluatedAt('state')).toEqual({ kind: 'state' });
  });

  it('throws on malformed values', () => {
    for (const value of ['reply:0', 'reply:', 'reply:01', 'after-step:x', 'window', '']) {
      expect(() => parseEvaluatedAt(value)).toThrow(/invalid evaluatedAt/);
    }
  });
});

describe('seed and results', () => {
  it('requires non-increasing seed offsets', () => {
    expect(SeedSchema.safeParse({ history: [] }).success).toBe(true);
    expect(
      SeedSchema.safeParse({
        history: [
          { role: 'coach', text: 'a', atOffsetMs: 60_000 },
          { role: 'user', text: 'b', atOffsetMs: 60_000 },
        ],
      }).success,
    ).toBe(true);
    expect(SeedSchema.safeParse({ history: [{ role: 'user', text: 'a', atOffsetMs: -1 }] }).success).toBe(false);
  });

  it('validates a criterion result', () => {
    const result = {
      testId: 'P-09.A1',
      criterionId: 'P-09.C3',
      sourceCase: 'P-09',
      level: 'L0',
      layer: 'S',
      testKind: 'atomic',
      inScope: true,
      step: 1,
      status: 'NOT_RUN',
      advisory: false,
      method: 'n/a',
      reason: 'unobservable:reply.text@L0',
    };
    expect(CriterionResultSchema.parse(result)).toEqual(result);
    expect(CriterionResultSchema.safeParse({ ...result, status: 'SKIPPED' }).success).toBe(false);
  });
});

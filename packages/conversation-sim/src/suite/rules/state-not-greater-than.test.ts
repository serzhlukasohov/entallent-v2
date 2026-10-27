import { describe, expect, it } from 'vitest';
import { stateNotGreaterThan } from './state-not-greater-than';
import { stateFixtureRun } from './synthetic-run';
import type { CaseRun } from '../schema';

const at = { id: 'P-09.C4', evaluatedAt: 'state' };
const run = stateFixtureRun(
  'P-09.A1',
  { before: { outboundCount: 3 }, after: { outboundCount: 4 }, afterStep: {} },
  ['state.outboundCount'],
);

describe('state-not-greater-than', () => {
  it('PASSes at the bound and FAILs above it', () => {
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after', max: 4 })).toEqual({ status: 'PASS' });
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after', max: 3 })).toEqual({
      status: 'FAIL',
      evidence: 'state.outboundCount@after: 4 (max 3)',
    });
  });

  it('compares the growth since before with delta', () => {
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after', max: 1, delta: true })).toEqual({ status: 'PASS' });
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after', max: 0, delta: true })).toEqual({
      status: 'FAIL',
      evidence: 'state.outboundCount@after - state.outboundCount@before: 1 (max 0)',
    });
  });

  it('defaults delta to false when params omit it', () => {
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after', max: 1 }).status).toBe('FAIL');
  });

  it('is NOT_OBSERVABLE state-not-read when a needed snapshot is absent', () => {
    const noBefore = stateFixtureRun('P-09.A1', { before: {}, after: { outboundCount: 4 }, afterStep: {} }, ['state.outboundCount']);
    expect(stateNotGreaterThan.run(noBefore, at, { query: 'outboundCount', at: 'after', max: 1, delta: true })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'state-not-read:outboundCount@before',
    });
    expect(stateNotGreaterThan.run(run, at, { query: 'outboundCount', at: 'after-step:1', max: 1 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'state-not-read:outboundCount@after-step:1',
    });
  });

  it('is NOT_OBSERVABLE when the query is not declared', () => {
    const undeclared = { ...run, observed: ['events' as const] };
    expect(stateNotGreaterThan.run(undeclared, at, { query: 'outboundCount', at: 'after', max: 1 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'unobservable:state.outboundCount@L0',
    });
  });

  it('accepts count queries only', () => {
    const schema = stateNotGreaterThan.params!;
    for (const query of ['stagedBundleCount', 'surveyEvidenceCount', 'outboundCount']) {
      expect(schema.safeParse({ query, at: 'after', max: 0 }).success, query).toBe(true);
    }
    expect(schema.safeParse({ query: 'questionProgress', at: 'after', max: 1 }).success).toBe(false);
    expect(schema.safeParse({ query: 'outboundCount', at: 'after', max: -1 }).success).toBe(false);
  });

  it('rejects delta or repliesWithMetadata with at: before and accepts both max forms', () => {
    const schema = stateNotGreaterThan.params!;
    const rejected = schema.safeParse({ query: 'outboundCount', at: 'before', max: 0, delta: true });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues[0]?.path).toEqual(['delta']);
    expect(schema.safeParse({ query: 'outboundCount', at: 'before', max: 0 }).success).toBe(true);
    const metadataBefore = schema.safeParse({ query: 'outboundCount', at: 'before', max: { repliesWithMetadata: 'k' } });
    expect(metadataBefore.success).toBe(false);
    expect(metadataBefore.error?.issues[0]?.path).toEqual(['max']);
    expect(schema.safeParse({ query: 'surveyEvidenceCount', at: 'after', max: { repliesWithMetadata: 'surveySummary' } }).success).toBe(true);
    expect(schema.safeParse({ query: 'surveyEvidenceCount', at: 'after', max: { repliesWithMetadata: 'bad key' } }).success).toBe(false);
    expect(schema.safeParse({ query: 'surveyEvidenceCount', at: 'after', max: { repliesWithMetadata: 'k', extra: 1 } }).success).toBe(false);
  });

  describe('max: { repliesWithMetadata } (P-09)', () => {
    const key = 'surveySummary';
    const p09 = { query: 'surveyEvidenceCount', at: 'after', delta: true, max: { repliesWithMetadata: key } };
    /** Two replies carry `metadata[key] === true`, one carries `'true'`, one nothing. */
    function p09Run(after: number): CaseRun {
      const base = stateFixtureRun(
        'P-09.A1',
        { before: { surveyEvidenceCount: 0 }, after: { surveyEvidenceCount: after }, afterStep: {} },
        ['state.surveyEvidenceCount', 'reply.messages'],
        ['Summary one.', 'Summary two.', 'Not one.', 'Plain.'],
      );
      const flags: unknown[] = [true, true, 'true', undefined];
      return {
        ...base,
        steps: base.steps.map((step, position) => ({
          ...step,
          reply: {
            ...step.reply!,
            messages: step.reply!.messages.map((message) =>
              flags[position] === undefined ? message : { ...message, metadata: { [key]: flags[position] } },
            ),
          },
        })),
      };
    }

    it('PASSes when growth equals the replies that carry the key', () => {
      expect(stateNotGreaterThan.run(p09Run(2), at, p09)).toEqual({ status: 'PASS' });
    });

    it('FAILs when growth exceeds them, naming the measured value and the resolved max', () => {
      expect(stateNotGreaterThan.run(p09Run(3), at, p09)).toEqual({
        status: 'FAIL',
        evidence: `state.surveyEvidenceCount@after - state.surveyEvidenceCount@before: 3 (max 2 = replies with metadata.${key})`,
      });
    });

    it('counts only the steps the snapshot covers for after-step:<n>', () => {
      const run = p09Run(2);
      const stepped = { ...run, state: { ...run.state, afterStep: { '1': { surveyEvidenceCount: 2 } } } };
      expect(stateNotGreaterThan.run(stepped, at, { ...p09, at: 'after-step:1' })).toEqual({
        status: 'FAIL',
        evidence: `state.surveyEvidenceCount@after-step:1 - state.surveyEvidenceCount@before: 2 (max 1 = replies with metadata.${key})`,
      });
    });

    it('works without delta against the absolute count', () => {
      expect(stateNotGreaterThan.run(p09Run(2), at, { ...p09, delta: false }).status).toBe('PASS');
      expect(stateNotGreaterThan.run(p09Run(3), at, { ...p09, delta: undefined }).status).toBe('FAIL');
    });

    it('is NOT_OBSERVABLE when reply messages are not declared', () => {
      const run = { ...p09Run(2), observed: ['state.surveyEvidenceCount' as const] };
      expect(stateNotGreaterThan.run(run, at, p09)).toEqual({
        status: 'NOT_OBSERVABLE',
        evidence: `unobservable:reply.messages[].metadata.${key}@L0`,
      });
      const declared = { ...run, observed: ['state.surveyEvidenceCount' as const, `reply.messages[].metadata.${key}` as const] };
      expect(stateNotGreaterThan.run(declared, at, p09).status).toBe('PASS');
    });

    it('resolves to 0 when no reply carries the key', () => {
      const run = stateFixtureRun(
        'P-09.A1',
        { before: { surveyEvidenceCount: 0 }, after: { surveyEvidenceCount: 1 }, afterStep: {} },
        ['state.surveyEvidenceCount', 'reply.messages'],
      );
      expect(stateNotGreaterThan.run(run, at, p09)).toMatchObject({ status: 'FAIL', evidence: expect.stringMatching(/: 1 \(max 0 = /) });
    });
  });
});

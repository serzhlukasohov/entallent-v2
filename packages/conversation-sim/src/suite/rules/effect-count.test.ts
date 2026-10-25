import { describe, expect, it } from 'vitest';
import { evaluate } from '../evaluate';
import type { LoadedTest, RunEvent } from '../schema';
import { effectCount } from './effect-count';
import { RULES } from './registry';
import { syntheticRun } from './synthetic-run';

const at = { id: 'P-09.C2', evaluatedAt: 'state' };
const params = { port: 'questionConfirmationRepo', method: 'stageBundle', expected: 1, step: 1 };

function call(stepIndex: number, outcome: RunEvent['outcome'] = 'ok', method = 'stageBundle'): RunEvent {
  return { stepIndex, seq: 0, port: 'questionConfirmationRepo', method, argsSummary: '', outcome, resultSummary: '', durationMs: 1 };
}

const runWith = (events: RunEvent[], steps = 1) => ({
  ...syntheticRun('P-09.A1', Array.from({ length: steps }, () => 'ok'), ['events']),
  events,
});

describe('effect-count', () => {
  it('counts only ok calls of the evaluated step', () => {
    expect(effectCount.run(runWith([call(1), call(1, 'error')]), at, params)).toEqual({ status: 'PASS' });
  });

  it('FAILs in the stand-in evidence format', () => {
    expect(effectCount.run(runWith([call(0), call(1, 'ok', 'other')]), at, params)).toEqual({
      status: 'FAIL',
      evidence: 'effect-count questionConfirmationRepo.stageBundle@1: 0',
    });
    expect(effectCount.run(runWith([call(1), call(1)]), at, params).status).toBe('FAIL');
  });

  it('is NOT_OBSERVABLE step-not-reached when the step is beyond the run', () => {
    expect(effectCount.run(runWith([call(1)]), at, { ...params, step: 2 })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'step-not-reached:2',
    });
  });

  it('is NOT_OBSERVABLE step-not-reached for a step past stoppedAtStep', () => {
    const run = { ...runWith([call(1), call(2)], 3), stoppedAtStep: 1 };
    expect(effectCount.run(run, at, { ...params, step: 2 })).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'step-not-reached:2' });
    expect(effectCount.run(run, at, params)).toEqual({ status: 'PASS' });
  });

  it('counts step 0 (fixtures and seed)', () => {
    expect(effectCount.run(runWith([call(0)]), at, { ...params, step: 0 })).toEqual({ status: 'PASS' });
  });

  it('is NOT_OBSERVABLE without events', () => {
    const run = { ...runWith([call(1)]), observed: ['reply.text' as const] };
    expect(effectCount.run(run, at, params)).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'unobservable:events@L0' });
  });

  it('throws on malformed synthesized params (a manifest bug)', () => {
    expect(() => effectCount.run(runWith([]), at, { port: 'p', method: 'm', expected: -1, step: 1 })).toThrow();
    expect(() => effectCount.run(runWith([]), at, undefined)).toThrow();
  });

  it('pairs with a change criterion through evaluate and the real registry', () => {
    const test: LoadedTest = {
      id: 'P-09.A1',
      sourceCase: 'P-09',
      requirement: ['REQ-1'],
      kind: 'atomic',
      levels: ['L0'],
      runProfile: 'isolated',
      setup: [],
      seed: { history: [] },
      scripted: [{ step: 1, response: { text: 'Scripted.' } }],
      preconditions: [],
      steps: [{ text: 'User turn.' }],
      criteria: [
        {
          id: 'P-09.C2',
          evaluatedAt: 'state',
          stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'stagedBundleCount', at: 'after', expected: 1 } }],
          layer: 'S',
          passCondition: 'Staged bundle count grows by one.',
          stateEffect: { port: 'questionConfirmationRepo', method: 'stageBundle', expected: 1 },
        },
      ],
    };
    const state = { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 1 }, afterStep: {} };
    const observed = ['events' as const, 'state.stagedBundleCount' as const];
    const trust = { trusted: true, reason: 'calibrated', pin: null, agreement: null };
    const base = { ...syntheticRun('P-09.A1', ['ok'], observed), state };
    expect(evaluate(test, { ...base, events: [call(1)] }, null, trust, RULES)[0]).toMatchObject({ status: 'PASS' });
    expect(evaluate(test, { ...base, events: [call(1, 'error')] }, null, trust, RULES)[0]).toMatchObject({
      status: 'FAIL',
      evidence: expect.stringContaining('effect-count questionConfirmationRepo.stageBundle@1: 0'),
    });
  });
});

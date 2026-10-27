import { RULES, type RuleEntry, type RuleRegistry } from '../rules/registry';
import { syntheticRun } from '../rules/synthetic-run';
import type { CaseRun, CriterionResult, JudgeTrust, LoadedCriterion, LoadedTest, RunEvent, StateQueryName } from '../schema';

/** Test-local rules for evaluate/score tests; none of them is a registry rule. */

const pass = syntheticRun('RULE-local-pass', ['ok'], ['events']);
const fixtures = { pass, fail: pass };

const alwaysPass: RuleEntry = { requires: [], run: () => ({ status: 'PASS' }), fixtures };
const alwaysFail: RuleEntry = {
  requires: [],
  run: () => ({ status: 'FAIL', evidence: 'turn 1 — always fails' }),
  fixtures,
};
const notObservable: RuleEntry = {
  requires: [],
  run: () => ({ status: 'NOT_OBSERVABLE', evidence: 'no-replies' }),
  fixtures,
};

/** PASS when the snapshot named by `params.at` holds `params.equals` for `params.name`. */
const stateIs: RuleEntry = {
  requires: ['state.stagedBundleCount'],
  run(run, _criterion, params = {}) {
    const at = String(params.at);
    const snapshot = at === 'after' ? run.state.after : at === 'before' ? run.state.before : run.state.afterStep[at];
    const value = snapshot?.[params.name as StateQueryName];
    return value === params.equals
      ? { status: 'PASS' }
      : { status: 'FAIL', evidence: `${String(params.name)} is ${JSON.stringify(value)}` };
  },
  fixtures,
};

/** Stand-in for Story 12.3's `effect-count`: exact successful calls of port.method at step. */
const effectCount: RuleEntry = {
  requires: ['events'],
  run(run, _criterion, params = {}) {
    const count = run.events.filter(
      (event) =>
        event.stepIndex === params.step &&
        event.port === params.port &&
        event.method === params.method &&
        event.outcome === 'ok',
    ).length;
    return count === params.expected
      ? { status: 'PASS' }
      : { status: 'FAIL', evidence: `effect-count ${String(params.port)}.${String(params.method)}@${String(params.step)}: ${count}` };
  },
  fixtures,
};

/** Checkpoint rule: FAIL when the reply of the evaluated step contains "BAD". */
const noBad: RuleEntry = {
  requires: ['reply.text'],
  run(run, criterion) {
    const step = Number(criterion.evaluatedAt.split(':')[1]);
    return run.steps[step - 1]?.reply?.text.includes('BAD')
      ? { status: 'FAIL', evidence: `turn ${step} — BAD` }
      : { status: 'PASS' };
  },
  fixtures,
};

/** Observation rule: PASS when the window holds at least one outbound message. */
const windowOutbound: RuleEntry = {
  requires: ['window.outbound'],
  run: (run) =>
    (run.window?.outbound.length ?? 0) > 0 ? { status: 'PASS' } : { status: 'FAIL', evidence: 'no outbound in window' },
  fixtures,
};

export const EVAL_RULES: RuleRegistry = {
  'window-outbound': windowOutbound,
  ...RULES,
  'always-pass': alwaysPass,
  'always-fail': alwaysFail,
  'not-observable': notObservable,
  'state-is': stateIs,
  'effect-count': effectCount,
  'no-bad': noBad,
};

export const TRUSTED: JudgeTrust = { trusted: true, reason: 'calibrated', pin: null, agreement: null };
export const UNTRUSTED: JudgeTrust = { trusted: false, reason: 'no-agreement', pin: null, agreement: null };

export function criterion(overrides: Partial<LoadedCriterion> & Pick<LoadedCriterion, 'id'>): LoadedCriterion {
  return {
    evaluatedAt: 'reply:1',
    checks: [{ type: 'rule', rule: 'always-pass' }],
    layer: 'P',
    passCondition: 'Suite text.',
    ...overrides,
  };
}

export function atomic(criteria: LoadedCriterion[], overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-01.A1',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'atomic',
    levels: ['L0', 'L1'],
    runProfile: 'isolated',
    setup: [],
    seed: { history: [] },
    scripted: [{ step: 1, response: { text: 'Scripted.' } }],
    preconditions: [],
    steps: [{ text: 'User turn.' }],
    criteria,
    ...overrides,
  };
}

export function journey(stepCount: number, criteria: LoadedCriterion[], overrides: Partial<LoadedTest> = {}): LoadedTest {
  return {
    id: 'X-01.J',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'journey',
    levels: ['L0', 'L1', 'L2'],
    runProfile: 'isolated',
    setup: [],
    preconditions: [],
    steps: Array.from({ length: stepCount }, (_, index) => ({ text: `Step ${index + 1}.` })),
    criteria,
    ...overrides,
  };
}

export function runFor(
  test: Pick<LoadedTest, 'id'>,
  replies: ReadonlyArray<string | null>,
  overrides: Partial<CaseRun> = {},
): CaseRun {
  return {
    ...syntheticRun(test.id, replies, ['reply.text', 'reply.messages', 'events', 'state.stagedBundleCount']),
    ...overrides,
  };
}

export function event(stepIndex: number, port: string, method: string, seq = 0): RunEvent {
  return { stepIndex, seq, port, method, argsSummary: '', outcome: 'ok', resultSummary: '', durationMs: 1 };
}

export function result(
  overrides: Partial<CriterionResult> & Pick<CriterionResult, 'testId' | 'criterionId' | 'status'>,
): CriterionResult {
  return {
    sourceCase: overrides.criterionId.split('.')[0]!,
    level: 'L0',
    layer: 'P',
    testKind: 'atomic',
    inScope: true,
    step: 1,
    advisory: false,
    method: 'n/a',
    ...overrides,
  };
}

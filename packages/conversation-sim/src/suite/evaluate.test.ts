import { describe, expect, it } from 'vitest';
import {
  EVAL_RULES,
  TRUSTED,
  UNTRUSTED,
  atomic,
  criterion,
  event,
  journey,
  runFor,
} from './__fixtures__/evaluation';
import { deepFreeze } from './__fixtures__/suite';
import { evaluate } from './evaluate';
import { createCriterionJudge } from './judge/criterion-judge';
import { mockJudgeModel, promptOf, verdict, type MockStep } from './judge/__fixtures__/mock-model';
import { buildJudgeInput } from './judge/judge-input';
import { renderJudgePrompt } from './judge/prompt';
import { RULES } from './rules/registry';
import { CriterionResultSchema, type CaseRun, type CriterionResult, type LoadedCriterion, type LoadedTest } from './schema';

const C1 = 'X-01.C1';
const C2 = 'X-01.C2';
const C3 = 'X-01.C3';
const C4 = 'X-01.C4';
const C5 = 'X-01.C5';

function only(test: LoadedTest, run: CaseRun, trust = TRUSTED): CriterionResult {
  const results = evaluate(test, run, null, trust, EVAL_RULES);
  expect(results).toHaveLength(1);
  expect(CriterionResultSchema.safeParse(results[0]).success).toBe(true);
  return results[0]!;
}

function byId(results: CriterionResult[]): Record<string, CriterionResult> {
  return Object.fromEntries(results.map((entry) => [entry.criterionId, entry]));
}

const stagedChange = (overrides: Partial<LoadedCriterion> = {}) =>
  criterion({
    id: C2,
    layer: 'S',
    evaluatedAt: 'state',
    stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'change' },
    checks: [{ type: 'rule', rule: 'state-is', params: { at: 'after', name: 'stagedBundleCount', equals: 1 } }],
    stateEffect: { port: 'questionConfirmationRepo', method: 'stageBundle', expected: 1 },
    ...overrides,
  });

describe('evaluate: rule outcomes', () => {
  it('PASSes when every rule check passes', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-pass' }, { type: 'rule', rule: 'always-pass' }] })]);
    expect(only(test, runFor(test, ['Fine.']))).toEqual({
      testId: 'X-01.A1',
      criterionId: C1,
      sourceCase: 'X-01',
      level: 'L0',
      layer: 'P',
      testKind: 'atomic',
      inScope: true,
      step: 1,
      status: 'PASS',
      advisory: false,
      method: 'n/a',
    });
  });

  it('FAILs with evidence when any rule check fails', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-pass' }, { type: 'rule', rule: 'always-fail' }] })]);
    expect(only(test, runFor(test, ['Fine.']))).toMatchObject({ status: 'FAIL', evidence: 'turn 1 — always fails' });
  });

  it('FAILs a registry rule on the reply it inspects', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'too-many-questions' }] })]);
    expect(only(test, runFor(test, ['How is it going? And the team?']))).toMatchObject({
      status: 'FAIL',
      evidence: 'turn 1 — How is it going? / And the team?',
    });
  });
});

describe('evaluate: judge null', () => {
  it('makes a meaning-only criterion NOT_RUN no-judge-at-level and out of scope', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'meaning' }] })]);
    expect(only(test, runFor(test, ['Fine.']), UNTRUSTED)).toMatchObject({
      status: 'NOT_RUN',
      reason: 'no-judge-at-level',
      inScope: false,
      advisory: true,
    });
    expect(only(test, runFor(test, ['Fine.']), TRUSTED).advisory).toBe(false);
  });

  it('decides a rule-plus-meaning criterion by its rules with meaningSkipped', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-fail' }, { type: 'meaning' }] })]);
    expect(only(test, runFor(test, ['Fine.']), UNTRUSTED)).toMatchObject({
      status: 'FAIL',
      inScope: true,
      advisory: false,
      meaningSkipped: true,
    });
  });
});

describe('evaluate: scope', () => {
  it('is NOT_RUN level-not-declared when the test does not declare the level', () => {
    const test = atomic([criterion({ id: C1 })], { levels: ['L1'] });
    expect(only(test, runFor(test, ['Fine.']))).toMatchObject({
      status: 'NOT_RUN',
      reason: 'level-not-declared',
      inScope: false,
    });
  });

  it('is NOT_RUN level-not-declared when the criterion narrows the level away', () => {
    const test = atomic([criterion({ id: C1, levels: ['L1'] })]);
    expect(only(test, runFor(test, ['Fine.']))).toMatchObject({ status: 'NOT_RUN', reason: 'level-not-declared', inScope: false });
  });
});

describe('evaluate: NOT_RUN', () => {
  it('is NOT_RUN unobservable:<field>@<level> when a required field is not declared', () => {
    const test = atomic([stagedChange({ stateEffect: undefined })]);
    const run = runFor(test, ['Fine.'], { observed: ['reply.text'] });
    expect(only(test, run)).toMatchObject({ status: 'NOT_RUN', reason: 'unobservable:state.stagedBundleCount@L0' });
  });

  it('carries the rule NOT_OBSERVABLE evidence as the reason (conversation over an all-silent run)', () => {
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'conversation', checks: [{ type: 'rule', rule: 'too-many-questions' }] })]);
    expect(only(test, runFor(test, [null, null]))).toMatchObject({ status: 'NOT_RUN', reason: 'no-replies' });
  });

  it('lets NOT_RUN from one check outrank a FAIL from another', () => {
    const test = atomic([
      criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-fail' }, { type: 'rule', rule: 'not-observable' }] }),
    ]);
    expect(only(test, runFor(test, ['Fine.']))).toMatchObject({ status: 'NOT_RUN', reason: 'no-replies' });
  });

  it('is NOT_RUN step-not-reached when the run has fewer steps', () => {
    const test = journey(3, [criterion({ id: C1, evaluatedAt: 'reply:3' }), criterion({ id: C2, evaluatedAt: 'reply:1' })]);
    const results = byId(evaluate(test, runFor(test, ['a', 'b']), null, TRUSTED, EVAL_RULES));
    expect(results[C1]).toMatchObject({ status: 'NOT_RUN', reason: 'step-not-reached:3' });
    expect(results[C2]!.status).toBe('PASS');
  });

  it('is NOT_RUN step-not-reached past stoppedAtStep', () => {
    const test = journey(3, [criterion({ id: C1, evaluatedAt: 'reply:3' }), criterion({ id: C2, evaluatedAt: 'conversation', independentOfCheckpoints: true })]);
    const results = byId(evaluate(test, runFor(test, ['a', 'b', 'c'], { stoppedAtStep: 2 }), null, TRUSTED, EVAL_RULES));
    expect(results[C1]).toMatchObject({ status: 'NOT_RUN', reason: 'step-not-reached:3' });
    expect(results[C2]).toMatchObject({ status: 'NOT_RUN', reason: 'step-not-reached:3' });
  });

  it('is NOT_RUN with the unsupported-fixture reason, never ERROR', () => {
    const test = atomic([criterion({ id: C1 }), criterion({ id: C2, checks: [{ type: 'rule', rule: 'always-fail' }] })]);
    const run = runFor(test, ['Fine.'], {
      errors: [{ kind: 'infrastructure', step: 0, reason: 'unsupported-fixture:pulseCycle', message: '' }],
    });
    for (const entry of evaluate(test, run, null, TRUSTED, EVAL_RULES)) {
      expect(entry).toMatchObject({ status: 'NOT_RUN', reason: 'unsupported-fixture:pulseCycle', inScope: true });
    }
  });
});

describe('evaluate: INVALID', () => {
  it('makes every criterion INVALID precondition:<name> on a failed precondition', () => {
    const test = atomic([criterion({ id: C1 }), criterion({ id: C2, checks: [{ type: 'rule', rule: 'always-fail' }] })]);
    const run = runFor(test, ['Fine.'], {
      preconditions: [
        { source: 'fixture', name: 'freshPersona', satisfied: true },
        { source: 'fixture', name: 'seededHistory', satisfied: false },
      ],
    });
    for (const entry of evaluate(test, run, null, TRUSTED, EVAL_RULES)) {
      expect(entry).toMatchObject({ status: 'INVALID', reason: 'precondition:seededHistory' });
    }
  });

  it('is INVALID precondition:already-satisfied when a change criterion holds on state.before', () => {
    const test = atomic([stagedChange({ stateEffect: undefined })]);
    const run = runFor(test, ['Fine.'], { state: { before: { stagedBundleCount: 1 }, after: { stagedBundleCount: 1 }, afterStep: {} } });
    expect(only(test, run)).toMatchObject({ status: 'INVALID', reason: 'precondition:already-satisfied' });
  });

  it('substitutes afterStep[n] for an after-step:<n> state query', () => {
    const test = atomic([
      stagedChange({
        stateEffect: undefined,
        stateQuery: { name: 'stagedBundleCount', at: 'after-step:1', kind: 'change' },
        checks: [{ type: 'rule', rule: 'state-is', params: { at: '1', name: 'stagedBundleCount', equals: 1 } }],
      }),
    ]);
    const changed = runFor(test, ['Fine.'], { state: { before: { stagedBundleCount: 0 }, after: {}, afterStep: { '1': { stagedBundleCount: 1 } } } });
    expect(only(test, changed).status).toBe('PASS');
    const held = runFor(test, ['Fine.'], { state: { before: { stagedBundleCount: 1 }, after: {}, afterStep: { '1': { stagedBundleCount: 1 } } } });
    expect(only(test, held)).toMatchObject({ status: 'INVALID', reason: 'precondition:already-satisfied' });
  });

  it('does not treat an invariant criterion that holds on state.before as already satisfied', () => {
    const test = atomic([stagedChange({ stateEffect: undefined, stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'invariant' } })]);
    const run = runFor(test, ['Fine.'], { state: { before: { stagedBundleCount: 1 }, after: { stagedBundleCount: 1 }, afterStep: {} } });
    expect(only(test, run).status).toBe('PASS');
  });

  it('propagates the earliest failing checkpoint to later and dependent criteria', () => {
    const checkpoint = { checks: [{ type: 'rule' as const, rule: 'no-bad' }], onFail: 'continue' as const };
    const test = journey(
      3,
      [
        criterion({ id: C1, evaluatedAt: 'reply:2' }),
        criterion({ id: C2, evaluatedAt: 'reply:3' }),
        criterion({ id: C3, evaluatedAt: 'conversation' }),
        criterion({ id: C4, evaluatedAt: 'conversation', independentOfCheckpoints: true }),
        stagedChange({ id: C5, stateEffect: undefined }),
      ],
      {
        steps: [
          { text: 'Step 1.' },
          { text: 'Step 2.', checkpoint },
          { text: 'Step 3.', checkpoint },
        ],
      },
    );
    const run = runFor(test, ['ok', 'BAD', 'BAD'], { state: { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 1 }, afterStep: {} } });
    const results = byId(evaluate(test, run, null, TRUSTED, EVAL_RULES));
    expect(results[C1]!.status).toBe('PASS');
    expect(results[C2]).toMatchObject({ status: 'INVALID', reason: 'checkpoint:2' });
    expect(results[C3]).toMatchObject({ status: 'INVALID', reason: 'checkpoint:2' });
    expect(results[C4]!.status).toBe('PASS');
    expect(results[C5]).toMatchObject({ status: 'INVALID', reason: 'checkpoint:2' });
  });

  it('ignores a checkpoint past stoppedAtStep', () => {
    const checkpoint = { checks: [{ type: 'rule' as const, rule: 'no-bad' }], onFail: 'stop' as const };
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'reply:1' }), criterion({ id: C2, evaluatedAt: 'conversation' })], {
      steps: [{ text: 'Step 1.' }, { text: 'Step 2.', checkpoint }],
    });
    const results = byId(evaluate(test, runFor(test, ['ok', 'BAD'], { stoppedAtStep: 1 }), null, TRUSTED, EVAL_RULES));
    expect(results[C1]!.status).toBe('PASS');
    expect(results[C2]).toMatchObject({ status: 'NOT_RUN', reason: 'step-not-reached:2' });
  });

  it('ignores a checkpoint that does not FAIL', () => {
    const checkpoint = { checks: [{ type: 'rule' as const, rule: 'not-observable' }], onFail: 'stop' as const };
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'reply:2' })], {
      steps: [{ text: 'Step 1.', checkpoint }, { text: 'Step 2.' }],
    });
    expect(only(test, runFor(test, ['BAD', 'ok'])).status).toBe('PASS');
  });
});

describe('evaluate: ERROR', () => {
  it('is ERROR with the executor reason for errors at or before the criterion step', () => {
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'reply:1' }), criterion({ id: C2, evaluatedAt: 'reply:2' })]);
    const run = runFor(test, ['a', 'b'], {
      errors: [{ kind: 'product', step: 2, reason: 'orchestrator-exception', message: 'boom' }],
    });
    const results = byId(evaluate(test, run, null, TRUSTED, EVAL_RULES));
    expect(results[C1]!.status).toBe('PASS');
    expect(results[C2]).toMatchObject({ status: 'ERROR', reason: 'orchestrator-exception' });
  });

  it('applies a fixture error (step 0) to every criterion', () => {
    const test = atomic([criterion({ id: C1 }), criterion({ id: C2 })]);
    const run = runFor(test, ['a'], {
      errors: [{ kind: 'infrastructure', step: 0, reason: 'fixture-apply:seededHistory', message: '' }],
    });
    for (const entry of evaluate(test, run, null, TRUSTED, EVAL_RULES)) {
      expect(entry).toMatchObject({ status: 'ERROR', reason: 'fixture-apply:seededHistory' });
    }
  });
});

describe('evaluate: precedence', () => {
  const failingPrecondition = { source: 'fixture' as const, name: 'clock', satisfied: false };
  const error = { kind: 'product' as const, step: 1, reason: 'orchestrator-exception', message: '' };
  const unsupported = { kind: 'infrastructure' as const, step: 0, reason: 'unsupported-fixture:pulseCycle', message: '' };

  it.each<[string, Partial<CaseRun>, CriterionResult['status']]>([
    ['INVALID over ERROR', { preconditions: [failingPrecondition], errors: [error] }, 'INVALID'],
    ['ERROR over NOT_RUN unsupported-fixture', { errors: [unsupported, error] }, 'ERROR'],
    ['ERROR over FAIL', { errors: [error] }, 'ERROR'],
  ])('%s', (_label, overrides, status) => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-fail' }] })]);
    expect(only(test, runFor(test, ['a'], overrides)).status).toBe(status);
  });

  it('NOT_RUN step-not-reached over FAIL', () => {
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'reply:2', checks: [{ type: 'rule', rule: 'always-fail' }] })]);
    expect(only(test, runFor(test, ['a'])).status).toBe('NOT_RUN');
  });
});

describe('evaluate: effect-count pairing', () => {
  const stage = (step: number) => event(step, 'questionConfirmationRepo', 'stageBundle');
  const changedState = { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 1 }, afterStep: {} };

  it('pairs a change criterion with effect-count when events are observed', () => {
    const test = atomic([stagedChange()]);
    expect(only(test, runFor(test, ['a'], { state: changedState, events: [stage(1)] })).status).toBe('PASS');
    expect(only(test, runFor(test, ['a'], { state: changedState, events: [stage(0)] }))).toMatchObject({
      status: 'FAIL',
      evidence: 'effect-count questionConfirmationRepo.stageBundle@1: 0',
    });
  });

  it.each([
    ['events are not observed', { observed: ['reply.text' as const, 'state.stagedBundleCount' as const] }, stagedChange()],
    ['the level is L2', { level: 'L2' as const }, stagedChange()],
    ['the criterion is an invariant', {}, stagedChange({ stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'invariant' } })],
  ])('does not pair when %s', (_label, overrides, entry) => {
    const test = journey(1, [entry]);
    expect(only(test, runFor(test, ['a'], { state: changedState, ...overrides })).status).toBe('PASS');
  });

  it('throws when the registry has no effect-count rule for a paired criterion', () => {
    const test = atomic([stagedChange()]);
    const rules = { ...EVAL_RULES };
    delete (rules as Record<string, unknown>)['effect-count'];
    expect(() => evaluate(test, runFor(test, ['a']), null, TRUSTED, rules)).toThrow(/effect-count/);
  });
});

describe('evaluate: method', () => {
  const stage = (step: number) => event(step, 'questionConfirmationRepo', 'stageBundle');
  const changedState = { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 1 }, afterStep: {} };

  it('is substituted for state criteria at L1 and n/a otherwise, with the effect-count pairing unchanged', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-pass' }] }), stagedChange()]);
    const l1 = byId(evaluate(test, runFor(test, ['a'], { level: 'L1', state: changedState, events: [stage(1)] }), null, TRUSTED, EVAL_RULES));
    expect(l1[C1]).toMatchObject({ status: 'PASS', method: 'n/a' });
    expect(l1[C2]).toMatchObject({ status: 'PASS', method: 'substituted' });
    const unpaired = byId(evaluate(test, runFor(test, ['a'], { level: 'L1', state: changedState, events: [stage(0)] }), null, TRUSTED, EVAL_RULES));
    expect(unpaired[C2]).toMatchObject({ status: 'FAIL', method: 'substituted', evidence: 'effect-count questionConfirmationRepo.stageBundle@1: 0' });

    const l0 = byId(evaluate(test, runFor(test, ['a'], { level: 'L0', state: changedState, events: [stage(1)] }), null, TRUSTED, EVAL_RULES));
    expect(l0[C1]).toMatchObject({ method: 'n/a' });
    expect(l0[C2]).toMatchObject({ status: 'PASS', method: 'n/a' });
  });
});

describe('evaluate: seed context', () => {
  it('FAILs repeated-question when the single atomic reply re-asks a seeded coach question', () => {
    const asked = 'What is taking most of your time on the project right now?';
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'repeated-question' }] })], {
      seed: {
        history: [
          { role: 'coach', text: `Morning. ${asked}`, atOffsetMs: 120_000 },
          { role: 'user', text: 'The release.', atOffsetMs: 60_000 },
        ],
      },
    });
    expect(only(test, runFor(test, [`Got it. ${asked}`]))).toMatchObject({
      status: 'FAIL',
      evidence: `turn 1 — ${asked} (already asked in seeded coach turn 1)`,
    });
    expect(only(test, runFor(test, ['Which part of the release worries you?'])).status).toBe('PASS');
  });
});

describe('evaluate: observation tests', () => {
  it.each([
    [['Morning check-in.'], 'PASS'],
    [[], 'FAIL'],
  ] as const)('decides an observation-window criterion at step 0 (%j)', (texts, status) => {
    const test = atomic([criterion({ id: 'X-02.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'window-outbound' }] })], {
      id: 'X-02',
      sourceCase: 'X-02',
      kind: 'observation',
      seed: undefined,
      steps: [],
      scripted: [],
      observationWindow: { durationMs: 604_800_000, scanEveryMs: 3_600_000 },
    });
    const outbound = texts.map((text, index) => ({ id: `w${index}`, text, occurredAt: '2026-01-05T10:00:00.000Z', metadata: {} }));
    const run = runFor(test, [], {
      observed: ['window.outbound'],
      window: { from: '2026-01-05T00:00:00.000Z', to: '2026-01-12T00:00:00.000Z', outbound },
    });
    expect(only(test, run)).toMatchObject({ status, step: 0, testKind: 'observation', inScope: true });
  });
});

describe('evaluate: contract', () => {
  it('is deterministic and does not mutate deep-frozen inputs', () => {
    const test = deepFreeze(
      atomic([
        criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-fail' }, { type: 'meaning' }] }),
        stagedChange(),
        criterion({ id: C3, checks: [{ type: 'meaning' }] }),
      ]),
    );
    const run = deepFreeze(
      runFor(test, ['a'], {
        state: { before: { stagedBundleCount: 1 }, after: { stagedBundleCount: 1 }, afterStep: {} },
        events: [event(1, 'questionConfirmationRepo', 'stageBundle')],
      }),
    );
    const trust = deepFreeze({ ...UNTRUSTED });
    const first = evaluate(test, run, null, trust, EVAL_RULES);
    expect(evaluate(test, run, null, trust, EVAL_RULES)).toEqual(first);
    expect(first.map((entry) => entry.status)).toEqual(['FAIL', 'INVALID', 'NOT_RUN']);
  });

  it('throws on a step index mismatch', () => {
    const test = journey(2, [criterion({ id: C1 })]);
    const run = runFor(test, ['a', 'b']);
    const broken = { ...run, steps: [run.steps[0]!, { ...run.steps[1]!, index: 3 }] };
    expect(() => evaluate(test, broken, null, TRUSTED, EVAL_RULES)).toThrow(/index 3, expected 2/);
  });

  it('throws when the run belongs to another test', () => {
    const test = atomic([criterion({ id: C1 })]);
    expect(() => evaluate(test, runFor({ id: 'X-01.A2' }, ['a']), null, TRUSTED, EVAL_RULES)).toThrow(/X-01.A2/);
  });

  it('throws on a rule that is not in the registry, including checkpoint rules', () => {
    const test = atomic([criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-pass' }] })]);
    expect(() => evaluate(test, runFor(test, ['a']), null, TRUSTED)).toThrow(/always-pass/);
    const withCheckpoint = journey(1, [criterion({ id: C1, checks: [{ type: 'rule', rule: 'too-many-questions' }] })], {
      steps: [{ text: 'Hi.', checkpoint: { checks: [{ type: 'rule', rule: 'missing-rule' }], onFail: 'continue' } }],
    });
    expect(() => evaluate(withCheckpoint, runFor(withCheckpoint, ['a']), null, TRUSTED, RULES)).toThrow(/missing-rule/);
  });
});

describe('evaluate: with a judge (Story 13.1)', () => {
  const DECODING = { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 };
  const MEANING = [{ type: 'meaning' as const }];
  const REPLY = 'Which deadline matters most to you this week?';
  const ONE_CALL = { calls: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120 };

  function meaningTest(criteria: LoadedCriterion[], overrides: Partial<LoadedTest> = {}): LoadedTest {
    return atomic(criteria, { expectedBehavior: 'The coach asks one focused question.', ...overrides });
  }

  async function judged(test: LoadedTest, run: CaseRun, steps: MockStep[], trust = TRUSTED) {
    const model = mockJudgeModel(steps);
    const results = await evaluate(test, run, createCriterionJudge({ model, decoding: DECODING }), trust, EVAL_RULES);
    for (const entry of results) expect(CriterionResultSchema.safeParse(entry).success).toBe(true);
    return { model, results, byId: byId(results) };
  }

  it('puts a meaning-only criterion in scope and sends the judge the full input', async () => {
    const c1 = criterion({ id: C1, checks: MEANING, layer: 'C', passCondition: 'Asks exactly one question.', judgeGuidance: 'Deadlines count.' });
    const topics = [{ topic: 'workload', canonicalQuestions: ['How is your workload?'] }];
    const test = meaningTest([c1], {
      seed: { history: [{ role: 'coach', text: 'Seeded coach turn.', atOffsetMs: 60_000 }] },
      setup: [{ name: 'pulseCycle', params: { uncoveredTopics: topics } }],
    });
    const run = runFor(test, [REPLY]);
    const { model, byId: results } = await judged(test, run, [verdict('PASS', 'One question.', 'Which deadline matters most')]);
    expect(results[C1]).toEqual({
      testId: 'X-01.A1',
      criterionId: C1,
      sourceCase: 'X-01',
      level: 'L0',
      layer: 'C',
      testKind: 'atomic',
      inScope: true,
      step: 1,
      status: 'PASS',
      advisory: false,
      method: 'n/a',
      reason: 'One question.',
      evidence: 'Which deadline matters most',
      judgeUsage: ONE_CALL,
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = promptOf(model);
    expect(prompt).toBe(renderJudgePrompt(buildJudgeInput(test, run, c1).input));
    expect(prompt).toContain('<turn index="1" role="coach">\nSeeded coach turn.\n</turn>');
    expect(prompt).toContain('<turn index="2" role="user">\nuser message 1\n</turn>');
    expect(prompt).toContain(`<turn index="3" role="coach" evaluated="true">\n${REPLY}\n</turn>`);
    expect(prompt).toContain('The coach asks one focused question.');
    expect(prompt).toContain('Pass condition (verbatim suite text): Asks exactly one question.');
    expect(prompt).toContain('Judge guidance: Deadlines count.');
    expect(prompt).toContain('Layer: C');
    expect(prompt).toContain('How is your workload?');
  });

  it('records a judge FAIL with its reason and no evidence when the judge gave none', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [verdict('FAIL', 'Asks two things.', null)]);
    expect(results[C1]).toMatchObject({ status: 'FAIL', reason: 'Asks two things.', judgeUsage: ONE_CALL, inScope: true });
    expect(results[C1]).not.toHaveProperty('evidence');
  });

  it('FAILs a null reply with evidence no-reply and never calls the model', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { model, byId: results } = await judged(test, runFor(test, [null]), [verdict('PASS', 'x', 'x')], UNTRUSTED);
    expect(results[C1]).toMatchObject({
      status: 'FAIL',
      evidence: 'no-reply',
      advisory: true,
      judgeUsage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('FAILs a conversation criterion with no coach reply as no-reply', async () => {
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'conversation', checks: MEANING })], { expectedBehavior: 'E.' });
    const { model, byId: results } = await judged(test, runFor(test, [null, null]), [verdict('PASS', 'x', 'x')]);
    expect(results[C1]).toMatchObject({ status: 'FAIL', evidence: 'no-reply' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('accepts conversation evidence from any run coach reply', async () => {
    const test = journey(2, [criterion({ id: C1, evaluatedAt: 'conversation', checks: MEANING })], { expectedBehavior: 'E.' });
    const { byId: results } = await judged(test, runFor(test, ['First reply.', REPLY]), [verdict('PASS', 'ok', 'First reply')]);
    expect(results[C1]).toMatchObject({ status: 'PASS', evidence: 'First reply', judgeUsage: ONE_CALL });
  });

  it('is ERROR judge-invalid-output on schema-invalid output, without a retry', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { model, byId: results } = await judged(test, runFor(test, [REPLY]), ['not json', verdict('PASS', 'x', REPLY)]);
    expect(results[C1]).toMatchObject({ status: 'ERROR', reason: 'judge-invalid-output', judgeUsage: ONE_CALL, inScope: true });
    expect(results[C1]!.evidence).toMatch(/NoObjectGeneratedError/);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('is ERROR judge-invalid-output on a null status', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [verdict(null, 'unsure', null)]);
    expect(results[C1]).toMatchObject({ status: 'ERROR', reason: 'judge-invalid-output', evidence: 'judge returned null status' });
  });

  it('re-asks once on PASS without evidence, then records ERROR judge-invalid-output with two calls', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { model, byId: results } = await judged(test, runFor(test, [REPLY]), [verdict('PASS', 'ok', null), verdict('PASS', 'ok', null)]);
    expect(results[C1]).toMatchObject({
      status: 'ERROR',
      reason: 'judge-invalid-output',
      evidence: 'PASS evidence is missing or is not a verbatim fragment of the evaluated reply',
      judgeUsage: { calls: 2, inputTokens: 200, outputTokens: 40, totalTokens: 240 },
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(promptOf(model, 0)).not.toContain('Reminder:');
    expect(promptOf(model, 1)).toContain('Reminder: your previous answer was PASS');
  });

  it('PASSes after a re-ask fixes a non-matching fragment, summing usage', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [
      verdict('PASS', 'ok', 'Which project matters'),
      verdict('PASS', 'ok again', '  Which deadline\n matters  most '),
    ]);
    expect(results[C1]).toMatchObject({
      status: 'PASS',
      reason: 'ok again',
      judgeUsage: { calls: 2, inputTokens: 200, outputTokens: 40, totalTokens: 240 },
    });
  });

  it('records FAIL evidence only when it is a verbatim fragment of the reply', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING }), criterion({ id: C2, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [
      verdict('FAIL', 'Invented quote.', 'Tell me about your weekend'),
      verdict('FAIL', 'Real quote.', 'Which  deadline'),
    ]);
    expect(results[C1]).toMatchObject({ status: 'FAIL', reason: 'Invented quote.' });
    expect(results[C1]).not.toHaveProperty('evidence');
    expect(results[C2]).toMatchObject({ status: 'FAIL', reason: 'Real quote.', evidence: 'Which  deadline' });
  });

  it('accepts a FAIL from the re-ask after a PASS without evidence', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [verdict('PASS', 'ok', null), verdict('FAIL', 'no', null)]);
    expect(results[C1]).toMatchObject({ status: 'FAIL', reason: 'no' });
    expect(results[C1]).not.toHaveProperty('evidence');
    expect(results[C1]!.judgeUsage!.calls).toBe(2);
  });

  it('records ERROR judge-transport when the re-ask fails twice, summing calls', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const { byId: results } = await judged(test, runFor(test, [REPLY]), [
      verdict('PASS', 'ok', null),
      new Error('ECONNRESET'),
      new Error('ETIMEDOUT'),
    ]);
    expect(results[C1]).toMatchObject({ status: 'ERROR', reason: 'judge-transport', evidence: 'Error: ETIMEDOUT' });
    expect(results[C1]!.judgeUsage).toEqual({ calls: 3, inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });

  it('isolates a transport failure to its criterion; other criteria of the test are unaffected', async () => {
    const test = meaningTest([
      criterion({ id: C1, checks: MEANING }),
      criterion({ id: C2 }),
      criterion({ id: C3, checks: MEANING }),
    ]);
    const { model, byId: results } = await judged(test, runFor(test, [REPLY]), [
      new Error('ECONNRESET'),
      new Error('ETIMEDOUT'),
      verdict('PASS', 'ok', 'Which deadline'),
    ]);
    expect(results[C1]).toMatchObject({
      status: 'ERROR',
      reason: 'judge-transport',
      evidence: 'Error: ETIMEDOUT',
      judgeUsage: { calls: 2, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(results[C2]).toMatchObject({ status: 'PASS' });
    expect(results[C2]).not.toHaveProperty('judgeUsage');
    expect(results[C3]).toMatchObject({ status: 'PASS', judgeUsage: ONE_CALL });
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  it('makes a rejecting CriterionJudge ERROR judge-transport', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const judge = () => Promise.reject(new Error('boom'));
    const results = byId(await evaluate(test, runFor(test, [REPLY]), judge, TRUSTED, EVAL_RULES));
    expect(results[C1]).toMatchObject({ status: 'ERROR', reason: 'judge-transport', evidence: 'Error: boom', judgeUsage: { calls: 0 } });
  });

  it('decides a rule FAIL without a judge call (meaningSkipped) and judges only after every rule PASSed', async () => {
    const test = meaningTest([
      criterion({ id: C1, checks: [{ type: 'rule', rule: 'always-fail' }, { type: 'meaning' }] }),
      criterion({ id: C2, checks: [{ type: 'rule', rule: 'always-pass' }, { type: 'meaning' }] }),
    ]);
    const { model, byId: results } = await judged(test, runFor(test, [REPLY]), [verdict('FAIL', 'Judge says no.', null)], UNTRUSTED);
    expect(results[C1]).toMatchObject({ status: 'FAIL', meaningSkipped: true, advisory: false, evidence: 'turn 1 — always fails' });
    expect(results[C1]).not.toHaveProperty('judgeUsage');
    expect(results[C2]).toMatchObject({ status: 'FAIL', reason: 'Judge says no.', advisory: true, judgeUsage: ONE_CALL });
    expect(results[C2]).not.toHaveProperty('meaningSkipped');
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('sets advisory from trust on every meaning-decided result', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const steps = [verdict('PASS', 'ok', 'Which deadline')];
    expect((await judged(test, runFor(test, [REPLY]), steps, TRUSTED)).byId[C1]!.advisory).toBe(false);
    expect((await judged(test, runFor(test, [REPLY]), steps, UNTRUSTED)).byId[C1]!.advisory).toBe(true);
    const errored = await judged(test, runFor(test, [REPLY]), ['not json'], UNTRUSTED);
    expect(errored.byId[C1]).toMatchObject({ status: 'ERROR', advisory: true });
  });

  it('keeps the earlier precedence ahead of the judge (INVALID, ERROR, NOT_RUN) without calls', async () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING })]);
    const invalid = await judged(test, runFor(test, [REPLY], { preconditions: [{ source: 'fixture', name: 'clock', satisfied: false }] }), [verdict('PASS', 'x', REPLY)]);
    expect(invalid.byId[C1]).toMatchObject({ status: 'INVALID', reason: 'precondition:clock' });
    const errored = await judged(
      test,
      runFor(test, [REPLY], { errors: [{ kind: 'product', step: 1, reason: 'orchestrator-exception', message: 'x' }] }),
      [verdict('PASS', 'x', REPLY)],
    );
    expect(errored.byId[C1]).toMatchObject({ status: 'ERROR', reason: 'orchestrator-exception' });
    expect(invalid.model.doGenerateCalls.length + errored.model.doGenerateCalls.length).toBe(0);
  });

  it('makes state and observation-window meaning criteria NOT_RUN judge-unsupported, in scope', async () => {
    const state = criterion({
      id: C1,
      evaluatedAt: 'state',
      stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'invariant' },
      checks: MEANING,
    });
    const test = meaningTest([state]);
    const { model, byId: results } = await judged(test, runFor(test, [REPLY]), [verdict('PASS', 'x', REPLY)]);
    expect(results[C1]).toMatchObject({ status: 'NOT_RUN', reason: 'judge-unsupported:state', inScope: true });

    const observation = {
      ...meaningTest([criterion({ id: C2, evaluatedAt: 'observation-window', checks: MEANING })]),
      id: 'X-02',
      kind: 'observation' as const,
      steps: [],
      seed: undefined,
      observationWindow: { durationMs: 1000, scanEveryMs: 100 },
    };
    const observed = await judged(observation, runFor(observation, []), [verdict('PASS', 'x', REPLY)]);
    expect(observed.byId[C2]).toMatchObject({ status: 'NOT_RUN', reason: 'judge-unsupported:observation-window' });
    expect(model.doGenerateCalls.length + observed.model.doGenerateCalls.length).toBe(0);
  });

  it('rejects with [suite] when the test carries no expectedBehavior', async () => {
    const test = atomic([criterion({ id: C1, checks: MEANING })]);
    const judge = createCriterionJudge({ model: mockJudgeModel([verdict('PASS', 'x', REPLY)]), decoding: DECODING });
    await expect(evaluate(test, runFor(test, [REPLY]), judge, TRUSTED, EVAL_RULES)).rejects.toThrow(/^\[suite\] evaluate: .*expectedBehavior/);
  });

  it('keeps judge null synchronous and unchanged for meaning criteria', () => {
    const test = meaningTest([criterion({ id: C1, checks: MEANING }), criterion({ id: C2, checks: [{ type: 'rule', rule: 'always-pass' }, { type: 'meaning' }] })]);
    const results = evaluate(test, runFor(test, [REPLY]), null, UNTRUSTED, EVAL_RULES);
    expect(Array.isArray(results)).toBe(true);
    expect(byId(results)[C1]).toMatchObject({ status: 'NOT_RUN', reason: 'no-judge-at-level', inScope: false });
    expect(byId(results)[C2]).toMatchObject({ status: 'PASS', meaningSkipped: true });
    expect(byId(results)[C2]).not.toHaveProperty('judgeUsage');
  });
});

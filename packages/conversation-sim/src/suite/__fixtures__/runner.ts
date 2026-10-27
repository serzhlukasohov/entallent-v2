import type { ExecutorOptions, SuiteExecutor } from '../executors/types';
import { validateSuite } from '../loader';
import { TEST_RULES, validModules } from './suite';
import type { AgreementFile, CaseRun, ExecutionError, Level, LoadedSuite, LoadedTest, SuiteConfig } from '../schema';
import { labelsSha256 } from '../judge/calibrate';
import { computeJudgeFingerprint } from '../judge/fingerprint';

/** Synthetic suites, a config and fake executors shared by runner, baseline and CLI tests. */

export const RUNNER_CONFIG: SuiteConfig = {
  schemaVersion: 1,
  suites: ['p-v1', 'smoke-v1', 'x-suite', 'x-live'],
  levels: ['L0', 'L1', 'L2'],
  interMessageGapMs: 60_000,
  baseline: { minSamples: { L0: 1, L1: 5, L2: 3 } },
  diff: { minSamples: { L1: 3, L2: 3 } },
  retries: { infrastructure: 1 },
  budgets: { maxCoachCallsPerRun: 600, maxJudgeCallsPerRun: 150, coachCallTimeoutMs: 120_000, judgeCallTimeoutMs: 60_000 },
  judge: {
    provider: 'openai',
    model: 'gpt-4o',
    decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 },
    agreementThreshold: { overall: 0.85, kappa: 0.6 },
    minLabels: 40,
  },
};

/** `validModules()`: atomic (L0, L1), journey (L1, L2), observation (L0). For fake executors. */
export function fakeSuite(): LoadedSuite {
  return validateSuite('x-suite', validModules(), TEST_RULES);
}

function scripted(step: number, text: string): Record<string, unknown> {
  return { step, classification: {}, risk: {}, memoryProposal: {}, response: { text } };
}

/** Atomic, journey and observation tests that all declare L0, for the real L0 executor. */
export function liveSuite(): LoadedSuite {
  const sources = [
    {
      id: 'X-01',
      requirement: ['REQ-1'],
      kind: 'conversation',
      expectedBehavior: 'The coach replies to every turn.',
      criteria: [
        { id: 'X-01.C1', layer: 'P', passCondition: 'The coach replies.' },
        { id: 'X-01.C2', layer: 'S', passCondition: 'The turn is recorded.' },
        { id: 'X-01.C3', layer: 'C', passCondition: 'The opening feels natural.', notTestableReason: 'subjective opening' },
      ],
    },
    {
      id: 'X-02',
      requirement: ['REQ-2'],
      kind: 'observation',
      expectedBehavior: 'The scheduler runs over the window.',
      criteria: [{ id: 'X-02.C1', layer: 'D', passCondition: 'The window is observed.' }],
    },
  ];
  const tests = [
    {
      id: 'X-01.A1',
      sourceCase: 'X-01',
      requirement: ['REQ-1'],
      kind: 'atomic',
      levels: ['L0'],
      runProfile: 'isolated',
      setup: [],
      seed: { history: [] },
      scripted: [scripted(1, 'Got it. Which deadline is first?')],
      preconditions: [],
      steps: [{ text: 'Two releases this week.' }],
      criteria: [
        { id: 'X-01.C1', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
        { id: 'X-01.C2', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'events-only' }, { type: 'meaning' }] },
      ],
    },
    {
      id: 'X-01.J',
      sourceCase: 'X-01',
      requirement: ['REQ-1'],
      kind: 'journey',
      levels: ['L0'],
      runProfile: 'isolated',
      setup: [],
      scripted: [scripted(1, 'Morning. What is on your plate?'), scripted(2, 'Which one is riskier?')],
      preconditions: [],
      steps: [{ text: 'Hi.' }, { text: 'Two releases this week.' }],
      criteria: [{ id: 'X-01.C1', evaluatedAt: 'reply:2', checks: [{ type: 'rule', rule: 'reply-present' }] }],
    },
    {
      id: 'X-02',
      sourceCase: 'X-02',
      requirement: ['REQ-2'],
      kind: 'observation',
      levels: ['L0'],
      runProfile: 'isolated',
      setup: [
        {
          name: 'proactiveUsers',
          params: {
            timezone: 'UTC',
            quietHours: { enabled: true, startHour: 22, endHour: 8 },
            scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
          },
        },
      ],
      scripted: [],
      preconditions: [],
      steps: [],
      observationWindow: { durationMs: 2 * 24 * 3_600_000, scanEveryMs: 3_600_000 },
      criteria: [{ id: 'X-02.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'events-only' }] }],
    },
  ];
  return validateSuite('x-live', { sources, tests }, TEST_RULES);
}

/** A valid L0 run that passes `events-only` and `reply-present`-free criteria of `fakeSuite()`. */
export function cleanRun(test: LoadedTest, attempt: number, errors: ExecutionError[] = []): CaseRun {
  return {
    testId: test.id,
    level: 'L0',
    attempt,
    subject: { externalUserId: `fake-${test.id}` },
    observed: ['events', 'reply.messages'],
    preconditions: [],
    steps: test.steps.map((step, position) => ({
      index: position + 1,
      userText: step.text,
      traceId: `trace-${position + 1}`,
      gapMs: 0,
      reply: null,
      unsolicited: [],
    })),
    state: { before: {}, after: {}, afterStep: {} },
    errors,
    events: [
      {
        stepIndex: 1,
        seq: 0,
        port: 'conversationRepo',
        method: 'saveMessage',
        argsSummary: '',
        outcome: 'ok',
        resultSummary: '',
        durationMs: 0,
      },
    ],
  };
}

export type FakeBehavior = (test: LoadedTest, attempt: number) => CaseRun | Promise<CaseRun>;

/** A fake L0 executor; `calls` records `<testId>#<attempt>` per call. */
export function fakeExecutor(behavior: FakeBehavior = (test, attempt) => cleanRun(test, attempt)): SuiteExecutor & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    level: 'L0',
    calls,
    supports: () => true,
    observes: () => ['events', 'reply.messages'],
    async run(test, options) {
      calls.push(`${test.id}#${options.attempt}`);
      return behavior(test, options.attempt);
    },
  };
}

/**
 * `Z-01.A1` (atomic, L1 only): C1 (P) and C2 (D, with guidance) meaning-only, C3 (S) rule
 * `reply-present`, C4 (C) rule `too-many-questions` plus meaning. `guidance` changes C2's
 * guidance (and so the fingerprint's `guidanceSha256`).
 */
export function judgedSuite(options: { guidance?: string } = {}): LoadedSuite {
  const sources = [
    {
      id: 'Z-01',
      requirement: ['REQ-9'],
      kind: 'conversation',
      expectedBehavior: 'The coach asks one focused question about priorities.',
      criteria: [
        { id: 'Z-01.C1', layer: 'P', passCondition: 'The reply asks about priorities.' },
        { id: 'Z-01.C2', layer: 'D', passCondition: 'The reply names a deadline.' },
        { id: 'Z-01.C3', layer: 'S', passCondition: 'The coach replies.' },
        { id: 'Z-01.C4', layer: 'C', passCondition: 'The reply asks one warm question.' },
      ],
    },
  ];
  const tests = [
    {
      id: 'Z-01.A1',
      sourceCase: 'Z-01',
      requirement: ['REQ-9'],
      kind: 'atomic',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [],
      seed: { history: [{ role: 'coach', text: 'Morning. How is the week?', atOffsetMs: 60_000 }] },
      preconditions: [],
      steps: [{ text: 'Two releases this week.' }],
      criteria: [
        { id: 'Z-01.C1', evaluatedAt: 'reply:1', checks: [{ type: 'meaning' }] },
        {
          id: 'Z-01.C2',
          evaluatedAt: 'reply:1',
          checks: [{ type: 'meaning' }],
          judgeGuidance: options.guidance ?? 'Any named release date counts as a deadline.',
        },
        { id: 'Z-01.C3', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
        { id: 'Z-01.C4', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'too-many-questions' }, { type: 'meaning' }] },
      ],
    },
  ];
  return validateSuite('x-judged', { sources, tests }, TEST_RULES);
}

/** A valid run whose steps all reply `reply` (or stay silent when null). */
export function replyRun(test: LoadedTest, attempt: number, reply: string | null, level: Level = 'L1'): CaseRun {
  return {
    testId: test.id,
    level,
    attempt,
    subject: { externalUserId: `fake-${test.id}` },
    observed: ['events', 'reply.messages', 'reply.text'],
    preconditions: [],
    steps: test.steps.map((step, position) => ({
      index: position + 1,
      userText: step.text,
      traceId: `trace-${position + 1}`,
      gapMs: 0,
      reply:
        reply === null
          ? null
          : { messages: [{ id: `m-${position + 1}`, text: reply, occurredAt: '2026-10-25T10:00:00.000Z', metadata: {} }], text: reply },
      unsolicited: [],
    })),
    state: { before: {}, after: {}, afterStep: {} },
    errors: [],
    events: [],
  };
}

/** A fake executor of `level` answering every test step with `reply(test, attempt)`. */
export function fakeReplyExecutor(
  reply: (test: LoadedTest, attempt: number) => string | null,
  level: Level = 'L1',
): SuiteExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    level,
    calls,
    supports: () => true,
    observes: () => ['events', 'reply.messages', 'reply.text'],
    async run(test, options) {
      calls.push(`${test.id}#${options.attempt}`);
      return replyRun(test, options.attempt, reply(test, options.attempt), level);
    },
  };
}

/**
 * A fake L1 executor that makes `callsPerCase(attempt)` coach calls per case through the
 * runner's budget hook, like the L1 executor: a refused call ends the case with ERROR
 * `budget-exceeded` (product) at step 1; otherwise every step replies `reply`. `calls`
 * records `<testId>#<attempt>`, `options` every `ExecutorOptions` received.
 */
export function budgetedExecutor(
  options: {
    callsPerCase?: number | ((attempt: number) => number);
    coachModel?: string;
    reply?: string;
    /** Extra errors for an attempt (for example an infrastructure error to force a retry). */
    errors?: (test: LoadedTest, attempt: number) => ExecutionError[];
  } = {},
): SuiteExecutor & { calls: string[]; options: ExecutorOptions[]; coachCalls: () => number } {
  const calls: string[] = [];
  const received: ExecutorOptions[] = [];
  let coachCalls = 0;
  const perCase = options.callsPerCase ?? 3;
  return {
    level: 'L1',
    coachModel: options.coachModel ?? 'fake-coach',
    calls,
    options: received,
    coachCalls: () => coachCalls,
    supports: () => true,
    observes: () => ['events', 'reply.messages', 'reply.text'],
    async run(test, executorOptions) {
      calls.push(`${test.id}#${executorOptions.attempt}`);
      received.push(executorOptions);
      const wanted = typeof perCase === 'function' ? perCase(executorOptions.attempt) : perCase;
      const run = replyRun(test, executorOptions.attempt, options.reply ?? 'Which release deadline comes first?');
      for (let call = 0; call < wanted; call += 1) {
        if (executorOptions.budget && !executorOptions.budget.tryCoachCall()) {
          return { ...run, steps: [], errors: [{ kind: 'product', step: 1, reason: 'budget-exceeded', message: 'coach call budget spent' }] };
        }
        coachCalls += 1;
      }
      return { ...run, errors: options.errors?.(test, executorOptions.attempt) ?? [] };
    },
  };
}

/** A synthetic agreement file for `suite` under `config.judge`, calibrated unless overridden. */
export function agreementFor(
  suite: Pick<LoadedSuite, 'tests'>,
  overrides: Partial<AgreementFile> = {},
  judge: SuiteConfig['judge'] = RUNNER_CONFIG.judge,
): AgreementFile {
  const stats = { n: 10, overall: 0.9, kappa: 0.7 };
  return {
    schemaVersion: 1,
    fingerprint: computeJudgeFingerprint(judge, suite),
    labelsSha256: labelsSha256([]),
    n: 40,
    overall: 0.9,
    kappa: 0.7,
    perLayer: { P: stats, D: stats, C: stats, S: stats },
    computedAt: '2026-10-24T09:00:00.000Z',
    ...overrides,
  };
}

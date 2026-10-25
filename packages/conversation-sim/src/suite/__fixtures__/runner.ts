import type { SuiteExecutor } from '../executors/types';
import { validateSuite } from '../loader';
import { TEST_RULES, validModules } from './suite';
import type { CaseRun, ExecutionError, LoadedSuite, LoadedTest, SuiteConfig } from '../schema';

/** Synthetic suites, a config and fake executors shared by runner, baseline and CLI tests. */

export const RUNNER_CONFIG: SuiteConfig = {
  schemaVersion: 1,
  suites: ['p-v1', 'smoke-v1', 'x-suite', 'x-live'],
  levels: ['L0', 'L1', 'L2'],
  interMessageGapMs: 60_000,
  baseline: { minSamples: { L0: 1, L1: 5, L2: 3 } },
  diff: { minSamples: { L1: 3, L2: 3 } },
  retries: { infrastructure: 1 },
  budgets: { maxCoachCallsPerRun: 600, maxJudgeCallsPerRun: 150 },
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

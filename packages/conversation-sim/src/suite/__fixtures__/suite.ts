import { RULES, type RuleEntry, type RuleRegistry } from '../rules/registry';
import { syntheticRun } from '../rules/synthetic-run';

/**
 * A small valid suite covering atomic, journey and observation tests, plus a
 * test-local rule that does not need `reply.text` so L0 criteria can be decided.
 */

export const eventsRule: RuleEntry = {
  requires: ['events'],
  run: (run) => (run.events.length > 0 ? { status: 'PASS' } : { status: 'FAIL', evidence: 'turn 1 — no events' }),
  fixtures: {
    pass: {
      ...syntheticRun('RULE-events-only-pass', ['ok'], ['events']),
      events: [
        {
          stepIndex: 1,
          seq: 0,
          port: 'conversationRepo',
          method: 'saveMessage',
          argsSummary: 'outbound',
          outcome: 'ok',
          resultSummary: 'saved',
          durationMs: 1,
        },
      ],
    },
    fail: syntheticRun('RULE-events-only-fail', ['ok'], ['events']),
  },
};

export const TEST_RULES: RuleRegistry = { ...RULES, 'events-only': eventsRule };

export function validSources(): unknown[] {
  return [
    {
      id: 'X-01',
      requirement: ['REQ-1'],
      kind: 'conversation',
      expectedBehavior: 'The coach stages the bundle and asks one question.',
      criteria: [
        { id: 'X-01.C1', layer: 'P', passCondition: 'The bundle is staged.' },
        {
          id: 'X-01.C2',
          layer: 'S',
          passCondition: 'Staged bundle count grows by one.',
          stateEffect: { port: 'questionConfirmationRepo', method: 'stageBundle', expected: 1 },
        },
        { id: 'X-01.C3', layer: 'C', passCondition: 'The opening feels natural.', notTestableReason: 'subjective opening' },
      ],
    },
    {
      id: 'X-02',
      requirement: ['REQ-2'],
      kind: 'observation',
      expectedBehavior: 'The coach initiates within working hours.',
      criteria: [{ id: 'X-02.C1', layer: 'P', passCondition: 'Check-ins are 48 h apart.' }],
    },
  ];
}

export function atomicTest(): Record<string, unknown> {
  return {
    id: 'X-01.A1',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'atomic',
    levels: ['L0', 'L1'],
    runProfile: 'isolated',
    setup: [{ name: 'freshPersona' }],
    seed: {
      history: [
        { role: 'coach', text: 'Morning. How is the week going?', atOffsetMs: 120_000 },
        { role: 'user', text: 'Busy.', atOffsetMs: 60_000 },
      ],
    },
    scripted: [{ step: 1, response: { text: 'Got it. Which deadline is first?' } }],
    preconditions: [],
    steps: [{ text: 'Two releases this week.', advanceClock: 1_000 }],
    criteria: [
      { id: 'X-01.C1', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'events-only' }] },
      {
        id: 'X-01.C2',
        evaluatedAt: 'state',
        levels: ['L1'],
        stateQuery: { name: 'stagedBundleCount', at: 'after-step:1', kind: 'change' },
        checks: [{ type: 'rule', rule: 'too-many-questions' }, { type: 'meaning' }],
        judgeGuidance: 'Count only bundles staged by this turn.',
      },
    ],
  };
}

export function journeyTest(): Record<string, unknown> {
  return {
    id: 'X-01.J',
    sourceCase: 'X-01',
    requirement: ['REQ-1'],
    kind: 'journey',
    levels: ['L1', 'L2'],
    runProfile: 'isolated',
    setup: [],
    preconditions: [],
    steps: [
      {
        text: 'Hi.',
        checkpoint: { checks: [{ type: 'rule', rule: 'too-many-questions' }], onFail: 'continue' },
      },
      { text: 'Two releases this week.' },
    ],
    criteria: [
      { id: 'X-01.C1', evaluatedAt: 'reply:2', checks: [{ type: 'meaning' }] },
      { id: 'X-01.C2', evaluatedAt: 'conversation', checks: [{ type: 'rule', rule: 'repeated-question' }], independentOfCheckpoints: true },
    ],
  };
}

export function observationTest(): Record<string, unknown> {
  return {
    id: 'X-02',
    sourceCase: 'X-02',
    requirement: ['REQ-2'],
    kind: 'observation',
    levels: ['L0'],
    runProfile: 'isolated',
    setup: [{ name: 'proactiveUsers', params: { count: 1 } }],
    scripted: [],
    preconditions: [],
    steps: [],
    observationWindow: { durationMs: 7 * 24 * 3_600_000, scanEveryMs: 3_600_000 },
    criteria: [{ id: 'X-02.C1', evaluatedAt: 'observation-window', checks: [{ type: 'rule', rule: 'events-only' }] }],
  };
}

export function validModules(): { sources: unknown[]; tests: unknown[] } {
  return { sources: validSources(), tests: [atomicTest(), journeyTest(), observationTest()] };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

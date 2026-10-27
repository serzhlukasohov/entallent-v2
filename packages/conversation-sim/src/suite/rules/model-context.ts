import { z } from 'zod';
import type { CaseRun, ContextDigest, RunEvent } from '../schema';
import type { RuleEntry } from './registry';
import { missingField } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const Count = z.union([
  z.number().int().nonnegative(),
  z
    .object({ min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional() })
    .strict()
    .refine((range) => range.min !== undefined || range.max !== undefined, { message: 'give min or max' }),
]);
type CountSpec = z.infer<typeof Count>;

const params = z
  .object({
    /** The evaluated step; 0 covers fixtures, seed and observation windows (bot-initiated messages). */
    step: z.number().int().nonnegative(),
    /** Which reply-model call of the step: `first` (e.g. P-06's first check-in) or `last` (the reply). */
    call: z.enum(['first', 'last']).default('last'),
    expect: z
      .object({
        historyTurns: Count.optional(),
        historyUser: Count.optional(),
        historyAssistant: Count.optional(),
        lastRole: z.enum(['user', 'assistant']).optional(),
        memoryItems: Count.optional(),
        memoryGoals: Count.optional(),
        /** Every listed category is among the memory items. */
        memoryCategories: z.array(z.string().min(1)).min(1).optional(),
        sessionStart: z.boolean().optional(),
        /** A fragment of the local time the product rendered, e.g. `22:30`. */
        localTimeIncludes: z.string().min(1).optional(),
        /** A survey question (probe hint or V2 topic question) is, or is not, in the context. */
        surveyQuestion: z.boolean().optional(),
        sectionsInclude: z.array(z.string().min(1)).min(1).optional(),
        sectionsExclude: z.array(z.string().min(1)).min(1).optional(),
      })
      .strict()
      .refine((expect) => Object.keys(expect).length > 0, { message: 'expect at least one property' }),
  })
  .strict();

const requires = ['events'] as const;

function countFails(name: string, actual: number, spec: CountSpec | undefined): string[] {
  if (spec === undefined) return [];
  if (typeof spec === 'number') return actual === spec ? [] : [`${name}=${actual} (expected ${spec})`];
  if (spec.min !== undefined && actual < spec.min) return [`${name}=${actual} (expected >= ${spec.min})`];
  if (spec.max !== undefined && actual > spec.max) return [`${name}=${actual} (expected <= ${spec.max})`];
  return [];
}

function check(context: ContextDigest, expect: z.infer<typeof params>['expect']): string[] {
  const fails = [
    ...countFails('history', context.history.turns, expect.historyTurns),
    ...countFails('history.user', context.history.user, expect.historyUser),
    ...countFails('history.assistant', context.history.assistant, expect.historyAssistant),
    ...countFails('memory.items', context.memory.items, expect.memoryItems),
    ...countFails('memory.goals', context.memory.goals, expect.memoryGoals),
  ];
  if (expect.lastRole !== undefined && context.history.lastRole !== expect.lastRole) {
    fails.push(`history.lastRole=${context.history.lastRole ?? 'none'} (expected ${expect.lastRole})`);
  }
  for (const category of expect.memoryCategories ?? []) {
    if (!context.memory.categories.includes(category)) fails.push(`memory.categories lacks ${category}`);
  }
  if (expect.sessionStart !== undefined && context.sessionStart !== expect.sessionStart) {
    fails.push(`sessionStart=${String(context.sessionStart ?? 'unset')} (expected ${expect.sessionStart})`);
  }
  if (expect.localTimeIncludes !== undefined && !(context.localTime ?? '').includes(expect.localTimeIncludes)) {
    fails.push(`localTime=${context.localTime ?? 'unset'} (expected ${expect.localTimeIncludes})`);
  }
  if (expect.surveyQuestion !== undefined && (context.surveyQuestionId !== undefined) !== expect.surveyQuestion) {
    fails.push(`surveyQuestion=${context.surveyQuestionId ?? 'none'} (expected ${expect.surveyQuestion ? 'present' : 'absent'})`);
  }
  for (const section of expect.sectionsInclude ?? []) {
    if (!context.sections.includes(section)) fails.push(`sections lacks ${section}`);
  }
  for (const section of expect.sectionsExclude ?? []) {
    if (context.sections.includes(section)) fails.push(`sections has ${section}`);
  }
  return fails;
}

/**
 * What the product put in front of the reply model on `step` (the context digest of its
 * first or last `generateResponse` call) meets every expectation. A step that reached the
 * reply model with no call FAILs: the reply was not grounded on any context.
 */
export const modelContext: RuleEntry = {
  requires,
  params,
  run(run, _criterion, raw) {
    const { step, call, expect } = params.parse(raw ?? {});
    const missing = missingField(requires, run);
    if (missing) return { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` };
    const stopped = run.stoppedAtStep !== undefined && step > run.stoppedAtStep;
    if (step > run.steps.length || stopped) return { status: 'NOT_OBSERVABLE', evidence: `step-not-reached:${step}` };
    const calls = run.events.filter((event) => event.stepIndex === step && event.context !== undefined);
    const chosen = call === 'first' ? calls[0] : calls.at(-1);
    if (chosen?.context === undefined) return { status: 'FAIL', evidence: `no reply-model call@${step}` };
    const fails = check(chosen.context, expect);
    return fails.length === 0 ? { status: 'PASS' } : { status: 'FAIL', evidence: `context@${step} (${call}): ${fails.join('; ')}` };
  },
  fixtures: {
    params: { step: 1, expect: { historyTurns: 3, sessionStart: false, memoryItems: { min: 1 } } },
    pass: withContext('RULE-model-context-pass', 3, false, 1),
    fail: withContext('RULE-model-context-fail', 1, true, 0),
  },
};

function withContext(testId: string, turns: number, sessionStart: boolean, memoryItems: number): CaseRun {
  const run = syntheticRun(testId, ['Reply.'], ['events']);
  const event: RunEvent = {
    stepIndex: 1,
    seq: 0,
    port: 'aiProvider',
    method: 'generateResponse',
    argsSummary: '',
    outcome: 'ok',
    resultSummary: '',
    durationMs: 0,
    context: {
      history: { turns, user: turns - Math.floor(turns / 2), assistant: Math.floor(turns / 2), lastRole: 'user' },
      memory: { items: memoryItems, categories: memoryItems > 0 ? ['commitment'] : [], goals: 0 },
      sessionStart,
      sections: [],
    },
  };
  return { ...run, events: [event] };
}

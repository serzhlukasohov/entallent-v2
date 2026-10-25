import { z } from 'zod';
import { StateAtSchema, StateQueryNameSchema, fieldObserved, stateAtStep, type CaseRun } from '../schema';
import type { RuleEntry, RuleOutcome } from './registry';
import { readState } from './state';
import { stateFixtureRun } from './synthetic-run';

/** Count queries: every state query except the structured `questionProgress`. */
const CountQuerySchema = StateQueryNameSchema.exclude(['questionProgress']);

const METADATA_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MaxSchema = z.union([
  z.number().int().nonnegative(),
  z.object({ repliesWithMetadata: z.string().regex(METADATA_KEY, 'expected a metadata key') }).strict(),
]);

const params = z
  .object({
    query: CountQuerySchema,
    at: StateAtSchema,
    max: MaxSchema,
    /** Compare `snapshot(at) - snapshot(before)` instead of `snapshot(at)`. */
    delta: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.delta && value.at === 'before') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: "delta compares against before; at: 'before' is always 0" });
    }
    if (typeof value.max === 'object' && value.at === 'before') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['max'], message: "repliesWithMetadata at: 'before' is always 0" });
    }
  });

/**
 * Resolves `max`. The `{ repliesWithMetadata: key }` form counts reply messages in
 * `steps[].reply.messages` whose `metadata[key] === true`, over the steps the snapshot
 * `at` covers (all steps for `after`, steps 1..n for `after-step:n`; `before` is rejected at load).
 */
function resolveMax(
  run: CaseRun,
  max: z.infer<typeof MaxSchema>,
  at: string,
): { kind: 'max'; value: number; label: string } | { kind: 'outcome'; outcome: RuleOutcome } {
  if (typeof max === 'number') return { kind: 'max', value: max, label: String(max) };
  const key = max.repliesWithMetadata;
  const field = `reply.messages[].metadata.${key}` as const;
  if (!fieldObserved(field, run.observed)) {
    return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence: `unobservable:${field}@${run.level}` } };
  }
  const lastStep = at === 'before' ? 0 : at === 'after' ? run.steps.length : (stateAtStep(at) ?? 0);
  const value = run.steps
    .filter((step) => step.index <= lastStep)
    .flatMap((step) => step.reply?.messages ?? [])
    .filter((message) => message.metadata[key] === true).length;
  return { kind: 'max', value, label: `${value} = replies with metadata.${key}` };
}

/**
 * A count query at `at` (or, with `delta`, its growth since `before`) is at most `max`.
 * P-09 "new summaries not greater than seen" is `{ delta: true, max: { repliesWithMetadata: key } }`.
 * Use it on `invariant` criteria: under a `change` criterion `evaluate`'s already-satisfied
 * precondition would substitute `before` and mark it INVALID.
 */
export const stateNotGreaterThan: RuleEntry = {
  requires: [],
  params,
  run(run, _criterion, raw) {
    const { query, at, max, delta } = params.parse(raw ?? {});
    const read = readState(run, query, at);
    if (read.kind === 'outcome') return read.outcome;
    let value = read.value as number;
    let label = `state.${query}@${at}`;
    if (delta) {
      const before = readState(run, query, 'before');
      if (before.kind === 'outcome') return before.outcome;
      value -= before.value as number;
      label = `state.${query}@${at} - state.${query}@before`;
    }
    const bound = resolveMax(run, max, at);
    if (bound.kind === 'outcome') return bound.outcome;
    return value <= bound.value ? { status: 'PASS' } : { status: 'FAIL', evidence: `${label}: ${value} (max ${bound.label})` };
  },
  fixtures: {
    params: { query: 'stagedBundleCount', at: 'after', max: 1 },
    pass: stateFixtureRun(
      'RULE-state-not-greater-than-pass',
      { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 1 }, afterStep: {} },
      ['state.stagedBundleCount'],
    ),
    fail: stateFixtureRun(
      'RULE-state-not-greater-than-fail',
      { before: { stagedBundleCount: 0 }, after: { stagedBundleCount: 2 }, afterStep: {} },
      ['state.stagedBundleCount'],
    ),
  },
};

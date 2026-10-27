import { z } from 'zod';
import { STATE_QUERY_VALUE_SCHEMAS, StateAtSchema, StateQueryNameSchema } from '../schema';
import type { RuleEntry } from './registry';
import { readState, sameValue } from './state';
import { stateFixtureRun } from './synthetic-run';

const params = z
  .object({ query: StateQueryNameSchema, at: StateAtSchema, expected: z.unknown() })
  .strict()
  .superRefine((value, ctx) => {
    const parsed = STATE_QUERY_VALUE_SCHEMAS[value.query].safeParse(value.expected);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expected', ...issue.path], message: issue.message });
    }
  });

/** The queried state at `at` equals `expected` (validated against the query's value schema). */
export const stateEquals: RuleEntry = {
  requires: [],
  params,
  run(run, _criterion, raw) {
    const { query, at, expected } = params.parse(raw ?? {});
    const read = readState(run, query, at);
    if (read.kind === 'outcome') return read.outcome;
    return sameValue(read.value, expected)
      ? { status: 'PASS' }
      : { status: 'FAIL', evidence: `state.${query}@${at}: ${JSON.stringify(read.value)} (expected ${JSON.stringify(expected)})` };
  },
  fixtures: {
    params: { query: 'questionProgress', at: 'after', expected: { answered: 2, total: 5 } },
    pass: stateFixtureRun(
      'RULE-state-equals-pass',
      { before: { questionProgress: { answered: 1, total: 5 } }, after: { questionProgress: { answered: 2, total: 5 } }, afterStep: {} },
      ['state.questionProgress'],
    ),
    fail: stateFixtureRun(
      'RULE-state-equals-fail',
      { before: { questionProgress: { answered: 1, total: 5 } }, after: { questionProgress: { answered: 1, total: 5 } }, afterStep: {} },
      ['state.questionProgress'],
    ),
  },
};

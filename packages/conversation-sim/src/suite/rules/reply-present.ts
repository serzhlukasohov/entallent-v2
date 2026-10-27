import { parseEvaluatedAt } from '../schema';
import type { RuleEntry } from './registry';
import { missingField } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.messages'] as const;

/**
 * The coach replied: the selected step has at least one reply message. Needs only
 * `reply.messages`, never `reply.text`, so it decides silence at L0. In `conversation`
 * scope every step must have a reply.
 */
export const replyPresent: RuleEntry = {
  requires,
  run(run, criterion) {
    const missing = missingField(requires, run);
    if (missing) return { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` };
    const at = parseEvaluatedAt(criterion.evaluatedAt);
    if (at.kind === 'state' || at.kind === 'observation-window') {
      return { status: 'NOT_OBSERVABLE', evidence: `not-a-reply-criterion:${criterion.evaluatedAt}` };
    }
    if (at.kind === 'conversation') {
      if (run.steps.length === 0) return { status: 'NOT_OBSERVABLE', evidence: 'no-replies' };
      const silent = run.steps.filter((step) => !step.reply).map((step) => `no-reply (turn ${step.index})`);
      return silent.length > 0 ? { status: 'FAIL', evidence: silent.join('\n') } : { status: 'PASS' };
    }
    const step = run.steps[at.step - 1];
    if (!step) return { status: 'NOT_OBSERVABLE', evidence: `step-not-reached:${at.step}` };
    return step.reply ? { status: 'PASS' } : { status: 'FAIL', evidence: `no-reply (turn ${at.step})` };
  },
  fixtures: {
    pass: syntheticRun('RULE-reply-present-pass', ['Glad you wrote. What is on your mind today?'], ['reply.messages']),
    fail: syntheticRun('RULE-reply-present-fail', [null], ['reply.messages']),
  },
};

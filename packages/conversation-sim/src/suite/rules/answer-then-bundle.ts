import type { CaseRun } from '../schema';
import type { RuleEntry } from './registry';
import { formatEvidence, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const EXPECTED = 'answer_then_bundle';
const requires = ['turn.bundleReply'] as const;

/**
 * The orchestrator answered the user and then showed the bundle: the selected step's
 * `turn.bundleReply` is `answer_then_bundle`. In `conversation` scope any step may carry it.
 */
export const answerThenBundle: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const values = selection.replies.map(({ turn }) => ({ turn, value: run.steps[turn - 1]?.turn?.bundleReply }));
    if (values.some(({ value }) => value === EXPECTED)) return { status: 'PASS' };
    return {
      status: 'FAIL',
      evidence: values.map(({ turn, value }) => formatEvidence(turn, `bundleReply:${value ?? 'none'}`)).join('\n'),
    };
  },
  fixtures: {
    pass: withBundleReply(
      syntheticRun('RULE-answer-then-bundle-pass', ['It runs weekly. Here is what I noted: does it look right?'], ['turn.bundleReply']),
      EXPECTED,
    ),
    fail: withBundleReply(
      syntheticRun('RULE-answer-then-bundle-fail', ['Here is what I noted: does it look right?'], ['turn.bundleReply']),
      'bundle_without_reply',
    ),
  },
};

function withBundleReply(run: CaseRun, bundleReply: string): CaseRun {
  return { ...run, steps: run.steps.map((step) => ({ ...step, turn: { ...step.turn, bundleReply } })) };
}

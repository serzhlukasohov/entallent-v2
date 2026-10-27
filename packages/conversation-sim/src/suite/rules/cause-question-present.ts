import { extractQuestions } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

/** True when `text` asks at least one question. */
export function hasQuestion(text: string): boolean {
  return extractQuestions(text).length > 0;
}

/**
 * A reply asks at least one question. Whether the question is about the cause is a
 * meaning check decided by the criterion's companion judge, not by this rule.
 */
export const causeQuestionPresent: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) =>
      hasQuestion(text) ? [] : [formatEvidence(turn, 'no question')],
    );
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-cause-question-present-pass', ['That sounds draining. What makes the handover so slow?']),
    fail: syntheticRun('RULE-cause-question-present-fail', ['That sounds draining. Take care of yourself.']),
  },
};

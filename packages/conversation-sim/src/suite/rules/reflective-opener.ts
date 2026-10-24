import { hasReflectiveOpener } from '@entalent/ai-openai';
import { firstSentence } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

/** Wraps the product-shared `hasReflectiveOpener`: a reply does not open by labeling the user's words. */
export const reflectiveOpener: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) =>
      hasReflectiveOpener(text) ? [formatEvidence(turn, firstSentence(text))] : [],
    );
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-reflective-opener-pass', [
      'Two deadlines in one week is a lot. Which one moves first?',
    ]),
    fail: syntheticRun('RULE-reflective-opener-fail', [
      'Sounds like the deadlines are piling up. Which one moves first?',
    ]),
  },
};

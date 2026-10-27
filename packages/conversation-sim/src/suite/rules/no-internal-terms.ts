import type { RuleEntry } from './registry';
import { findPhrases } from './phrase-match';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';
import { INTERNAL_TERMS } from './terms/internal-terms';

const requires = ['reply.text'] as const;

/** A reply never shows internal product vocabulary (topics, indexes, pulses, cycles). */
export const noInternalTerms: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) => {
      const found = findPhrases(text, INTERNAL_TERMS);
      return found.length > 0 ? [formatEvidence(turn, `internal terms: ${found.join(', ')}`)] : [];
    });
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-no-internal-terms-pass', ['Which part of the release is taking most of your energy?']),
    fail: syntheticRun('RULE-no-internal-terms-fail', ['Let us move to the next topic in this pulse. How is workload?']),
  },
};

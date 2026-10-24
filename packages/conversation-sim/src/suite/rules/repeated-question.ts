import { findRepeatedQuestions } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

/**
 * Wraps the legacy `repeated-question` check: a selected reply must not re-ask a
 * question an earlier reply of the run already asked.
 */
export const repeatedQuestion: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const selectedTurns = new Set(selection.replies.map((reply) => reply.turn));
    const evidence = findRepeatedQuestions(selection.transcript)
      .filter(({ turn }) => selectedTurns.has(turn))
      .map(({ turn, question }) => formatEvidence(turn, question));
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-repeated-question-pass', [
      'What is taking most of your time on the project right now?',
      'Which part of the release worries you the most?',
    ]),
    fail: syntheticRun('RULE-repeated-question-fail', [
      'What is taking most of your time on the project right now?',
      'Got it. What is taking most of your time on the project right now?',
    ]),
  },
};

import { extractQuestions } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

/** A reply asks exactly one question; FAIL evidence lists the questions found, or `none`. */
export const singleQuestion: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) => {
      const questions = extractQuestions(text);
      if (questions.length === 1) return [];
      return [formatEvidence(turn, questions.length === 0 ? 'none' : questions.join(' / '))];
    });
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-single-question-pass', ['Two releases in one week is a lot. Which one lands first?']),
    fail: syntheticRun('RULE-single-question-fail', ['Two releases in one week is a lot.']),
  },
};

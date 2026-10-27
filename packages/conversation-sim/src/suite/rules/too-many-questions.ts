import { extractQuestions } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

/** Wraps the legacy `too-many-questions` check: a reply asks at most one question. */
export const tooManyQuestions: RuleEntry = {
  requires,
  run(run, criterion) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const evidence = selection.replies.flatMap(({ turn, text }) => {
      const questions = extractQuestions(text);
      return questions.length > 1 ? [formatEvidence(turn, questions.join(' / '))] : [];
    });
    return outcomeFrom(evidence);
  },
  fixtures: {
    pass: syntheticRun('RULE-too-many-questions-pass', [
      'Thanks for sharing that. What felt hardest this week?',
    ]),
    fail: syntheticRun('RULE-too-many-questions-fail', [
      'How is the project going? And how is the team holding up?',
    ]),
  },
};

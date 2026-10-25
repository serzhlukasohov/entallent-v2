import { findRepeatedQuestions } from '../../harness/assertions';
import type { RuleEntry } from './registry';
import { formatEvidence, outcomeFrom, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;
const ALREADY_ASKED = / \(already asked on turn (\d+)\)$/;

/**
 * Wraps the legacy `repeated-question` check: a selected reply must not re-ask a
 * question an earlier reply of the run, or a seeded coach turn, already asked.
 * Seeded coach turns prefix the transcript; only selected run turns are reported.
 */
export const repeatedQuestion: RuleEntry = {
  requires,
  run(run, criterion, _params, context) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;
    const seeded = (context?.seedHistory ?? []).filter((turn) => turn.role === 'coach').map((turn) => turn.text);
    const offset = seeded.length;
    const selectedTurns = new Set(selection.replies.map((reply) => reply.turn));
    const evidence = findRepeatedQuestions([...seeded, ...selection.transcript])
      .map(({ turn, question }) => ({ turn: turn - offset, question }))
      .filter(({ turn }) => selectedTurns.has(turn))
      .map(({ turn, question }) => formatEvidence(turn, renumber(question, offset)));
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

/** Maps the legacy "already asked on turn <m>" onto run turns, or names the seeded coach turn. */
function renumber(question: string, offset: number): string {
  if (offset === 0) return question;
  return question.replace(ALREADY_ASKED, (_match, raw: string) => {
    const turn = Number(raw);
    return turn <= offset ? ` (already asked in seeded coach turn ${turn})` : ` (already asked on turn ${turn - offset})`;
  });
}

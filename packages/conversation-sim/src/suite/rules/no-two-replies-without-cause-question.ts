import type { RuleEntry } from './registry';
import { hasQuestion } from './cause-question-present';
import { formatEvidence, selectReplies } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const requires = ['reply.text'] as const;

interface CoachReply {
  /** Run step index, or null for a seeded coach turn. */
  turn: number | null;
  /** 1-based position among the seeded coach turns. */
  seeded?: number;
  text: string;
}

/**
 * No two consecutive coach replies are both without a question (`cause-question-present`
 * applied to each pair). The sequence is the seeded coach turns followed by the run's
 * replies up to the selected step; observed silence is not a coach reply. Only pairs that
 * end on a selected run reply are judged, and the first failing pair is reported.
 */
export const noTwoRepliesWithoutCauseQuestion: RuleEntry = {
  requires,
  run(run, criterion, _params, context) {
    const selection = selectReplies(run, criterion, requires);
    if (selection.kind === 'outcome') return selection.outcome;

    const lastTurn = Math.max(...selection.replies.map((reply) => reply.turn));
    const seeded: CoachReply[] = (context?.seedHistory ?? [])
      .filter((turn) => turn.role === 'coach')
      .map((turn, position) => ({ turn: null, seeded: position + 1, text: turn.text }));
    const replies: CoachReply[] = run.steps
      .filter((step) => step.index <= lastTurn)
      .flatMap((step) => (step.reply ? [{ turn: step.index, text: step.reply.text }] : []));
    const sequence = [...seeded, ...replies];
    if (sequence.length < 2) return { status: 'NOT_OBSERVABLE', evidence: 'fewer-than-two-replies' };

    const selected = new Set(selection.replies.map((reply) => reply.turn));
    for (let position = 1; position < sequence.length; position += 1) {
      const previous = sequence[position - 1]!;
      const current = sequence[position]!;
      if (current.turn === null || !selected.has(current.turn)) continue;
      if (hasQuestion(previous.text) || hasQuestion(current.text)) continue;
      const before = previous.turn === null ? `seeded coach turn ${previous.seeded}` : `turn ${previous.turn}`;
      return { status: 'FAIL', evidence: formatEvidence(current.turn, `no question in this reply or the previous one (${before})`) };
    }
    return { status: 'PASS' };
  },
  fixtures: {
    pass: syntheticRun('RULE-no-two-replies-without-cause-question-pass', [
      'That sounds like a heavy week.',
      'What is making the handover so slow?',
    ]),
    fail: syntheticRun('RULE-no-two-replies-without-cause-question-fail', [
      'That sounds like a heavy week.',
      'Keep going, you are doing well.',
    ]),
  },
};

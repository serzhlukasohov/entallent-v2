import {
  AUTONOMY_IDS,
  AUTONOMY_SUMMARIES,
  AUTONOMY_WINDOW,
  P09_AUTHORED_CLARIFICATION,
  P09_AUTHORED_CONFIRMATION,
  P09_AUTHORED_SUMMARY_TURN,
  P09_COACH,
  P09_STEPS,
  coach,
  confirmationQuestion,
  seedOf,
  user,
  type QuestionStatus,
} from './texts';

/**
 * The P-09 conversation in product order (Illia, 2026-10-27): steps 1-3, the authored summary
 * turn, step 4 (a correction disputing statement 2), the authored clarification, the authored
 * confirmation, step 5. Coach turns are the approved texts; the summary carries
 * `metadata.v2ConfirmationBundle: true`. Each atomic test seeds the prefix before its turn.
 */
export const P09_CONVERSATION = [
  user(P09_STEPS[0]),
  coach(P09_COACH.afterStep1),
  user(P09_STEPS[1]),
  coach(P09_COACH.afterStep2),
  user(P09_STEPS[2]),
  coach(P09_COACH.afterStep3),
  user(P09_AUTHORED_SUMMARY_TURN),
  coach(P09_COACH.summary, { v2ConfirmationBundle: true }),
  user(P09_STEPS[3]),
  coach(P09_COACH.clarificationPrompt),
  user(P09_AUTHORED_CLARIFICATION),
  coach(P09_COACH.correctedStatement),
  user(P09_AUTHORED_CONFIRMATION),
  coach(P09_COACH.complete),
  user(P09_STEPS[4]),
] as const;

/** Seed and evaluated step for the user turn at `index` of `P09_CONVERSATION`. */
export function p09Moment(index: number): { seed: ReturnType<typeof seedOf>; steps: Array<{ text: string }> } {
  const turn = P09_CONVERSATION[index];
  if (!turn || turn.role !== 'user') throw new Error(`P-09 turn ${index} is not a user turn`);
  return { seed: seedOf(P09_CONVERSATION.slice(0, index)), steps: [{ text: turn.text }] };
}

/** `confirmationState` params for the Autonomy window with per-question statuses (q1, q2, q3). */
export function autonomyState(
  statuses: readonly [QuestionStatus, QuestionStatus, QuestionStatus],
  extra: Record<string, unknown> = {},
  summaries: Partial<Record<(typeof AUTONOMY_IDS)[number], string>> = {},
): { name: 'confirmationState'; params: Record<string, unknown> } {
  return {
    name: 'confirmationState',
    params: {
      surveyWindowId: AUTONOMY_WINDOW,
      questions: AUTONOMY_IDS.map((id, index) =>
        confirmationQuestion(id, 'autonomy', statuses[index]!, summaries[id] ?? AUTONOMY_SUMMARIES[id]),
      ),
      ...extra,
    },
  };
}

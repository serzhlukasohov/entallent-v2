import type { CycleProgressSnapshot, QuestionBundleVerdict } from '../ports/question-confirmation.port';

export type { CycleProgressSnapshot };

/**
 * GC round 3 CAP-3: cycle progress is a typed fact the reply is grounded on (topic names and
 * counts only, never evidence text). The snapshot is read from the active V2 window; the
 * prediction applies this turn's verdict before it is committed so the reply can state
 * completion in the same message.
 */

export interface CycleProgress {
  inCycle: boolean;
  topicsTotal: number;
  topicsClosed: number;
  /** Topics not yet closed, in cycle order. */
  openTopics: string[];
  /** The topic this turn's verdict closes, when it was open before. */
  closedNow: string | null;
  /** A shown summary or clarification question still waits for the employee after this turn. */
  awaitingReply: boolean;
}

export interface PendingVerdictChange {
  questionGroup: string;
  componentQuestionIds: readonly string[];
  verdict: Exclude<QuestionBundleVerdict, { kind: 'unrelated' }>;
}

const CLOSED_STATUSES = new Set(['confirmed', 'declined']);
const AWAITING_STATUSES = new Set(['pending_confirmation', 'pending_clarification']);

export const EMPTY_CYCLE_PROGRESS: CycleProgress = {
  inCycle: false, topicsTotal: 0, topicsClosed: 0, openTopics: [], closedNow: null, awaitingReply: false,
};

function isClosed(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.every((status) => CLOSED_STATUSES.has(status));
}

function statusAfterVerdict(questionId: string, current: string, change: PendingVerdictChange): string {
  if (!change.componentQuestionIds.includes(questionId)) return current;
  const { verdict } = change;
  if (verdict.kind === 'agree') return 'confirmed';
  if (verdict.kind === 'reject') return 'reset';
  if (verdict.acceptedQuestionIds.includes(questionId)) return 'confirmed';
  if (verdict.disputedQuestionIds.includes(questionId)) return 'pending_clarification';
  return 'declined';
}

export function predictCycleProgress(
  snapshot: CycleProgressSnapshot | null,
  change?: PendingVerdictChange,
): CycleProgress {
  if (!snapshot) return EMPTY_CYCLE_PROGRESS;
  let closedNow: string | null = null;
  let topicsClosed = 0;
  let awaitingReply = false;
  const openTopics: string[] = [];
  for (const group of snapshot.groups) {
    const before = group.questions.map((question) => question.status);
    const after = change && change.questionGroup === group.questionGroup
      ? group.questions.map((question) => statusAfterVerdict(question.surveyQuestionId, question.status, change))
      : before;
    const closed = isClosed(after);
    if (closed) {
      topicsClosed += 1;
      if (!isClosed(before)) closedNow = group.questionGroup;
    } else {
      openTopics.push(group.questionGroup);
    }
    if (after.some((status) => AWAITING_STATUSES.has(status))) awaitingReply = true;
  }
  return {
    inCycle: true,
    topicsTotal: snapshot.groups.length,
    topicsClosed,
    openTopics,
    closedNow,
    awaitingReply,
  };
}

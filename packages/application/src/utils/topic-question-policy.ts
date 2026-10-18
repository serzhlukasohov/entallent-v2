/**
 * GC round 3 CAP-1 (ADR-013 D4): inside an active V2 cycle the bot itself raises the next uncovered
 * pulse topic. Whether a topic question is due is a deterministic, versioned product rule over typed
 * turn facts; the model only words the question (D8). Decided by the PO on 2026-10-17: at most every
 * third employee turn, mandatory when due, and a topic completion opens the next topic on the next
 * eligible turn.
 */
export const TOPIC_QUESTION_POLICY = {
  version: 'topic-question-v1',
  owner: 'product (pulse pilot)',
  tenantConfigurable: false,
  employeeTurnsBetweenTopicQuestions: 3,
  /** The completion reply is the natural moment to move on; the next employee turn is eligible. */
  employeeTurnsAfterTopicCompletion: 1,
  /**
   * Counted over a rolling 24 hours per conversation (a Slack DM is one long-lived conversation),
   * from a durable count where the repository offers one.
   */
  maxTopicQuestionsPer24h: 3,
} as const;

export interface TopicCadenceMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  occurredAt: Date;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface TopicCadence {
  /** The latest event the cadence counts from. */
  anchor: 'topic_question' | 'topic_completion' | 'disclosure' | 'none';
  /** Employee turns after the anchor, the current inbound included. */
  employeeTurnsSinceAnchor: number;
  /** Topic questions asked in the 24 hours before the current turn. */
  topicQuestionsLast24h: number;
}

/** Outbound metadata markers written by the orchestrator and the proactive check-in. */
export function isTopicQuestionMessage(message: Pick<TopicCadenceMessage, 'direction' | 'metadata'>): boolean {
  return message.direction === 'outbound' && message.metadata?.['containsSurveyProbe'] === true;
}

export function isTopicCompletionMessage(message: Pick<TopicCadenceMessage, 'direction' | 'metadata'>): boolean {
  const completed = message.metadata?.['topicCompleted'];
  return message.direction === 'outbound' && typeof completed === 'string' && completed.length > 0;
}

/** The reporting disclosure is recorded on the outbound message that carried it. */
function isDisclosureMessage(message: TopicCadenceMessage): boolean {
  return message.direction === 'outbound' && typeof message.metadata?.['reportingDisclosureVersion'] === 'string';
}

/**
 * An outbound whose topic question broke its rail and fell back still anchors the cadence, so a
 * failing turn is not retried on every following turn; it does not count toward the cap.
 */
function isTopicAttemptMessage(message: Pick<TopicCadenceMessage, 'direction' | 'metadata'>): boolean {
  const reason = message.metadata?.['topicQuestionFallbackReason'];
  return message.direction === 'outbound' && typeof reason === 'string' && reason.length > 0;
}

const DAY_MS = 86_400_000;

/** Messages in chronological order, the current inbound last; `now` defaults to its time. */
export function readTopicCadence(messages: readonly TopicCadenceMessage[], now?: Date): TopicCadence {
  const turns = messages.filter((message) => !(message.direction === 'inbound' && message.text === '__init__'));
  let anchor: TopicCadence['anchor'] = 'none';
  let employeeTurnsSinceAnchor = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const message = turns[index]!;
    if (message.direction === 'inbound') {
      employeeTurnsSinceAnchor += 1;
      continue;
    }
    if (isTopicQuestionMessage(message) || isTopicAttemptMessage(message)) { anchor = 'topic_question'; break; }
    if (isTopicCompletionMessage(message)) { anchor = 'topic_completion'; break; }
    if (isDisclosureMessage(message)) { anchor = 'disclosure'; break; }
  }
  const reference = (now ?? turns.at(-1)?.occurredAt ?? new Date()).getTime();
  const topicQuestionsLast24h = turns.filter((message) => isTopicQuestionMessage(message)
    && message.occurredAt.getTime() > reference - DAY_MS).length;
  return { anchor, employeeTurnsSinceAnchor, topicQuestionsLast24h };
}

/** Cadence and cap only; lets the caller skip topic lookups on turns that cannot ask. */
export function isTopicCadenceSatisfied(cadence: TopicCadence): boolean {
  if (cadence.topicQuestionsLast24h >= TOPIC_QUESTION_POLICY.maxTopicQuestionsPer24h) return false;
  const required = cadence.anchor === 'topic_completion'
    ? TOPIC_QUESTION_POLICY.employeeTurnsAfterTopicCompletion
    : TOPIC_QUESTION_POLICY.employeeTurnsBetweenTopicQuestions;
  return cadence.employeeTurnsSinceAnchor >= required;
}

export interface TopicQuestionFacts {
  /** The employee has an active V2 window with at least one open topic. */
  activeV2Cycle: boolean;
  disclosureDelivered: boolean;
  /** Pulse enabled and the turn understanding allows survey content. */
  surveyAllowed: boolean;
  /** Risk detected, safety check required, or a sensitive/crisis reply mode. */
  safetyTurn: boolean;
  /** Closing or acknowledgement: a pause contract, no new thread. */
  pauseTurn: boolean;
  correctionTurn: boolean;
  /** A bundle, clarification, corrected statement, or legacy confirmation is shown or answered. */
  confirmationTurn: boolean;
  /** This reply states that a topic is complete; the next topic waits for the next turn. */
  topicCompletedThisTurn: boolean;
  /** Reporting, data-use, pulse-capture, or cycle-status answer. */
  explanationTurn: boolean;
  /** The reply plan allows one question (offer delivery or a format request do not). */
  replyAllowsQuestion: boolean;
  cadence: TopicCadence;
}

export type TopicQuestionBlockReason =
  | 'no_active_cycle'
  | 'survey_not_allowed'
  | 'disclosure_missing'
  | 'safety_turn'
  | 'confirmation_turn'
  | 'topic_completed_this_turn'
  | 'explanation_turn'
  | 'pause_turn'
  | 'correction_turn'
  | 'reply_without_question'
  | 'daily_cap_reached'
  | 'cadence_not_reached';

export type TopicQuestionDecision =
  | { due: true; policyVersion: string }
  | { due: false; reason: TopicQuestionBlockReason; policyVersion: string };

export function canAskTopicQuestion(facts: TopicQuestionFacts): TopicQuestionDecision {
  const blocked = (reason: TopicQuestionBlockReason): TopicQuestionDecision => ({
    due: false, reason, policyVersion: TOPIC_QUESTION_POLICY.version,
  });
  if (facts.safetyTurn) return blocked('safety_turn');
  if (!facts.surveyAllowed) return blocked('survey_not_allowed');
  if (!facts.activeV2Cycle) return blocked('no_active_cycle');
  if (!facts.disclosureDelivered) return blocked('disclosure_missing');
  if (facts.confirmationTurn) return blocked('confirmation_turn');
  if (facts.topicCompletedThisTurn) return blocked('topic_completed_this_turn');
  if (facts.explanationTurn) return blocked('explanation_turn');
  if (facts.pauseTurn) return blocked('pause_turn');
  if (facts.correctionTurn) return blocked('correction_turn');
  if (!facts.replyAllowsQuestion) return blocked('reply_without_question');
  if (facts.cadence.topicQuestionsLast24h >= TOPIC_QUESTION_POLICY.maxTopicQuestionsPer24h) {
    return blocked('daily_cap_reached');
  }
  if (!isTopicCadenceSatisfied(facts.cadence)) return blocked('cadence_not_reached');
  return { due: true, policyVersion: TOPIC_QUESTION_POLICY.version };
}

import { describe, expect, it } from 'vitest';
import {
  TOPIC_QUESTION_POLICY,
  canAskTopicQuestion,
  readTopicCadence,
  type TopicCadenceMessage,
  type TopicQuestionFacts,
} from './topic-question-policy';

const T0 = new Date('2026-10-17T10:00:00.000Z').getTime();
let seq = 0;
function msg(direction: 'inbound' | 'outbound', minute: number, metadata?: Record<string, unknown>): TopicCadenceMessage {
  seq += 1;
  return { id: `m-${seq}`, direction, occurredAt: new Date(T0 + minute * 60_000), text: 'x', metadata };
}

const DISCLOSURE = { reportingDisclosureVersion: 'reporting-disclosure-v1' };

function facts(overrides: Partial<TopicQuestionFacts> = {}): TopicQuestionFacts {
  return {
    activeV2Cycle: true,
    disclosureDelivered: true,
    surveyAllowed: true,
    safetyTurn: false,
    pauseTurn: false,
    correctionTurn: false,
    confirmationTurn: false,
    topicCompletedThisTurn: false,
    explanationTurn: false,
    replyAllowsQuestion: true,
    cadence: { anchor: 'disclosure', employeeTurnsSinceAnchor: 3, topicQuestionsLast24h: 0 },
    ...overrides,
  };
}

describe('readTopicCadence', () => {
  it('counts employee turns since the delivered disclosure, including the current one', () => {
    const disclosure = msg('outbound', 0, DISCLOSURE);
    const cadence = readTopicCadence([
      msg('inbound', -1), disclosure, msg('inbound', 1), msg('outbound', 2), msg('inbound', 3), msg('outbound', 4), msg('inbound', 5),
    ]);
    expect(cadence).toEqual({ anchor: 'disclosure', employeeTurnsSinceAnchor: 3, topicQuestionsLast24h: 0 });
  });

  it('anchors on the latest topic question and counts it toward the session cap', () => {
    const cadence = readTopicCadence([
      msg('inbound', 0), msg('outbound', 1, { containsSurveyProbe: true }), msg('inbound', 2),
      msg('outbound', 3, { containsSurveyProbe: true }), msg('inbound', 4),
    ]);
    expect(cadence).toEqual({ anchor: 'topic_question', employeeTurnsSinceAnchor: 1, topicQuestionsLast24h: 2 });
  });

  it('anchors on a topic completion reply', () => {
    const cadence = readTopicCadence([
      msg('outbound', 0, { containsSurveyProbe: true }), msg('inbound', 1),
      msg('outbound', 2, { topicCompleted: 'autonomy' }), msg('inbound', 3),
    ]);
    expect(cadence.anchor).toBe('topic_completion');
    expect(cadence.employeeTurnsSinceAnchor).toBe(1);
  });

  it('counts only topic questions of the last 24 hours and ignores the init marker', () => {
    const cadence = readTopicCadence([
      msg('outbound', 0, { containsSurveyProbe: true }), msg('inbound', 1),
      msg('outbound', 100, { containsSurveyProbe: true }),
      { ...msg('inbound', 1500), text: '__init__' }, msg('inbound', 1501),
    ], new Date(T0 + 1501 * 60_000));
    expect(cadence).toEqual({ anchor: 'topic_question', employeeTurnsSinceAnchor: 1, topicQuestionsLast24h: 1 });
  });

  it('anchors on a topic attempt that fell back, without counting it toward the cap', () => {
    const cadence = readTopicCadence([
      msg('outbound', 0, { containsSurveyProbe: true }), msg('inbound', 1),
      msg('outbound', 2, { topicQuestionFallbackReason: 'question_count' }), msg('inbound', 3),
    ]);
    expect(cadence).toEqual({ anchor: 'topic_question', employeeTurnsSinceAnchor: 1, topicQuestionsLast24h: 1 });
  });

  it('reports no anchor when the window holds none', () => {
    expect(readTopicCadence([msg('inbound', 0), msg('outbound', 1), msg('inbound', 2)]))
      .toEqual({ anchor: 'none', employeeTurnsSinceAnchor: 2, topicQuestionsLast24h: 0 });
  });
});

describe('canAskTopicQuestion', () => {
  it('is due three employee turns after the disclosure with no topic asked yet', () => {
    expect(canAskTopicQuestion(facts())).toEqual({ due: true, policyVersion: TOPIC_QUESTION_POLICY.version });
  });

  it('waits for three employee turns after a topic question', () => {
    expect(canAskTopicQuestion(facts({
      cadence: { anchor: 'topic_question', employeeTurnsSinceAnchor: 2, topicQuestionsLast24h: 1 },
    }))).toMatchObject({ due: false, reason: 'cadence_not_reached' });
    expect(canAskTopicQuestion(facts({
      cadence: { anchor: 'topic_question', employeeTurnsSinceAnchor: 3, topicQuestionsLast24h: 1 },
    }))).toMatchObject({ due: true });
  });

  it('opens the next topic on the first employee turn after a completion', () => {
    expect(canAskTopicQuestion(facts({
      cadence: { anchor: 'topic_completion', employeeTurnsSinceAnchor: 1, topicQuestionsLast24h: 1 },
    }))).toMatchObject({ due: true });
  });

  it('never asks on the completion turn itself', () => {
    expect(canAskTopicQuestion(facts({ topicCompletedThisTurn: true })))
      .toMatchObject({ due: false, reason: 'topic_completed_this_turn' });
  });

  it('stops at the per-session cap', () => {
    expect(canAskTopicQuestion(facts({
      cadence: { anchor: 'topic_question', employeeTurnsSinceAnchor: 5, topicQuestionsLast24h: TOPIC_QUESTION_POLICY.maxTopicQuestionsPer24h },
    }))).toMatchObject({ due: false, reason: 'daily_cap_reached' });
  });

  it.each([
    ['no_active_cycle', { activeV2Cycle: false }],
    ['survey_not_allowed', { surveyAllowed: false }],
    ['disclosure_missing', { disclosureDelivered: false }],
    ['safety_turn', { safetyTurn: true }],
    ['confirmation_turn', { confirmationTurn: true }],
    ['explanation_turn', { explanationTurn: true }],
    ['pause_turn', { pauseTurn: true }],
    ['correction_turn', { correctionTurn: true }],
    ['reply_without_question', { replyAllowsQuestion: false }],
  ] as const)('is not due on a %s', (reason, override) => {
    expect(canAskTopicQuestion(facts(override))).toMatchObject({ due: false, reason });
  });

  it('puts safety ahead of every other reason', () => {
    expect(canAskTopicQuestion(facts({ safetyTurn: true, pauseTurn: true, confirmationTurn: true })))
      .toMatchObject({ due: false, reason: 'safety_turn' });
  });
});

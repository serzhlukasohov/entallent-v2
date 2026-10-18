import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import type { QuestionConfirmationPort } from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

const TENANT_ID = 'sim-tenant';
const USER_ID = 'sim-user';
const CONVERSATION_ID = 'sim-conversation';
/** `REPORTING_DISCLOSURE_VERSION` in `packages/application/src/utils/reporting-disclosure.ts`. */
const REPORTING_DISCLOSURE_VERSION = 'reporting-disclosure-v1';

const AUTONOMY_QUESTION = {
  id: 'q-autonomy-methods', surveyDefinitionId: 'sim-definition', stableKey: 'autonomy_methods',
  title: 'Choice of methods', canonicalMeaning: 'How much say the employee has over how they do their work',
  dimension: 'autonomy', questionGroup: 'autonomy', displayOrder: 1,
  positiveIndicators: [], negativeIndicators: [], contraindications: [],
  probeStrategies: ['How much freedom they have to choose how they approach their own tasks'],
  confidenceThreshold: 0.72, completenessThreshold: 0.65, minimumEvidenceCount: 1, cooldownDays: 14,
  maxFollowUpProbes: 3, responseType: 'open_ended' as const, version: 'v2',
};

/** An open V2 cycle with autonomy uncovered; no bundle, clarification, or verdict is pending. */
const questionConfirmationRepo: QuestionConfirmationPort = {
  findCycleProgress: async () => ({
    surveyWindowId: 'sim-window',
    groups: [{ questionGroup: 'autonomy', questions: [{ surveyQuestionId: AUTONOMY_QUESTION.id, status: 'collecting' }] }],
  }),
  findAppliedQuestionVerdictForInbound: async () => null,
  findPendingQuestionClarification: async () => null,
  stageQuestionClarificationPrompt: async () => true,
  applyQuestionClarificationVerdict: async () => true,
  findAwaitingQuestionBundle: async () => null,
  applyQuestionBundleVerdict: async () => true,
  findReadyQuestionBundle: async () => null,
  hasReadyQuestionBundle: async () => false,
  stageQuestionConfirmationBundle: async () => 'unused',
};

type Seed = Array<{ direction: 'inbound' | 'outbound'; text: string; metadata?: Record<string, unknown> }>;

async function seedHistory(harness: ReturnType<typeof createCoachAgent>['harness'], seed: Seed): Promise<void> {
  const start = Date.now() - (seed.length + 1) * 60_000;
  for (const [index, item] of seed.entries()) {
    const saved = await harness.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID, tenantId: TENANT_ID, userId: USER_ID,
      direction: item.direction, text: item.text, occurredAt: new Date(start + index * 60_000), metadata: item.metadata,
    });
    if (item.direction === 'outbound') {
      await harness.conversationRepo.updateMessageDelivery(saved.id, {
        tenantId: TENANT_ID, conversationId: CONVERSATION_ID,
        externalMessageId: `sim-${index}`, sentAt: new Date(start + index * 60_000),
      });
    }
  }
}

const COMMON_CRITERIA = [
  'The reply first responds to what the employee just wrote, briefly, before anything else',
  'The reply contains exactly one question and it is the last sentence',
  'The reply never mentions a survey, questionnaire, form, index, score scale, pulse topics, or internal labels',
];

/**
 * GC round 3 CAP-1 (T1) and CAP-2 (T2): inside an open V2 cycle, after the disclosure and three
 * employee turns with no topic raised, the bot itself asks one direct question on the uncovered
 * topic; when the employee already gave a status without a reason, it asks what drives it.
 */
describe('CAP-1/CAP-2 topic steering inside an open pulse cycle', () => {
  it.each([
    {
      name: 'CAP-1 topic steering: opens the uncovered topic',
      focus: 'open' as const,
      seed: [
        { direction: 'outbound', text: 'Hi Olena. Your reflections can be used in aggregated reporting.', metadata: { reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION } },
        { direction: 'inbound', text: 'Hey. Release week, so mostly heads-down.' },
        { direction: 'outbound', text: 'Release weeks have their own rhythm. What is on your plate today?' },
        { direction: 'inbound', text: 'Finishing the checklist and a couple of reviews.' },
        { direction: 'outbound', text: 'A checklist plus reviews is a full day.' },
      ] as Seed,
      message: 'Yeah. I just finished the checklist, reviews are next after lunch.',
      criterion: 'The question asks directly about how much say or freedom the employee has over how they approach or organise their own work',
    },
    {
      name: 'CAP-2 topic steering: asks what drives a status',
      focus: 'driver' as const,
      seed: [
        { direction: 'outbound', text: 'Hi Olena. Your reflections can be used in aggregated reporting.', metadata: { reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION } },
        { direction: 'inbound', text: 'Hey. Release week, so mostly heads-down.' },
        { direction: 'outbound', text: 'How much room do you have to decide how you tackle your own tasks this week?', metadata: { containsSurveyProbe: true, surveyProbeQuestionId: AUTONOMY_QUESTION.id } },
        { direction: 'inbound', text: 'Honestly a lot, I would say 9 out of 10.' },
        { direction: 'outbound', text: 'That is high.' },
        { direction: 'inbound', text: 'Lunch now, then reviews.' },
        { direction: 'outbound', text: 'Enjoy the break.' },
      ] as Seed,
      message: 'Back. Reviews went quicker than I expected.',
      criterion: 'The question asks what drives, explains, or makes possible the high amount of say the employee has over their own work (the reason behind it), rather than asking them to rate or restate it',
    },
  ])('$name', async ({ name, focus, seed, message, criterion }) => {
    const pulseBacklogService = {
      getNextProbeQuestion: async () => ({ question: AUTONOMY_QUESTION, windowId: 'sim-window', focus }),
    };
    const { agent, harness } = createCoachAgent({ userName: 'Olena', questionConfirmationRepo, pulseBacklogService });
    await seedHistory(harness, seed);

    const result = await run({
      name,
      description: 'An employee chats about an ordinary release day while a pulse cycle is open and the autonomy topic is not yet covered.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({ model: judgeModel(), criteria: [...COMMON_CRITERIA, criterion] }),
      ],
      script: [user(message), agentTurn(), judge()],
      maxTurns: 3,
      setId: SET_ID,
    });
    await reportRun(name, harness, result);

    const reply = harness.replies[0] ?? '';
    expect(harness.turns[0]?.outcome, `reply was not generated: ${reply}`).toBeUndefined();
    const outbound = harness.transcript.filter((item) => item.direction === 'outbound').at(-1);
    const decision = JSON.stringify({
      decision: outbound?.metadata?.topicQuestionDecision, fallback: outbound?.metadata?.topicQuestionFallbackReason,
    });
    // The policy made the topic question mandatory and the reply went through the typed path.
    expect(harness.responseCallsByTurn[0]?.context.topicQuestion, decision).toMatchObject({
      questionId: AUTONOMY_QUESTION.id, questionGroup: 'autonomy', focus,
    });
    expect(outbound?.metadata).toMatchObject({
      containsSurveyProbe: true, surveyProbeQuestionId: AUTONOMY_QUESTION.id,
      topicQuestion: { questionGroup: 'autonomy', focus },
    });
    expect(outbound?.metadata?.topicQuestionFallbackReason).toBeUndefined();
    expect((reply.match(/\?/g) ?? []).length, reply).toBe(1);
    expect(reply.trim().endsWith('?'), reply).toBe(true);

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});

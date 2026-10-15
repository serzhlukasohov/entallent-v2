import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { isBundleShownIn, type QuestionConfirmationPort, type ReadyQuestionBundle } from '@entalent/application';
import { describe, expect, it, vi } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

const TENANT_ID = 'sim-tenant';
const USER_ID = 'sim-user';
const CONVERSATION_ID = 'sim-conversation';
/** `REPORTING_DISCLOSURE_VERSION` in `packages/application/src/utils/reporting-disclosure.ts`. */
const REPORTING_DISCLOSURE_VERSION = 'reporting-disclosure-v1';

const PRIOR_EMPLOYEE_MESSAGE =
  'Honestly the best part of this team is that I get to decide how I approach my own tasks, nobody micromanages the order I do things in, and when I think a priority is wrong I can say so to my lead and she actually listens.';
const PRIOR_COACH_REPLY =
  'That combination is rarer than it sounds, especially the last part. Your reflections can be used in aggregated reporting.';

const READY_BUNDLE: ReadyQuestionBundle = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  surveyWindowId: 'sim-window',
  questionGroup: 'autonomy',
  questions: [
    { surveyQuestionId: 'q-methods', questionVersion: 'v2', workingSummary: 'You decide how to approach your own tasks.' },
    { surveyQuestionId: 'q-order', questionVersion: 'v2', workingSummary: 'Nobody micromanages the order you do things in.' },
    { surveyQuestionId: 'q-priorities', questionVersion: 'v2', workingSummary: 'You can push back on a priority and your lead listens.' },
  ],
};

const EMPLOYEE_MESSAGE =
  'Tomorrow I will start with the retro notes before standup and then move on to the release checklist, so the afternoon should be calm. One thing I keep going back and forth on: the team is going out for dinner after the release and I barely know most of them yet. Is it worth going, or is it fine to skip this one?';

/**
 * GC round 3 CAP-4 (T4): a substantive message with a question arrives while a V2 confirmation
 * bundle is ready. The outbound answers the question first and shows the composed bundle last,
 * byte-exact, instead of replacing the employee's message with a summary.
 */
describe('CAP-4 answer before the confirmation bundle', () => {
  it('answers the employee question first and shows the byte-exact bundle last', async () => {
    const stageQuestionConfirmationBundle = vi.fn<QuestionConfirmationPort['stageQuestionConfirmationBundle']>(
      async () => 'sim-bundle',
    );
    const questionConfirmationRepo: QuestionConfirmationPort = {
      findAppliedQuestionVerdictForInbound: async () => null,
      findPendingQuestionClarification: async () => null,
      stageQuestionClarificationPrompt: async () => true,
      applyQuestionClarificationVerdict: async () => true,
      findAwaitingQuestionBundle: async () => null,
      applyQuestionBundleVerdict: async () => true,
      findReadyQuestionBundle: async () => READY_BUNDLE,
      hasReadyQuestionBundle: async () => true,
      stageQuestionConfirmationBundle,
    };
    const { agent, harness } = createCoachAgent({ userName: 'Olena', questionConfirmationRepo });
    const scenarioName = 'CAP-4 answer before the confirmation bundle';

    // Earlier in the same session: the autonomy evidence behind the bundle, and a delivered
    // reporting disclosure, which the orchestrator requires before it surfaces a bundle.
    const now = Date.now();
    await harness.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text: PRIOR_EMPLOYEE_MESSAGE,
      occurredAt: new Date(now - 12 * 60_000),
    });
    const disclosure = await harness.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'outbound',
      text: PRIOR_COACH_REPLY,
      occurredAt: new Date(now - 10 * 60_000),
      metadata: { reportingDisclosureVersion: REPORTING_DISCLOSURE_VERSION },
    });
    await harness.conversationRepo.updateMessageDelivery(disclosure.id, {
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      externalMessageId: 'sim-disclosure',
      sentAt: new Date(now - 10 * 60_000),
    });

    const result = await run({
      name: scenarioName,
      description:
        'An employee shares the plan for tomorrow and asks whether to join the team dinner while a confirmation bundle about autonomy is ready to be shown.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The reply opens by answering the dinner question (whether it is worth going or fine to skip) with a clear view, before anything else',
            'The answer to the dinner question comes before the statements that reflect back what the employee shared about autonomy and ask whether that is fair',
            'The coach does not ignore, postpone, or replace the dinner question with a summary',
            'The reply engages with what the employee actually wrote (the plan for tomorrow or the dinner) rather than only restating autonomy points',
          ],
        }),
      ],
      script: [user(EMPLOYEE_MESSAGE), agentTurn(), judge()],
      maxTurns: 3,
      setId: SET_ID,
    });

    await reportRun(scenarioName, harness, result);

    const turn = harness.turns[0];
    const reply = harness.replies[0] ?? '';
    expect(turn?.outcome, `reply was not generated: ${reply}`).toBeUndefined();

    // The turn went through the two-part contract, not the bundle-alone fallback.
    expect(turn?.bundleReply, `fallback reason: ${turn?.bundleReplyFallbackReason ?? 'none'}`).toBe('answer_then_bundle');
    const outbound = harness.transcript.filter((message) => message.direction === 'outbound').at(-1);
    expect(outbound?.text).toBe(reply);
    expect(outbound?.metadata?.v2ConfirmationBundle).toBe(true);
    expect(outbound?.metadata?.v2BundleReply).toBe('answer_then_bundle');
    expect(outbound?.metadata?.v2BundleReplyFallbackReason).toBeUndefined();

    // The staged bundle is what the model was told to copy, and generation ran once.
    expect(stageQuestionConfirmationBundle).toHaveBeenCalledOnce();
    const staged = stageQuestionConfirmationBundle.mock.calls[0]![0];
    expect(staged.promptMessageId).toBe(outbound?.id);
    const bundleText = staged.displayedText;
    const statements = staged.components.map((component) => component.statement);
    expect(statements).toHaveLength(READY_BUNDLE.questions.length);
    expect(harness.generateResponseCalls).toHaveLength(1);
    expect(harness.responseCallsByTurn[0]?.context.trailingBundle).toEqual({
      kind: 'confirmation_bundle',
      text: bundleText,
      statements,
    });

    // Byte-exact bundle, once, last, after a non-empty answer that restates no statement.
    const separator = `\n\n${bundleText}`;
    expect(reply.endsWith(separator), `reply does not end with the bundle:\n${reply}`).toBe(true);
    expect(reply.split(bundleText)).toHaveLength(2);
    expect(isBundleShownIn(reply, bundleText, { statements })).toBe(true);
    const answer = reply.slice(0, -separator.length);
    expect(answer.trim().length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(bundleText).toContain(statement);
      expect(reply.indexOf(statement)).toBeGreaterThanOrEqual(answer.length + 2);
    }

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
